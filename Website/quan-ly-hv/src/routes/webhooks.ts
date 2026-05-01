// =============================================================
// Public webhook endpoints — KHÔNG đi qua requireAuth
// =============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { db, C } from '../lib/firebase'
import { refreshTuitionStatus, getPaymentStatus } from '../services/tuitionCalculator'
import { sendMessage as sendZaloMessage } from '../services/zaloService'
import { sendZnsAndLog, findActiveTemplate, resolveRecipient } from './zns'
import {
  parseTransferNote,
  findStudentsByShortId,
  findTuitionRecords,
} from '../services/sepayMatcher'
import type { BankTransaction, Payment } from '../types/models'

const router = Router()

// SePay webhook IPs (https://docs.sepay.vn/tich-hop-webhooks.html).
const SEPAY_IPS = new Set([
  '172.236.138.20',
  '172.233.83.68',
  '171.244.35.2',
  '151.158.108.68',
  '151.158.109.79',
  '103.255.238.139',
])

interface SepayWebhookBody {
  id: number
  gateway: string
  transactionDate: string
  accountNumber: string
  code: string | null
  content: string
  transferType: 'in' | 'out'
  transferAmount: number
  accumulated: number
  subAccount: string | null
  referenceCode: string
  description: string
}

function isAuthorized(req: Request): boolean {
  const expected = process.env.SEPAY_WEBHOOK_KEY
  if (!expected) {
    console.warn('[SePay] Thiếu SEPAY_WEBHOOK_KEY trong env — từ chối tất cả request.')
    return false
  }
  const auth = req.header('authorization') || ''
  // SePay format: "Authorization: Apikey <key>"
  const m = auth.match(/^Apikey\s+(.+)$/i)
  if (!m) return false
  return m[1].trim() === expected
}

function passesIpCheck(req: Request): boolean {
  if (process.env.SEPAY_SKIP_IP_CHECK === 'true') return true
  const ip = (req.header('x-forwarded-for') || req.ip || '').split(',')[0].trim()
  return SEPAY_IPS.has(ip)
}

