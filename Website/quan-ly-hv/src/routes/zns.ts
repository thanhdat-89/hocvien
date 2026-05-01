// =============================================================
// ZNS Admin Routes — quản lý template + xem log + test send
// =============================================================
// Tất cả endpoints yêu cầu role ADMIN.
// Template được Zalo duyệt qua portal ZCA — endpoint này chỉ
// lưu mapping (templateId → name + paramKeys + useCase) vào Firestore
// để các luồng nghiệp vụ (Case A/B/C) tham chiếu.

import { Router, Request, Response, NextFunction } from 'express'
import { db, C, serverTimestamp, toDocs, toObj, paginate, s } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import type { AuthRequest } from '../types'
import {
  sendZnsTemplate,
  normalizeVnPhone,
  ZNS_ENABLED,
  type ZnsParams,
} from '../services/zaloService'

const router = Router()

// ─── Cron: nhắc nhở học phí quá hạn (Case C) ─────────────────
// Đăng ký TRƯỚC authenticate để Vercel Cron gọi được bằng Bearer CRON_SECRET.
// Quy tắc: gửi reminder 5 ngày sau khi tạo phiếu, lặp lại mỗi 5 ngày,
// cap tối đa 5 lần. Sau cap → tạo admin_alert.
router.get('/cron/remind-overdue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expected = process.env.CRON_SECRET
    if (!expected || req.headers.authorization !== `Bearer ${expected}`) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }

    const result = await runOverdueReminderCron()
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// Đăng nhập là bắt buộc cho mọi endpoint còn lại; quyền theo từng endpoint.
router.use(authenticate)

type UseCase = 'A' | 'B' | 'C' | 'TEST'

interface ZnsTemplateDoc {
  id: string                  // = templateId Zalo cấp
  name: string
  useCase: UseCase
  paramKeys: string[]
  cost: number
  active: boolean
  note?: string
  createdAt?: string
  updatedAt?: string
}

interface ZnsLogDoc {
  id: string
  studentId?: string
  parentPhone: string
  parentPhoneIntl: string
  templateId: string
  useCase: UseCase
  invoiceId?: string
  reminderCount?: number
  params: Record<string, string>
  trackingId?: string
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'phone_invalid'
  msgId?: string | null
  error?: string | null
  createdAt?: string
  sentAt?: string
  deliveredAt?: string
}

// ─── Templates ───────────────────────────────────────────────

// GET /api/zns/templates
router.get('/templates', requireRole('ADMIN'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const snap = await db.collection(C.ZNS_TEMPLATES).orderBy('useCase').get()
    const templates = toDocs<ZnsTemplateDoc>(snap)
    res.json({ data: templates, total: templates.length })
  } catch (err) {
    next(err)
  }
})

// GET /api/zns/templates/:id
router.get('/templates/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = s(req.params.id)
    const doc = await db.collection(C.ZNS_TEMPLATES).doc(id).get()
    if (!doc.exists) {
      res.status(404).json({ message: 'Không tìm thấy template' })
      return
    }
    res.json(toObj<ZnsTemplateDoc>(doc))
  } catch (err) {
    next(err)
  }
})

// POST /api/zns/templates
// Body: { id, name, useCase, paramKeys[], cost?, active?, note? }
router.post('/templates', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, name, useCase, paramKeys, cost, active, note } = req.body as Partial<ZnsTemplateDoc>

    if (!id || !name || !useCase) {
      res.status(400).json({ message: 'id, name, useCase là bắt buộc' })
      return
    }
    if (!['A', 'B', 'C', 'TEST'].includes(useCase)) {
      res.status(400).json({ message: 'useCase phải là A, B, C, hoặc TEST' })
      return
    }

    const ref = db.collection(C.ZNS_TEMPLATES).doc(id)
    const existing = await ref.get()

    await ref.set({
      name,
      useCase,
      paramKeys: Array.isArray(paramKeys) ? paramKeys : [],
      cost: typeof cost === 'number' ? cost : 0,
      active: active ?? true,
      note: note ?? '',
      updatedAt: serverTimestamp(),
      ...(existing.exists ? {} : { createdAt: serverTimestamp() }),
    }, { merge: true })

    req.activity = { resourceType: 'zns', resourceId: id, description: `${existing.exists ? 'Cập nhật' : 'Tạo'} template ZNS: ${name}` }
    res.status(existing.exists ? 200 : 201).json({ id, updated: existing.exists })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/zns/templates/:id
