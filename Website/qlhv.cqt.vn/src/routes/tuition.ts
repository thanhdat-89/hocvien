import { getCachedTuitionSummary } from '../services/tuitionReadView'
import { misaConnectionStatus, checkMisaConnection } from '../services/misaConnection'
import misaDrafts from './misaDrafts'
import { tryCreateAutomaticMisaDraft } from '../services/misaAutoDraft'
import { activityContext } from '../middleware/activityContext'
import { getTuitionWorkflowResult } from '../services/tuitionWorkflowResult'
import { validPeriod } from '../services/readViews'
import { Router, Response, NextFunction } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma, api, newId, toDay, toClassId, fromClassId } from '../lib/db'
import { paymentDoc, paymentInclude, studentPromotionDoc, studentPromotionInclude, tuitionRecordDoc, tuitionRecordInclude } from '../lib/docs'
import { s } from '../lib/params'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { TuitionRecord } from '../types/models'
import {
  calculateTuitionForStudent,
  calculateTuitionForClass,
  clearPayments,
  getPaymentStatus,
  recordPayment,
  refreshTuitionStatus,
} from '../services/tuitionCalculator'

const router = Router()
router.use(authenticate)
router.use(activityContext)
router.use('/misa', misaDrafts)

router.get('/workflow-result', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { studentId, classId, recordId } = req.query
    const month = Number(req.query.month), year = Number(req.query.year)
    if (typeof studentId !== 'string' || !studentId || typeof classId !== 'string' || !classId || !validPeriod(month, year)
      || (recordId !== undefined && typeof recordId !== 'string')) {
      res.status(400).json({ message: 'Thông tin đối chiếu phiếu không hợp lệ.' }); return
    }
    res.setHeader('Cache-Control', 'no-store')
    const result = await getTuitionWorkflowResult({ studentId, classId, month, year, recordId: recordId as string | undefined })
    if (!result) { res.status(404).json({ message: 'Chưa tìm thấy phiếu. Kiểm tra lại trước khi thực hiện lại.' }); return }
    res.json(result)
  } catch (error) { next(error) }
})

router.get('/misa/connection', requireRole('ADMIN'), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(misaConnectionStatus())
})

const misaCheckTimes = new Map<string, number>()
router.post('/misa/connection/check', requireRole('ADMIN'), async (req: AuthRequest, res) => {
  const product = req.body?.product
  if (product !== 'meinvoice' && product !== 'esign') {
    res.status(400).json({ message: 'Sản phẩm không hợp lệ' }); return
  }
  const otp = req.body?.otp
  if (otp !== undefined && (product !== 'esign' || !otp || typeof otp.code !== 'string'
    || !/^\d{6}$/.test(otp.code) || ![0, 1].includes(otp.otpType))) {
    res.status(400).json({ message: 'OTP phải có 6 chữ số và đúng loại xác thực.' }); return
  }
  // Login and OTP are consecutive steps, not repeated attempts at the same step.
  const checkKey = `${req.user!.userId}:${product}:${otp ? 'otp' : 'login'}`
  const checkedAt = Date.now()
  for (const [key, at] of misaCheckTimes) if (checkedAt - at >= 30000) misaCheckTimes.delete(key)
  const retryAfter = Math.ceil((30000 - (checkedAt - (misaCheckTimes.get(checkKey) ?? 0))) / 1000)
  if (retryAfter > 0) {
    res.setHeader('Retry-After', String(retryAfter))
    res.status(429).json({ message: `Chờ ${retryAfter} giây trước khi thử lại bước này.`, retryAfter }); return
  }
  misaCheckTimes.set(checkKey, checkedAt)
  res.setHeader('Cache-Control', 'no-store')
  res.json(await checkMisaConnection(product, fetch, otp))
})