// POST /api/webhooks/sepay
router.post('/sepay', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isAuthorized(req)) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }
    if (!passesIpCheck(req)) {
      res.status(403).json({ success: false, message: 'Forbidden IP' })
      return
    }

    const body = req.body as SepayWebhookBody
    if (!body || typeof body.id !== 'number') {
      res.status(400).json({ success: false, message: 'Invalid payload' })
      return
    }

    const docId = `tx_${body.id}`
    const txRef = db.collection(C.BANK_TRANSACTIONS).doc(docId)

    // Idempotency: nếu đã xử lý trước đó (do retry) → trả 200 ngay.
    const existing = await txRef.get()
    if (existing.exists) {
      res.json({ success: true, idempotent: true })
      return
    }

    const baseRecord = {
      sepayId: body.id,
      gateway: body.gateway,
      accountNumber: body.accountNumber,
      transferType: body.transferType,
      transferAmount: Number(body.transferAmount) || 0,
      accumulated: Number(body.accumulated) || 0,
      content: body.content || '',
      referenceCode: body.referenceCode || '',
      description: body.description || '',
      transactionDate: body.transactionDate,
      receivedAt: new Date().toISOString(),
    }

    // Bỏ qua tiền chuyển ra.
    if (body.transferType === 'out') {
      const record: BankTransaction = {
        id: docId, ...baseRecord, status: 'ignored_outbound',
      }
      await txRef.set(record)
      res.json({ success: true, status: 'ignored_outbound' })
      return
    }

    // Parse note để tìm shortId + month.
    const parsed = parseTransferNote(body.content)
    if (!parsed) {
      const record: BankTransaction = {
        id: docId, ...baseRecord, status: 'unmatched',
        matchReason: 'Không parse được shortId hoặc tháng từ nội dung CK',
      }
      await txRef.set(record)
      res.json({ success: true, status: 'unmatched' })
      return
    }

    const students = await findStudentsByShortId(parsed.shortId)
    if (students.length === 0) {
      const record: BankTransaction = {
        id: docId, ...baseRecord, status: 'unmatched',
        matchReason: `Không tìm thấy HV với shortId=${parsed.shortId}`,
      }
      await txRef.set(record)
      res.json({ success: true, status: 'unmatched' })
      return
    }
    if (students.length > 1) {
      const record: BankTransaction = {
        id: docId, ...baseRecord, status: 'unmatched',
        matchReason: `Trùng shortId (${students.length} HV) — admin cần xác nhận thủ công`,
      }
      await txRef.set(record)
      res.json({ success: true, status: 'unmatched' })
      return
    }

    const student = students[0]
    const txYear = Number((body.transactionDate || '').slice(0, 4)) || new Date().getFullYear()
    const records = await findTuitionRecords(student.id, parsed.month, txYear)

    if (records.length === 0) {
      const reason = `HV "${student.fullName}" (${student.id}) chưa có phiếu HP T${parsed.month}/${txYear} — admin vào trang Học phí bấm "Tạo phiếu" cho HV này, sau đó CK sẽ tự khớp lại.`
      const record: BankTransaction = {
        id: docId, ...baseRecord, status: 'unmatched',
        matchedStudentId: student.id,
        matchReason: reason,
      }
      await txRef.set(record)
      await notifyAdminUnmatched({ amount: Number(body.transferAmount) || 0, reason })
      res.json({ success: true, status: 'unmatched' })
      return
    }
    if (records.length > 1) {
      const reason = `HV "${student.fullName}" (${student.id}) có ${records.length} phiếu HP T${parsed.month}/${txYear} — admin cần phân bổ tay.`
      const record: BankTransaction = {
        id: docId, ...baseRecord, status: 'unmatched',
        matchedStudentId: student.id,
        matchReason: reason,
      }
      await txRef.set(record)
      await notifyAdminUnmatched({ amount: Number(body.transferAmount) || 0, reason })
      res.json({ success: true, status: 'unmatched' })
      return
    }

    // ✅ Match đúng 1 phiếu — tạo Payment + refresh trạng thái phiếu.
    const target = records[0]
    const amount = Number(body.transferAmount) || 0
    const now = new Date().toISOString()

    const paymentData: Omit<Payment, 'id'> = {
      tuitionRecordId: target.id,
      studentId: student.id,
      studentName: student.fullName,
      classId: target.classId,
      amount,
      paymentDate: (body.transactionDate || now).slice(0, 10),
      method: 'BANK_TRANSFER',
      notes: `Auto SePay #${body.referenceCode || body.id}`,
      createdAt: now,
    }
    const paymentRef = await db.collection(C.PAYMENTS).add(paymentData)

    await refreshTuitionStatus(target.id)

    const record: BankTransaction = {
      id: docId, ...baseRecord, status: 'matched',
      matchedStudentId: student.id,
      matchedTuitionRecordId: target.id,
      matchedPaymentId: paymentRef.id,
      matchReason: `Auto-confirm ${amount.toLocaleString('vi-VN')}đ cho phiếu T${parsed.month}/${txYear}`,
    }
    await txRef.set(record)

    await notifyAfterMatch({
      studentName: student.fullName,
      parentZalo: (student as any).primaryParentZalo || '',
      amount,
      month: parsed.month,
      tuitionRecordId: target.id,
    })

    // Case B — gửi ZNS xác nhận đã nhận thanh toán cho phụ huynh.
    // Wrapped trong try/catch để lỗi ZNS không phá response webhook.
    sendCaseBNotice({
      studentId:    student.id,
      studentName:  student.fullName,
      record:       target,
      amount,
      txDate:       body.transactionDate || now,
    }).catch(err => console.error('[ZNS] Case B failed:', err))

    res.json({ success: true, status: 'matched', paymentId: paymentRef.id })
  } catch (err) {
    next(err)
  }
})