router.patch('/templates/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = s(req.params.id)
    const ref = db.collection(C.ZNS_TEMPLATES).doc(id)
    const existing = await ref.get()
    if (!existing.exists) {
      res.status(404).json({ message: 'Không tìm thấy template' })
      return
    }

    const allowed = ['name', 'useCase', 'paramKeys', 'cost', 'active', 'note'] as const
    const update: Record<string, unknown> = { updatedAt: serverTimestamp() }
    for (const k of allowed) {
      if (k in req.body) update[k] = (req.body as Record<string, unknown>)[k]
    }

    await ref.update(update)
    req.activity = { resourceType: 'zns', resourceId: id, description: `Cập nhật template ZNS: ${id}` }
    res.json({ id })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/zns/templates/:id
router.delete('/templates/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = s(req.params.id)
    const ref = db.collection(C.ZNS_TEMPLATES).doc(id)
    const existing = await ref.get()
    if (!existing.exists) {
      res.status(404).json({ message: 'Không tìm thấy template' })
      return
    }
    await ref.delete()
    req.activity = { resourceType: 'zns', resourceId: id, description: `Xoá template ZNS: ${id}` }
    res.json({ id, deleted: true })
  } catch (err) {
    next(err)
  }
})

// ─── Test send ───────────────────────────────────────────────

// POST /api/zns/test-send
// Body: { phone, templateId, params, studentId? }
// Gửi 1 tin trực tiếp cho 1 SĐT — dùng để test sau khi cấu hình template.
router.post('/test-send', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { phone, templateId, params, studentId } = req.body as {
      phone?: string
      templateId?: string
      params?: ZnsParams
      studentId?: string
    }

    if (!phone || !templateId) {
      res.status(400).json({ message: 'phone và templateId là bắt buộc' })
      return
    }

    const result = await sendZnsAndLog({
      studentId,
      parentPhone: phone,
      templateId,
      useCase: 'TEST',
      params: params ?? {},
    })

    res.json({
      logId: result.logId,
      success: result.success,
      error: result.error,
      msgId: result.msgId,
      enabled: ZNS_ENABLED,
    })
  } catch (err) {
    next(err)
  }
})

// ─── Logs ────────────────────────────────────────────────────

// GET /api/zns/logs?useCase=A&status=failed&studentId=...&page=1&limit=20
router.get('/logs', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { useCase, status, studentId, invoiceId } = req.query as Record<string, string | undefined>
    const page  = Math.max(parseInt(s(req.query.page  as string) || '1', 10), 1)
    const limit = Math.min(Math.max(parseInt(s(req.query.limit as string) || '20', 10), 1), 100)

    // Lấy 500 log gần nhất rồi filter in-memory để tránh phải tạo nhiều composite index.
    const snap = await db.collection(C.ZNS_LOGS)
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get()
    let logs = toDocs<ZnsLogDoc>(snap)

    if (useCase)   logs = logs.filter(l => l.useCase === useCase)
    if (status)    logs = logs.filter(l => l.status === status)
    if (studentId) logs = logs.filter(l => l.studentId === studentId)
    if (invoiceId) logs = logs.filter(l => l.invoiceId === invoiceId)

    res.json(paginate(logs, page, limit))
  } catch (err) {
    next(err)
  }
})

// GET /api/zns/logs/:id
router.get('/logs/:id', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = s(req.params.id)
    const doc = await db.collection(C.ZNS_LOGS).doc(id).get()
    if (!doc.exists) {
      res.status(404).json({ message: 'Không tìm thấy log' })
      return
    }
    res.json(toObj<ZnsLogDoc>(doc))
  } catch (err) {
    next(err)
  }
})

// ─── Case A: Gửi thông báo học phí mới ───────────────────────

// Backend gửi student_id thuần (không kèm domain). Template ZBS tự ghép URL:
//   https://hocthemtoan.vn/hoc-vien/<student_id>
// trong nút thao tác hoặc trong nội dung. Format này được Zalo chấp nhận
// vì URL có prefix hợp lệ + biến chỉ chèn vào path.

