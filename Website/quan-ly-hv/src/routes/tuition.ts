import { getTuitionScheduleSummary } from '../services/tuitionScheduleSummary'
import { Router, Response, NextFunction } from 'express'
import { db, C, s, toDocs, toObj, paginate } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { TuitionRecord, Payment, Promotion, StudentPromotion } from '../types/models'
import {
  calculateTuitionForStudent,
  calculateTuitionForClass,
  getPaymentStatus,
  refreshTuitionStatus,
} from '../services/tuitionCalculator'

const router = Router()
router.use(authenticate)
const now = () => new Date().toISOString()

// GET /api/tuition
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = '1', limit = '20', studentId, classId, month, year, status } = req.query as Record<string, string>

    let query = db.collection(C.TUITION_RECORDS) as FirebaseFirestore.Query
    if (studentId) query = query.where('studentId', '==', studentId)
    if (classId) query = query.where('classId', '==', classId)
    if (month) query = query.where('billingMonth', '==', Number(month))
    if (year) query = query.where('billingYear', '==', Number(year))
    if (status) query = query.where('status', '==', status)

    const snap = await query.orderBy('billingYear', 'desc').orderBy('billingMonth', 'desc').get()
    const records = toDocs<TuitionRecord>(snap)

    res.json(paginate(records, Number(page), Number(limit)))
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
    res.json(await getTuitionScheduleSummary(month, year))
  } catch (err) { next(err) }
})

// GET /api/tuition/student-promotions?studentId=X
router.get('/student-promotions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { studentId } = req.query as Record<string, string>
    if (!studentId) { res.status(400).json({ message: 'Cần studentId' }); return }
    const snap = await db.collection(C.STUDENT_PROMOTIONS).where('studentId', '==', studentId).get()
    const list = toDocs<StudentPromotion>(snap).sort((a, b) => b.appliedFrom.localeCompare(a.appliedFrom))
    res.json(list)
  } catch (err) { next(err) }
})

// POST /api/tuition/student-promotions/direct — tạo promotion và assign cho học viên trong 1 bước
router.post('/student-promotions/direct', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { studentId, classId, type, value, appliedFrom, appliedTo, notes } = req.body
    if (!studentId || !classId || !type || !value || !appliedFrom) {
      res.status(400).json({ message: 'Cần studentId, classId, type, value, appliedFrom' }); return
    }

    const studentDoc = await db.collection(C.STUDENTS).doc(studentId).get()
    if (!studentDoc.exists) {
      res.status(404).json({ message: 'Không tìm thấy học viên' }); return
    }

    let className: string
    if (classId === 'private') {
      className = 'Học riêng'
    } else {
      const classDoc = await db.collection(C.CLASSES).doc(classId).get()
      if (!classDoc.exists) {
        res.status(404).json({ message: 'Không tìm thấy lớp học' }); return
      }
      className = classDoc.data()!.name as string
    }
    const promoName = type === 'PERCENTAGE'
      ? `Giảm ${value}% - ${className}`
      : `Giảm ${Number(value).toLocaleString('vi-VN')}đ - ${className}`

    // Tạo promotion
    const promoRef = await db.collection(C.PROMOTIONS).add({
      name: promoName, type, value: Number(value),
      isActive: true, createdAt: now(),
    })

    // Assign cho học viên
    const data: Omit<StudentPromotion, 'id'> = {
      studentId, studentName: studentDoc.data()!.fullName as string,
      classId, className,
      promotionId: promoRef.id, promotionName: promoName,
      promotionType: type as StudentPromotion['promotionType'],
      promotionValue: Number(value),
      appliedFrom, appliedTo: appliedTo || undefined,
      approvedById: req.user!.userId,
      notes: notes || undefined,
      createdAt: now(),
    }
    const ref = await db.collection(C.STUDENT_PROMOTIONS).add(data)
    res.status(201).json({ id: ref.id, ...data })
  } catch (err) { next(err) }
})

// DELETE /api/tuition/student-promotions/:id
router.delete('/student-promotions/:id', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await db.collection(C.STUDENT_PROMOTIONS).doc(s(req.params.id)).delete()
    res.json({ message: 'Đã xoá khuyến mại' })
  } catch (err) { next(err) }
})

// GET /api/tuition/list/overdue
router.get('/list/overdue', async (_req, res: Response, next: NextFunction) => {
  try {
    const today = now().slice(0, 10)
    const snap = await db.collection(C.TUITION_RECORDS)
      .where('dueDate', '<', today)
      .get()

    const records = toDocs<TuitionRecord>(snap)
      .filter(r => r.status === 'PENDING' || r.status === 'PARTIAL')

    const withRemaining = await Promise.all(
      records.map(async r => {
        const { remaining } = await getPaymentStatus(r.id)
        return { ...r, remaining }
      })
    )
    withRemaining.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    res.json(withRemaining)
  } catch (err) { next(err) }
})