// GET /api/tuition
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = '1', limit = '20', studentId, classId, month, year, status } = req.query as Record<string, string>

    const where: Prisma.TuitionRecordWhereInput = {}
    if (studentId) where.studentId = studentId
    if (classId) where.classId = toClassId(classId)
    if (month) where.billingMonth = Number(month)
    if (year) where.billingYear = Number(year)
    if (status) where.status = status as TuitionRecord['status']

    const pageNum = Number(page), limitNum = Number(limit)
    const [total, records] = await prisma.$transaction([
      prisma.tuitionRecord.count({ where }),
      prisma.tuitionRecord.findMany({
        where, include: tuitionRecordInclude, orderBy: [{ billingYear: 'desc' }, { billingMonth: 'desc' }],
        skip: (pageNum - 1) * limitNum, take: limitNum,
      }),
    ])
    res.json({ data: records.map(tuitionRecordDoc), total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) })
  } catch (err) { next(err) }
})

// GET /api/tuition/schedule-summary?month=X&year=Y
router.get('/schedule-summary', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const month = Number(req.query.month)
    const year = Number(req.query.year)
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) {
      res.status(400).json({ message: 'Month/year không hợp lệ' }); return
    }
    res.json((await getCachedTuitionSummary(month, year, req.query.force === 'true')).rows)
  } catch (err) { next(err) }
})

// GET /api/tuition/student-promotions?studentId=X
router.get('/student-promotions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { studentId } = req.query as Record<string, string>
    if (!studentId) { res.status(400).json({ message: 'Cần studentId' }); return }
    const list = await prisma.studentPromotion.findMany({ where: { studentId }, include: studentPromotionInclude, orderBy: { appliedFrom: 'desc' } })
    res.json(list.map(studentPromotionDoc))
  } catch (err) { next(err) }
})

// POST /api/tuition/student-promotions/direct — tạo promotion và assign cho học viên trong 1 bước
router.post('/student-promotions/direct', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { studentId, classId, type, value, appliedFrom, appliedTo, notes } = req.body
    if (!studentId || !classId || !type || !value || !appliedFrom) {
      res.status(400).json({ message: 'Cần studentId, classId, type, value, appliedFrom' }); return
    }

    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true } })
    if (!student) {
      res.status(404).json({ message: 'Không tìm thấy học viên' }); return
    }

    let className: string
    if (classId === 'private') {
      className = 'Học riêng'
    } else {
      const cls = await prisma.class.findUnique({ where: { id: classId }, select: { name: true } })
      if (!cls) {
        res.status(404).json({ message: 'Không tìm thấy lớp học' }); return
      }
      className = cls.name
    }
    const promoName = type === 'PERCENTAGE'
      ? `Giảm ${value}% - ${className}`
      : `Giảm ${Number(value).toLocaleString('vi-VN')}đ - ${className}`

    // Tạo promotion và assign cho học viên — cùng một transaction
    const promotionId = newId()
    const [, assigned] = await prisma.$transaction([
      prisma.promotion.create({ data: { id: promotionId, name: promoName, type, value: Number(value), isActive: true } }),
      prisma.studentPromotion.create({
        data: {
          id: newId(), studentId, classId: toClassId(classId), className,
          promotionId, promotionName: promoName, promotionType: type, promotionValue: Number(value),
          appliedFrom: toDay(appliedFrom)!, appliedTo: toDay(appliedTo),
          approvedById: req.user!.userId, notes: notes || undefined,
        },
        include: studentPromotionInclude,
      }),
    ])
    res.status(201).json(studentPromotionDoc(assigned))
  } catch (err) { next(err) }
})

// DELETE /api/tuition/student-promotions/:id
router.delete('/student-promotions/:id', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.studentPromotion.deleteMany({ where: { id: s(req.params.id) } })
    res.json({ message: 'Đã xoá khuyến mại' })
  } catch (err) { next(err) }
})