function fmtMonth(m: number, y: number): string {
  return `${m}/${y}`
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function shortInvoiceId(id: string): string {
  return id.slice(-8).toUpperCase()
}

interface ParentLite {
  fullName?: string
  phone?: string | null
  zalo?: string | null
}

interface ResolvedRecipient {
  phone: string
  source: 'primary' | 'fallback' | 'none'
  parentName?: string
}

export async function resolveRecipient(studentId: string): Promise<ResolvedRecipient> {
  const studentDoc = await db.collection(C.STUDENTS).doc(studentId).get()
  if (!studentDoc.exists) return { phone: '', source: 'none' }
  const stu = studentDoc.data() as Record<string, unknown>

  const primaryPhone = (stu.primaryParentPhone as string | null | undefined)
                    || (stu.primaryParentZalo as string | null | undefined)
                    || ''
  if (primaryPhone) {
    return {
      phone: primaryPhone,
      source: 'primary',
      parentName: (stu.primaryParentName as string | undefined) ?? undefined,
    }
  }

  // Fallback: lấy SĐT/Zalo của bất kỳ parent nào trong subcollection
  const parentsSnap = await db.collection(C.STUDENTS).doc(studentId)
    .collection('parents').limit(5).get()
  for (const doc of parentsSnap.docs) {
    const p = doc.data() as ParentLite
    const phone = p.phone || p.zalo
    if (phone) {
      return { phone, source: 'fallback', parentName: p.fullName }
    }
  }

  return { phone: '', source: 'none' }
}

export async function findActiveTemplate(useCase: UseCase): Promise<{ id: string; name: string } | null> {
  // In-memory filter để không cần composite index
  const snap = await db.collection(C.ZNS_TEMPLATES).get()
  for (const doc of snap.docs) {
    const t = doc.data() as { useCase?: string; active?: boolean; name?: string }
    if (t.useCase === useCase && t.active === true) {
      return { id: doc.id, name: t.name ?? doc.id }
    }
  }
  return null
}

// POST /api/zns/tuition-notice
// Body: { tuitionRecordId, useCase? = 'A' }
// ADMIN/STAFF gửi thông báo Zalo cho 1 phiếu học phí cụ thể.
router.post('/tuition-notice', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tuitionRecordId, useCase = 'A' } = req.body as { tuitionRecordId?: string; useCase?: UseCase }

    if (!tuitionRecordId) {
      res.status(400).json({ message: 'tuitionRecordId là bắt buộc' })
      return
    }
    if (useCase !== 'A' && useCase !== 'C') {
      res.status(400).json({ message: 'useCase phải là A hoặc C' })
      return
    }

    // 1. Phiếu học phí
    const recordDoc = await db.collection(C.TUITION_RECORDS).doc(tuitionRecordId).get()
    if (!recordDoc.exists) {
      res.status(404).json({ message: 'Không tìm thấy phiếu học phí' })
      return
    }
    const record = { id: recordDoc.id, ...(recordDoc.data() as Record<string, unknown>) } as {
      id: string
      studentId: string
      studentName?: string
      billingMonth: number
      billingYear: number
      chargedSessions?: number
      baseAmount?: number
      finalAmount: number
      dueDate?: string
    }

    // 2. SĐT phụ huynh
    const recipient = await resolveRecipient(record.studentId)
    if (!recipient.phone) {
      res.status(400).json({ message: 'Học viên không có SĐT phụ huynh để gửi Zalo' })
      return
    }

    // 3. Template active
    const template = await findActiveTemplate(useCase)
    if (!template) {
      res.status(400).json({
        message: `Chưa cấu hình template active cho use case ${useCase}. Vào /zns → Templates → Thêm template.`,
      })
      return
    }

    // 4. Render params
    const charged   = Number(record.chargedSessions) || 0
    const base      = Number(record.baseAmount)      || 0
    const final     = Number(record.finalAmount)     || 0
    const unitPrice = charged > 0 ? Math.round(base / charged) : 0

    let params: ZnsParams
    if (useCase === 'A') {
      params = {
        ten_hoc_vien:    record.studentName ?? '',
        thang_nam:       fmtMonth(record.billingMonth, record.billingYear),
        so_buoi:         charged,
        don_gia:         unitPrice,
        tong_tien:       final,
        han_thanh_toan:  fmtDate(record.dueDate),
        ma_phieu:        shortInvoiceId(record.id),
        student_id:      record.studentId,
      }
    } else {
      // useCase === 'C' — overdue reminder. Tính số tiền còn lại + số ngày quá hạn.
      const paymentsSnap = await db.collection(C.PAYMENTS)
        .where('tuitionRecordId', '==', record.id).get()
      const totalPaid = paymentsSnap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0)
      const remaining = Math.max(final - totalPaid, 0)

      const dueIso = record.dueDate
      let overdueDays = 0
      if (dueIso) {
        const diffMs = Date.now() - new Date(dueIso).getTime()
        overdueDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
      }

      params = {
        ten_hoc_vien:              record.studentName ?? '',
        thang_nam:                 fmtMonth(record.billingMonth, record.billingYear),
        so_tien_can_thanh_toan:    remaining,
        so_ngay_qua_han:           overdueDays,
        ma_phieu:                  shortInvoiceId(record.id),
        student_id:                record.studentId,
      }
    }

    // 5. Gửi + log
    const result = await sendZnsAndLog({
      studentId:    record.studentId,
      parentPhone:  recipient.phone,
      templateId:   template.id,
      useCase,
      invoiceId:    record.id,
      params,
    })

    res.json({
      success:        result.success,
      logId:          result.logId,
      msgId:          result.msgId,
      error:          result.error,
      recipientSource: recipient.source,
      recipientName:  recipient.parentName ?? null,
      templateName:   template.name,
    })
  } catch (err) {
    next(err)
  }
})