// GET /api/tuition/promotions/list
router.get('/promotions/list', async (_req, res: Response, next: NextFunction) => {
  try {
    const snap = await db.collection(C.PROMOTIONS).where('isActive', '==', true).get()
    res.json(toDocs<Promotion>(snap).sort((a, b) => a.name.localeCompare(b.name)))
  } catch (err) { next(err) }
})

// GET /api/tuition/:id
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await db.collection(C.TUITION_RECORDS).doc(s(req.params.id)).get()
    if (!doc.exists) { res.status(404).json({ message: 'Không tìm thấy phiếu học phí' }); return }

    const record = toObj<TuitionRecord>(doc)
    const paymentsSnap = await db.collection(C.PAYMENTS)
      .where('tuitionRecordId', '==', record.id)
      .orderBy('paymentDate', 'desc')
      .get()

    const paymentStatus = await getPaymentStatus(record.id)
    res.json({ ...record, payments: toDocs<Payment>(paymentsSnap), paymentStatus })
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
    for (const classId of classIds) {
      try {
        const r = await calculateTuitionForClass(classId, Number(month), Number(year))
        created += r.created
        updated += r.updated
      } catch (e) {
        failed++
        console.error('[bulk-create] failed for class', classId, e)
      }
    }
    res.json({ created, updated, failed, classCount: classIds.length })
  } catch (err) { next(err) }
})

async function getReceiverName(userId?: string): Promise<string> {
  if (!userId || typeof userId !== 'string' || !userId.trim()) return 'Quản trị viên'
  try {
    const doc = await db.collection(C.USERS).doc(userId).get()
    return doc.exists ? (doc.data()?.fullName || 'Quản trị viên') : 'Quản trị viên'
  } catch {
    return 'Quản trị viên'
  }
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

    // 1. Ưu tiên dùng tuitionRecordId nếu frontend gửi lên
    if (tuitionRecordId) {
      const doc = await db.collection(C.TUITION_RECORDS).doc(tuitionRecordId).get()
      if (doc.exists) {
        record = { id: doc.id, ...doc.data() } as TuitionRecord & { id: string }
      } else {
        res.status(404).json({ message: 'Không tìm thấy phiếu học phí' })
        return
      }
    } else {
      // 2. Fallback: query by studentId/classId/month/year
      const existingSnap = await db.collection(C.TUITION_RECORDS)
        .where('studentId', '==', studentId)
        .where('classId', '==', classId)
        .where('billingMonth', '==', Number(month))
        .where('billingYear', '==', Number(year))
        .limit(1)
        .get()

      if (!existingSnap.empty) {
        record = toObj<TuitionRecord>(existingSnap.docs[0])
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
      const { remaining } = await getPaymentStatus(record.id)
      if (remaining > 0) {
        const receivedByName = await getReceiverName(req.user?.userId)
        await db.collection(C.PAYMENTS).add({
          tuitionRecordId: record.id,
          studentId: record.studentId || studentId,
          studentName: record.studentName || 'Học viên',
          classId: record.classId || classId,
          amount: remaining,
          paymentDate: now().slice(0, 10),
          method: 'CASH',
          receivedById: req.user?.userId || 'system',
          receivedByName,
          notes: 'Xác nhận đóng đủ học phí qua checkbox',
          createdAt: now(),
        })
      }
      await refreshTuitionStatus(record.id)
    } else {
      const paySnap = await db.collection(C.PAYMENTS).where('tuitionRecordId', '==', record.id).get()
      const batch = db.batch()
      paySnap.docs.forEach(doc => batch.delete(doc.ref))
      await batch.commit()
      await refreshTuitionStatus(record.id)
    }

    const finalStatus = await getPaymentStatus(record.id)
    res.json({ recordId: record.id, paid, finalStatus })
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
      const { tuitionRecord } = await calculateTuitionForStudent(studentId, classId, Number(month), Number(year))

      if (typeof paid === 'boolean') {
        if (paid) {
          const { remaining } = await getPaymentStatus(tuitionRecord.id)
          if (remaining > 0) {
            const receivedByName = await getReceiverName(req.user?.userId)
            await db.collection(C.PAYMENTS).add({
              tuitionRecordId: tuitionRecord.id,
              studentId: tuitionRecord.studentId || studentId,
              studentName: tuitionRecord.studentName || 'Học viên',
              classId: tuitionRecord.classId || classId,
              amount: remaining,
              paymentDate: now().slice(0, 10),
              method: 'CASH',
              receivedById: req.user?.userId || 'system',
              receivedByName,
              notes: 'Xác nhận đóng đủ học phí qua checkbox',
              createdAt: now(),
            })
          }
          await refreshTuitionStatus(tuitionRecord.id)
          tuitionRecord.status = 'PAID'
        } else {
          const paySnap = await db.collection(C.PAYMENTS).where('tuitionRecordId', '==', tuitionRecord.id).get()
          const batch = db.batch()
          paySnap.docs.forEach(doc => batch.delete(doc.ref))
          await batch.commit()
          await refreshTuitionStatus(tuitionRecord.id)
          tuitionRecord.status = 'PENDING'
        }
      }

      res.json(tuitionRecord)
    } else {
      const result = await calculateTuitionForClass(classId, Number(month), Number(year))
      res.json({ message: `Tạo ${result.created} phiếu mới, cập nhật ${result.updated} phiếu`, ...result })
    }
  } catch (err) { next(err) }
})