// GET /api/tuition/list/overdue
router.get('/list/overdue', async (_req, res: Response, next: NextFunction) => {
  try {
    const today = toDay(new Date().toISOString().slice(0, 10))!
    const [records, paid] = await Promise.all([
      prisma.tuitionRecord.findMany({
        where: { dueDate: { lt: today }, status: { in: ['PENDING', 'PARTIAL'] } },
        include: tuitionRecordInclude, orderBy: { dueDate: 'asc' },
      }),
      prisma.payment.groupBy({ by: ['tuitionRecordId'], where: { tuitionRecord: { dueDate: { lt: today }, status: { in: ['PENDING', 'PARTIAL'] } } }, _sum: { amount: true } }),
    ])
    const paidByRecord = new Map(paid.map(p => [p.tuitionRecordId, p._sum.amount ?? 0]))
    res.json(records.map(r => ({ ...tuitionRecordDoc(r), remaining: r.finalAmount - (paidByRecord.get(r.id) ?? 0) })))
  } catch (err) { next(err) }
})

// GET /api/tuition/promotions/list
router.get('/promotions/list', async (_req, res: Response, next: NextFunction) => {
  try {
    const promotions = await prisma.promotion.findMany({ where: { isActive: true } })
    res.json(api(promotions.sort((a, b) => a.name.localeCompare(b.name))))
  } catch (err) { next(err) }
})

// GET /api/tuition/:id
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const record = await prisma.tuitionRecord.findUnique({ where: { id: s(req.params.id) }, include: tuitionRecordInclude })
    if (!record) { res.status(404).json({ message: 'Không tìm thấy phiếu học phí' }); return }

    const payments = await prisma.payment.findMany({ where: { tuitionRecordId: record.id }, include: paymentInclude, orderBy: { paymentDate: 'desc' } })
    const paymentStatus = await getPaymentStatus(record.id)
    res.json({ ...tuitionRecordDoc(record), payments: payments.map(paymentDoc), paymentStatus })
  } catch (err) { next(err) }
})

// POST /api/tuition/calculate-bulk — tạo phiếu cho nhiều lớp cùng lúc, có password gate
router.post('/calculate-bulk', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { month, year, classIds, password } = req.body as {
      month: number; year: number; classIds: string[]; password: string
    }
    if (!month || !year || !Array.isArray(classIds) || classIds.length === 0) {
      res.status(400).json({ message: 'Cần month, year, classIds[]' })
      return
    }
    const expected = process.env.TUITION_BULK_PASSWORD
    if (!expected) {
      res.status(500).json({ message: 'Chưa cấu hình TUITION_BULK_PASSWORD trên server' })
      return
    }
    if ((password || '') !== expected) {
      res.status(401).json({ message: 'Mật khẩu xác nhận không đúng' })
      return
    }

    let created = 0, updated = 0, failed = 0
    const invoiceDrafts: any[] = []
    for (const classId of classIds) {
      try {
        const r = await calculateTuitionForClass(classId, Number(month), Number(year))
        created += r.created
        updated += r.updated
        for (const recordId of r.newRecordIds) invoiceDrafts.push(await tryCreateAutomaticMisaDraft(recordId, req.user!.userId))
      } catch (e) {
        failed++
        console.error('[bulk-create] failed for class', classId, e)
      }
    }
    res.json({ created, updated, failed, classCount: classIds.length, invoiceDrafts })
  } catch (err) { next(err) }
})

async function getReceiverName(userId?: string): Promise<string> {
  if (!userId || typeof userId !== 'string' || !userId.trim()) return 'Quản trị viên'
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } })
    return user?.fullName || 'Quản trị viên'
  } catch {
    return 'Quản trị viên'
  }
}

const loadRecord = async (id: string) => {
  const record = await prisma.tuitionRecord.findUnique({ where: { id }, include: tuitionRecordInclude })
  return record ? tuitionRecordDoc(record) as TuitionRecord & { id: string } : null
}