// ─── Status ──────────────────────────────────────────────────

// GET /api/zns/status — kiểm tra cấu hình
router.get('/status', requireRole('ADMIN', 'STAFF'), (_req: AuthRequest, res: Response) => {
  res.json({
    enabled: ZNS_ENABLED,
    appIdSet: Boolean(process.env.ZNS_APP_ID),
    accessTokenSet: Boolean(process.env.ZNS_ACCESS_TOKEN),
    refreshTokenSet: Boolean(process.env.ZNS_REFRESH_TOKEN),
    webhookSecretSet: Boolean(process.env.ZNS_WEBHOOK_SECRET),
  })
})

export default router

// ─── Helper: gửi + log ───────────────────────────────────────
// Dùng nội bộ ở /test-send và sẽ tái sử dụng cho Phase 3/4/5.
// Để ở cuối file route để Phase tiếp theo có thể import từ đây.

export interface SendAndLogInput {
  studentId?: string
  parentPhone: string
  templateId: string
  useCase: UseCase
  invoiceId?: string
  reminderCount?: number
  params: ZnsParams
}

export interface SendAndLogResult {
  logId: string
  success: boolean
  msgId?: string
  error?: string
}

export async function sendZnsAndLog(input: SendAndLogInput): Promise<SendAndLogResult> {
  const phone84 = normalizeVnPhone(input.parentPhone)
  const trackingId = `${input.useCase}_${input.studentId ?? 'na'}_${Date.now()}`

  const logRef = db.collection(C.ZNS_LOGS).doc()
  const stringParams: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.params)) {
    stringParams[k] = String(v ?? '')
  }

  const baseLog: Record<string, unknown> = {
    studentId: input.studentId,
    parentPhone: input.parentPhone,
    parentPhoneIntl: phone84,
    templateId: input.templateId,
    useCase: input.useCase,
    invoiceId: input.invoiceId,
    reminderCount: input.reminderCount,
    params: stringParams,
    trackingId,
    status: 'queued',
    createdAt: serverTimestamp(),
  }
  await logRef.set(baseLog)

  if (!phone84 || phone84.length < 10) {
    await logRef.update({
      status: 'phone_invalid',
      error: 'Số điện thoại không hợp lệ',
      sentAt: serverTimestamp(),
    })
    return { logId: logRef.id, success: false, error: 'INVALID_PHONE' }
  }

  const result = await sendZnsTemplate(phone84, input.templateId, input.params, trackingId)

  await logRef.update({
    status: result.success ? 'sent' : 'failed',
    msgId: result.msgId ?? null,
    error: result.error ?? null,
    sentAt: serverTimestamp(),
  })

  return {
    logId: logRef.id,
    success: result.success,
    msgId: result.msgId,
    error: result.error,
  }
}

// ─── Cron: Case C overdue reminder runner ────────────────────

const REMINDER_INTERVAL_DAYS = 5
const REMINDER_CAP            = 5

interface OverdueCronResult {
  total:        number
  sent:         number
  skippedTooSoon: number
  skippedNoPhone: number
  skippedNoTemplate: number
  capped:       number
  failed:       number
  details:      Array<{ invoiceId: string; status: string; reason?: string }>
}