/**
 * Gửi tin nhắn Zalo OA sau khi auto-confirm.
 * Test mode: SEPAY_NOTIFY_PARENTS != 'true' → không gửi cho phụ huynh, chỉ log.
 * Luôn gửi cho admin nếu SEPAY_NOTIFY_ADMIN_ZALO được set (Zalo user_id quản trị viên).
 */
async function notifyAfterMatch(params: {
  studentName: string
  parentZalo: string
  amount: number
  month: number
  tuitionRecordId: string
}): Promise<void> {
  const { studentName, parentZalo, amount, month, tuitionRecordId } = params
  const status = await getPaymentStatus(tuitionRecordId).catch(() => null)
  const remaining = status?.remaining ?? 0
  const remainText = remaining > 0
    ? `\nCòn nợ: ${remaining.toLocaleString('vi-VN')}đ`
    : `\n✓ Đã thanh toán đủ học phí tháng ${month}.`

  const parentMsg =
    `Trung tâm đã nhận ${amount.toLocaleString('vi-VN')}đ học phí tháng ${month} của ${studentName}.${remainText}`
  const adminMsg = `[SePay] +${amount.toLocaleString('vi-VN')}đ — ${studentName} T${month}.${remainText}`

  if (process.env.SEPAY_NOTIFY_PARENTS === 'true' && parentZalo) {
    await sendZaloMessage(parentZalo, parentMsg)
  } else {
    console.log('[SePay] Test mode — bỏ qua gửi Zalo cho phụ huynh:', parentMsg)
  }

  const adminZalo = process.env.SEPAY_NOTIFY_ADMIN_ZALO
  if (adminZalo) {
    await sendZaloMessage(adminZalo, adminMsg)
  }
}

/**
 * Case B — gửi ZNS xác nhận đã nhận thanh toán cho phụ huynh chính.
 * Skip gracefully khi:
 *   - Chưa cấu hình ZNS env vars
 *   - Chưa có template active cho use case B
 *   - Học viên không có SĐT phụ huynh
 */
async function sendCaseBNotice(input: {
  studentId:   string
  studentName: string
  record:      { id: string; billingMonth: number; billingYear: number }
  amount:      number
  txDate:      string
}): Promise<void> {
  const template = await findActiveTemplate('B')
  if (!template) {
    console.log('[ZNS] Case B skip: chưa có template active cho use case B')
    return
  }

  const recipient = await resolveRecipient(input.studentId)
  if (!recipient.phone) {
    console.warn(`[ZNS] Case B skip: HV ${input.studentId} không có SĐT phụ huynh`)
    return
  }

  // Format thời gian nhận: "DD/MM/YYYY HH:mm" (ICT input giả định)
  const d = new Date(input.txDate)
  const fmtTime = isNaN(d.getTime())
    ? input.txDate
    : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ` +
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

  const shortInvoiceId = input.record.id.slice(-8).toUpperCase()

  await sendZnsAndLog({
    studentId:    input.studentId,
    parentPhone:  recipient.phone,
    templateId:   template.id,
    useCase:      'B',
    invoiceId:    input.record.id,
    params: {
      ten_hoc_vien:    input.studentName,
      thang_nam:       `${input.record.billingMonth}/${input.record.billingYear}`,
      so_tien_da_nhan: input.amount,
      thoi_gian_nhan:  fmtTime,
      ma_phieu:        shortInvoiceId,
    },
  })
}

async function notifyAdminUnmatched(params: { amount: number; reason: string }): Promise<void> {
  const adminZalo = process.env.SEPAY_NOTIFY_ADMIN_ZALO
  const msg = `[SePay] CK ${params.amount.toLocaleString('vi-VN')}đ chưa khớp được:\n${params.reason}`
  if (adminZalo) {
    await sendZaloMessage(adminZalo, msg)
  } else {
    console.log('[SePay] Unmatched (no admin notify configured):', msg)
  }
}

export default router