// POST /api/tuition/toggle-paid — Toggle checkbox đóng học phí
router.post('/toggle-paid', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { studentId, classId, month, year, paid, tuitionRecordId } = req.body as {
      studentId: string; classId: string; month: number; year: number; paid: boolean; tuitionRecordId?: string
    }
    console.log('[toggle-paid] REQUEST:', JSON.stringify({ studentId, classId, month, year, paid, tuitionRecordId }))
    if (!studentId || !classId || !month || !year) {
      res.status(400).json({ message: 'Cần studentId, classId, month, year' })
      return
    }

    let record: TuitionRecord & { id: string }
    let recordExistedBefore = false

    // 1. Ưu tiên dùng tuitionRecordId nếu frontend gửi lên
    if (tuitionRecordId) {
      const found = await loadRecord(tuitionRecordId)
      if (found) {
        recordExistedBefore = true
        record = found
      } else {
        res.status(404).json({ message: 'Không tìm thấy phiếu học phí' })
        return
      }
    } else {
      // 2. Fallback: tìm theo studentId/classId/month/year
      const existing = await prisma.tuitionRecord.findFirst({
        where: { studentId, classId: toClassId(classId), billingMonth: Number(month), billingYear: Number(year) }, select: { id: true },
      })

      if (existing) {
        recordExistedBefore = true
        record = (await loadRecord(existing.id))!
      } else {
        // 3. Cuối cùng mới thử tạo mới qua calculateTuitionForStudent
        try {
          const calcResult = await calculateTuitionForStudent(studentId, classId, Number(month), Number(year))
          record = calcResult.tuitionRecord
        } catch (calcErr: any) {
          res.status(400).json({ message: calcErr.message || 'Không thể tạo phiếu học phí cho học viên này' })
          return
        }
      }
    }

    if (paid) {
      await recordPayment(record.id, {
        amount: 'remaining', method: 'CASH', receivedById: req.user?.userId,
        receivedByName: await getReceiverName(req.user?.userId), notes: 'Xác nhận đóng đủ học phí qua checkbox',
      })
    } else {
      await clearPayments(record.id)
    }

    const finalStatus = await getPaymentStatus(record.id)
    let invoiceDraft = recordExistedBefore
      ? { enabled: true, status: 'SKIPPED_EXISTING_RECORD', message: 'Phiếu đã tồn tại; chỉ cập nhật thanh toán, không tạo lại hóa đơn nháp MISA.' }
      : await tryCreateAutomaticMisaDraft(record.id, req.user!.userId)
    if (!recordExistedBefore && ['FAILED', 'OUTCOME_UNKNOWN'].includes(invoiceDraft.status)) {
      invoiceDraft = { ...invoiceDraft, message: `Phiếu mới đã được tạo. ${invoiceDraft.message || 'Chưa hoàn tất xử lý hóa đơn MISA.'}` }
    }
    res.json({ recordId: record.id, paid, finalStatus, recordCreated: !recordExistedBefore, invoiceDraft })
  } catch (err: any) {
    console.error('[toggle-paid] ERROR:', err?.message || err)
    next(err)
  }
})

// POST /api/tuition/calculate
router.post('/calculate', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { studentId, classId, month, year, paid } = req.body
    if (!classId || !month || !year) { res.status(400).json({ message: 'Cần classId, month, year' }); return }

    if (studentId) {
      const { tuitionRecord, isNew } = await calculateTuitionForStudent(studentId, classId, Number(month), Number(year))

      if (typeof paid === 'boolean') {
        if (paid) {
          await recordPayment(tuitionRecord.id, {
            amount: 'remaining', method: 'CASH', receivedById: req.user?.userId,
            receivedByName: await getReceiverName(req.user?.userId), notes: 'Xác nhận đóng đủ học phí qua checkbox',
          })
          tuitionRecord.status = 'PAID'
        } else {
          await clearPayments(tuitionRecord.id)
          tuitionRecord.status = 'PENDING'
        }
      }

      const invoiceDraft = isNew
        ? await tryCreateAutomaticMisaDraft(tuitionRecord.id, req.user!.userId)
        : { enabled: true, status: 'SKIPPED_EXISTING_RECORD', message: 'Phiếu đã tồn tại; không tạo lại hóa đơn nháp MISA.' }
      res.json({ ...tuitionRecord, invoiceDraft, isNew })
    } else {
      const result = await calculateTuitionForClass(classId, Number(month), Number(year))
      const invoiceDrafts = []
      for (const recordId of result.newRecordIds) invoiceDrafts.push(await tryCreateAutomaticMisaDraft(recordId, req.user!.userId))
      res.json({ message: `Tạo ${result.created} phiếu mới, cập nhật ${result.updated} phiếu`, ...result, invoiceDrafts })
    }
  } catch (err) { next(err) }
})