async function runOverdueReminderCron(): Promise<OverdueCronResult> {
  const result: OverdueCronResult = {
    total: 0, sent: 0, skippedTooSoon: 0, skippedNoPhone: 0,
    skippedNoTemplate: 0, capped: 0, failed: 0, details: [],
  }

  const template = await findActiveTemplate('C')
  if (!template) {
    console.warn('[ZNS][cron] Skip: chưa có template active cho use case C')
    result.skippedNoTemplate = -1 // signal toàn bộ skip do thiếu template
    return result
  }

  // Lấy tất cả phiếu chưa thanh toán đủ
  const recordsSnap = await db.collection(C.TUITION_RECORDS)
    .where('status', 'in', ['PENDING', 'PARTIAL', 'OVERDUE'])
    .get()
  result.total = recordsSnap.size

  const nowMs = Date.now()
  const dayMs = 1000 * 60 * 60 * 24

  for (const rDoc of recordsSnap.docs) {
    const rec = toObj<{
      studentId: string
      studentName?: string
      billingMonth: number
      billingYear: number
      finalAmount: number
      dueDate?: string
      createdAt?: string
      status: string
    }>(rDoc)

    // Đếm số reminder Case C đã gửi (sent + delivered)
    const priorSnap = await db.collection(C.ZNS_LOGS)
      .where('invoiceId', '==', rec.id)
      .where('useCase', '==', 'C')
      .get()
    let priorCount  = 0
    let lastSentMs  = 0
    for (const lDoc of priorSnap.docs) {
      const lg = toObj<{ status: string; sentAt?: string }>(lDoc)
      if (lg.status === 'sent' || lg.status === 'delivered') {
        priorCount++
        const ms = lg.sentAt ? Date.parse(lg.sentAt) : 0
        if (ms > lastSentMs) lastSentMs = ms
      }
    }

    // Cap: đã gửi 5 lần → tạo admin_alert (idempotent), skip
    if (priorCount >= REMINDER_CAP) {
      const alertSnap = await db.collection(C.ADMIN_ALERTS)
        .where('type', '==', 'overdue_reminder_cap')
        .where('invoiceId', '==', rec.id)
        .limit(1)
        .get()
      if (alertSnap.empty) {
        await db.collection(C.ADMIN_ALERTS).add({
          type:        'overdue_reminder_cap',
          invoiceId:   rec.id,
          studentId:   rec.studentId,
          studentName: rec.studentName ?? '',
          billingMonth: rec.billingMonth,
          billingYear:  rec.billingYear,
          reminderCount: priorCount,
          message: `Phiếu T${rec.billingMonth}/${rec.billingYear} của ${rec.studentName ?? ''} đã gửi đủ ${REMINDER_CAP} lần nhắc Zalo nhưng chưa thanh toán.`,
          read:        false,
          createdAt:   serverTimestamp(),
        })
      }
      result.capped++
      result.details.push({ invoiceId: rec.id, status: 'capped' })
      continue
    }

    // Tính ngày tham chiếu: lần gửi gần nhất, hoặc createdAt
    const refMs = lastSentMs > 0 ? lastSentMs : (rec.createdAt ? Date.parse(rec.createdAt) : 0)
    if (!refMs) {
      result.skippedTooSoon++
      result.details.push({ invoiceId: rec.id, status: 'skipped', reason: 'no createdAt' })
      continue
    }
    const daysSinceRef = (nowMs - refMs) / dayMs
    if (daysSinceRef < REMINDER_INTERVAL_DAYS) {
      result.skippedTooSoon++
      continue
    }

    // Compute remaining + overdue days
    const paymentsSnap = await db.collection(C.PAYMENTS)
      .where('tuitionRecordId', '==', rec.id).get()
    const totalPaid = paymentsSnap.docs.reduce((s, d) => s + (Number(d.data().amount) || 0), 0)
    const remaining = Math.max((Number(rec.finalAmount) || 0) - totalPaid, 0)
    if (remaining <= 0) {
      // Đã trả đủ nhưng status chưa cập nhật — skip (sẽ refresh lần sau).
      result.details.push({ invoiceId: rec.id, status: 'skipped', reason: 'remaining=0' })
      continue
    }

    const overdueRef = rec.dueDate || rec.createdAt
    const overdueDays = overdueRef
      ? Math.max(0, Math.floor((nowMs - Date.parse(overdueRef)) / dayMs))
      : 0

    // Resolve recipient
    const recipient = await resolveRecipient(rec.studentId)
    if (!recipient.phone) {
      result.skippedNoPhone++
      result.details.push({ invoiceId: rec.id, status: 'skipped', reason: 'no phone' })
      continue
    }

    const sendResult = await sendZnsAndLog({
      studentId:     rec.studentId,
      parentPhone:   recipient.phone,
      templateId:    template.id,
      useCase:       'C',
      invoiceId:     rec.id,
      reminderCount: priorCount + 1,
      params: {
        ten_hoc_vien:           rec.studentName ?? '',
        thang_nam:              `${rec.billingMonth}/${rec.billingYear}`,
        so_tien_can_thanh_toan: remaining,
        so_ngay_qua_han:        overdueDays,
        ma_phieu:               rec.id.slice(-8).toUpperCase(),
        student_id:             rec.studentId,
      },
    })

    if (sendResult.success) {
      result.sent++
      result.details.push({ invoiceId: rec.id, status: 'sent' })
    } else {
      result.failed++
      result.details.push({ invoiceId: rec.id, status: 'failed', reason: sendResult.error })
    }
  }

  console.log('[ZNS][cron] Overdue reminder run:', result)
  return result
}