// POST /api/tuition/:id/payment — Ghi nhận thanh toán
router.post('/:id/payment', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tuitionRecordId = s(req.params.id)
    const { amount, paymentDate, method, notes } = req.body as { amount: number; paymentDate?: string; method?: string; notes?: string }

    if (!amount || Number(amount) <= 0) { res.status(400).json({ message: 'Số tiền không hợp lệ' }); return }

    const recordDoc = await db.collection(C.TUITION_RECORDS).doc(tuitionRecordId).get()
    if (!recordDoc.exists) { res.status(404).json({ message: 'Không tìm thấy phiếu học phí' }); return }
    const record = recordDoc.data() as TuitionRecord

    const receivedByName = await getReceiverName(req.user?.userId)

    const paymentData: Omit<Payment, 'id'> = {
      tuitionRecordId,
      studentId: record.studentId,
      studentName: record.studentName,
      classId: record.classId,
      amount: Number(amount),
      paymentDate: paymentDate || now().slice(0, 10),
      method: (method || 'CASH') as Payment['method'],
      receivedById: req.user?.userId || 'system',
      receivedByName,
      notes,
      createdAt: now(),
    }

    const ref = await db.collection(C.PAYMENTS).add(paymentData)
    await refreshTuitionStatus(tuitionRecordId)

    const { remaining, status } = await getPaymentStatus(tuitionRecordId)
    res.status(201).json({ payment: { id: ref.id, ...paymentData }, status, remaining })
  } catch (err) { next(err) }
})

// DELETE /api/tuition/payment/:paymentId
router.delete('/payment/:paymentId', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const paymentDoc = await db.collection(C.PAYMENTS).doc(s(req.params.paymentId)).get()
    if (!paymentDoc.exists) { res.status(404).json({ message: 'Không tìm thấy giao dịch' }); return }

    const tuitionRecordId = paymentDoc.data()!.tuitionRecordId as string
    await db.collection(C.PAYMENTS).doc(s(req.params.paymentId)).delete()
    await refreshTuitionStatus(tuitionRecordId)

    res.json({ message: 'Đã xoá giao dịch thanh toán' })
  } catch (err) { next(err) }
})

// ─── PROMOTIONS ────────────────────────────────────────────────

// POST /api/tuition/promotions
router.post('/promotions', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, type, value, conditions, validFrom, validTo } = req.body
    const data: Omit<Promotion, 'id'> = {
      name, type, value: Number(value), conditions,
      validFrom: validFrom || null, validTo: validTo || null,
      isActive: true, createdAt: now(),
    }
    const ref = await db.collection(C.PROMOTIONS).add(data)
    res.status(201).json({ id: ref.id, ...data })
  } catch (err) { next(err) }
})

// POST /api/tuition/student-promotions
router.post('/student-promotions', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { studentId, classId, promotionId, appliedFrom, appliedTo, notes } = req.body

    const [studentDoc, classDoc, promoDoc] = await Promise.all([
      db.collection(C.STUDENTS).doc(studentId).get(),
      db.collection(C.CLASSES).doc(classId).get(),
      db.collection(C.PROMOTIONS).doc(promotionId).get(),
    ])

    if (!promoDoc.exists) { res.status(404).json({ message: 'Không tìm thấy khuyến mãi' }); return }
    const promo = promoDoc.data()!

    const data: Omit<StudentPromotion, 'id'> = {
      studentId, studentName: studentDoc.data()!.fullName as string,
      classId, className: classDoc.data()!.name as string,
      promotionId, promotionName: promo.name as string,
      promotionType: promo.type as StudentPromotion['promotionType'],
      promotionValue: Number(promo.value),
      appliedFrom, appliedTo: appliedTo || null,
      approvedById: req.user!.userId,
      notes, createdAt: now(),
    }

    const ref = await db.collection(C.STUDENT_PROMOTIONS).add(data)
    res.status(201).json({ id: ref.id, ...data })
  } catch (err) { next(err) }
})

export default router
