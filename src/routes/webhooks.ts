// =============================================================
// Public webhook endpoints — KHÔNG đi qua requireAuth
// =============================================================

import { Router, Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/db'
import type { BankTransaction } from '../types/models'
import { authenticate, requireRole } from '../middleware/auth'

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
  // req.ip (với `trust proxy` = loopback) là IP thật nginx thấy. Không đọc thẳng phần đầu X-Forwarded-For:
  // client tự điền được phần đó, nginx chỉ nối thêm IP thật vào cuối.
  const ip = (req.ip || '').replace(/^::ffff:/, '')
  return SEPAY_IPS.has(ip)
}

// GET /api/webhooks/sepay/status — trang Cài đặt; chỉ báo biến nào đã có, không trả giá trị.
router.get('/sepay/status', authenticate, requireRole('ADMIN'), (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    webhookKeySet: Boolean(process.env.SEPAY_WEBHOOK_KEY),
    ipCheck: process.env.SEPAY_SKIP_IP_CHECK !== 'true',
    mode: 'journal_only',
  })
})

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

    // Idempotency: nếu đã xử lý trước đó (do retry) → trả 200 ngay.
    const existing = await prisma.bankTransaction.findUnique({ where: { sepayId: BigInt(body.id) }, select: { id: true } })
    if (existing) {
      res.json({ success: true, idempotent: true })
      return
    }

    // Giai đoạn thử nghiệm: chỉ lưu giao dịch SePay, không ghi học phí hay tạo hóa đơn.
    const saveTx = async (record: BankTransaction) => {
      try {
        await prisma.bankTransaction.create({
          data: {
            ...record, sepayId: BigInt(record.sepayId), accumulated: BigInt(record.accumulated),
            transactionDate: new Date(String(record.transactionDate).replace(' ', 'T') + 'Z'),
            receivedAt: new Date(record.receivedAt),
          },
        })
        return { duplicate: false }
      } catch (err: any) {
        if (err?.code === 'P2002') return { duplicate: true }
        throw err
      }
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

    const status = body.transferType === 'out' ? 'ignored_outbound' : 'pending_review'
    const record: BankTransaction = { id: docId, ...baseRecord, status }
    if ((await saveTx(record)).duplicate) { res.json({ success: true, idempotent: true }); return }
    res.json({ success: true, status })
  } catch (err) {
    next(err)
  }
})

export default router
