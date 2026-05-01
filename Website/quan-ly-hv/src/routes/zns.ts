// =============================================================
// ZNS Admin Routes — quản lý template + xem log + test send
// =============================================================
// Tất cả endpoints yêu cầu role ADMIN.
// Template được Zalo duyệt qua portal ZCA — endpoint này chỉ
// lưu mapping (templateId → name + paramKeys + useCase) vào Firestore
// để các luồng nghiệp vụ (Case A/B/C) tham chiếu.

import { Router, Response, NextFunction } from 'express'
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

// Mọi endpoint dưới đây đều yêu cầu admin đăng nhập.
router.use(authenticate)
router.use(requireRole('ADMIN'))

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
router.get('/templates', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const snap = await db.collection(C.ZNS_TEMPLATES).orderBy('useCase').get()
    const templates = toDocs<ZnsTemplateDoc>(snap)
    res.json({ data: templates, total: templates.length })
  } catch (err) {
    next(err)
  }
})

// GET /api/zns/templates/:id
router.get('/templates/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
router.post('/templates', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
router.patch('/templates/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
router.delete('/templates/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
router.post('/test-send', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
router.get('/logs', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
router.get('/logs/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
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

// ─── Status ──────────────────────────────────────────────────

// GET /api/zns/status — kiểm tra cấu hình
router.get('/status', (_req: AuthRequest, res: Response) => {
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