// POST /api/tuition/:id/payment — Ghi nhận thanh toán
router.post('/:id/payment', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tuitionRecordId = s(req.params.id)
    const { amount, paymentDate, method, notes } = req.body as { amount: number; paymentDate?: string; method?: string; notes?: string }

    if (!amount || Number(amount) <= 0) { res.status(400).json({ message: 'Số tiền không hợp lệ' }); return }

    const record = await prisma.tuitionRecord.findUnique({ where: { id: tuitionRecordId }, select: { id: true } })
    if (!record) { res.status(404).json({ message: 'Không tìm thấy phiếu học phí' }); return }

    const payment = await recordPayment(tuitionRecordId, {
      amount: Number(amount), paymentDate, method, notes, receivedById: req.user?.userId,
      receivedByName: await getReceiverName(req.user?.userId),
    })

    const { remaining, status } = await getPaymentStatus(tuitionRecordId)
    const invoiceDraft = remaining <= 0 ? await tryCreateAutomaticMisaDraft(tuitionRecordId, req.user!.userId) : undefined
    const created = await prisma.payment.findUniqueOrThrow({ where: { id: payment!.id }, include: paymentInclude })
    res.status(201).json({ payment: paymentDoc(created), status, remaining, invoiceDraft })
  } catch (err) { next(err) }
})

// DELETE /api/tuition/payment/:paymentId
router.delete('/payment/:paymentId', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: s(req.params.paymentId) }, select: { id: true, tuitionRecordId: true } })
    if (!payment) { res.status(404).json({ message: 'Không tìm thấy giao dịch' }); return }

    await prisma.$transaction(async tx => {
      await tx.payment.delete({ where: { id: payment.id } })
      await refreshTuitionStatus(payment.tuitionRecordId, tx)
    })

    res.json({ message: 'Đã xoá giao dịch thanh toán' })
  } catch (err) { next(err) }
})

// ─── PROMOTIONS ────────────────────────────────────────────────

// POST /api/tuition/promotions
router.post('/promotions', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, type, value, conditions, validFrom, validTo } = req.body
    const promotion = await prisma.promotion.create({
      data: { id: newId(), name, type, value: Number(value), conditions, validFrom: toDay(validFrom), validTo: toDay(validTo), isActive: true },
    })
    res.status(201).json(api(promotion))
  } catch (err) { next(err) }
})

// POST /api/tuition/student-promotions
router.post('/student-promotions', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { studentId, classId, promotionId, appliedFrom, appliedTo, notes } = req.body

    const [promo, cls] = await Promise.all([
      prisma.promotion.findUnique({ where: { id: promotionId } }),
      classId && classId !== 'private' ? prisma.class.findUnique({ where: { id: classId }, select: { name: true } }) : null,
    ])

    if (!promo) { res.status(404).json({ message: 'Không tìm thấy khuyến mãi' }); return }

    const assigned = await prisma.studentPromotion.create({
      data: {
        id: newId(), studentId, classId: toClassId(classId), className: cls?.name ?? (fromClassId(toClassId(classId)) === 'private' ? 'Học riêng' : null),
        promotionId, promotionName: promo.name, promotionType: promo.type, promotionValue: promo.value,
        appliedFrom: toDay(appliedFrom)!, appliedTo: toDay(appliedTo),
        approvedById: req.user!.userId, notes,
      },
      include: studentPromotionInclude,
    })
    res.status(201).json(studentPromotionDoc(assigned))
  } catch (err) { next(err) }
})

export default router
