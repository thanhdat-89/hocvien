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

// GET /api/tuition/schedule-summary?month=X&year=Y — Tổng hợp học phí từ lịch học
router.get('/schedule-summary', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { month, year } = req.query as Record<string, string>
    if (!month || !year) { res.status(400).json({ message: 'Cần month và year' }); return }

    const m = Number(month)
    const y = Number(year)
    const monthStr = `${y}-${String(m).padStart(2, '0')}`
    const fromDate = `${monthStr}-01`
    const toDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`

    // 1. Lấy tất cả enrollments: ACTIVE hoặc DROPPED nhưng dropDate >= fromDate
    const enrollmentsSnap = await db.collection(C.ENROLLMENTS).get()
    const allEnrollments = toDocs<any>(enrollmentsSnap)
    const relevantEnrollments = allEnrollments.filter(e => {
      if (e.status === 'ACTIVE') return true
      if (e.status === 'DROPPED' && e.dropDate && e.dropDate >= fromDate) return true
      return false
    })

    if (relevantEnrollments.length === 0) { res.json([]); return }

    // 2. Unique classIds, studentIds
    const classIds = [...new Set(relevantEnrollments.map((e: any) => e.classId as string))]
    const studentIds = [...new Set(relevantEnrollments.map((e: any) => e.studentId as string))]

    // 3. Fetch classes
    const classDocs = await Promise.all(classIds.map(id => db.collection(C.CLASSES).doc(id).get()))
    const classMap: Record<string, any> = {}
    for (const doc of classDocs) {
      if (doc.exists) classMap[doc.id] = { id: doc.id, ...doc.data() }
    }

    // 4. Fetch students
    const studentDocs = await Promise.all(studentIds.map(id => db.collection(C.STUDENTS).doc(id).get()))
    const studentMap: Record<string, any> = {}
    for (const doc of studentDocs) {
      if (doc.exists) studentMap[doc.id] = { id: doc.id, ...doc.data() }
    }

    // 5. Fetch sessions per class — dùng composite index (classId, sessionDate)
    //    để chỉ lấy sessions trong tháng, không cần filter in-memory
    const sessionsByClass: Record<string, any[]> = {}
    await Promise.all(classIds.map(async (classId) => {
      const snap = await db.collection(C.SESSIONS)
        .where('classId', '==', classId)
        .where('sessionDate', '>=', fromDate)
        .where('sessionDate', '<=', toDate)
        .get()
      sessionsByClass[classId] = toDocs<any>(snap)
    }))

    // 6. Fetch promotions per unique (studentId, classId) — song song thay vì tuần tự
    const uniquePairs = new Map<string, { studentId: string; classId: string }>()
    for (const e of relevantEnrollments) {
      const key = `${e.studentId}-${e.classId}`
      if (!uniquePairs.has(key)) uniquePairs.set(key, { studentId: e.studentId, classId: e.classId })
    }
    const promotionMap: Record<string, any[]> = {}
    await Promise.all(Array.from(uniquePairs.entries()).map(async ([key, { studentId, classId }]) => {
      const snap = await db.collection(C.STUDENT_PROMOTIONS)
        .where('studentId', '==', studentId)
        .where('classId', '==', classId)
        .get()
      promotionMap[key] = toDocs<any>(snap).filter((p: any) =>
        (!p.appliedFrom || p.appliedFrom <= toDate) && (!p.appliedTo || p.appliedTo >= fromDate)
      )
    }))

    // 7. Tính từng enrollment
    const rows: any[] = []
    for (const enrollment of relevantEnrollments) {
      const cls = classMap[enrollment.classId]
      const student = studentMap[enrollment.studentId]
      if (!cls || !student) continue

      const ratePerSession: number = (enrollment.customTuitionRate as number) || (cls.tuitionRate as number) || 0

      const classSessions = sessionsByClass[enrollment.classId] ?? []
      const sessions = classSessions.filter((sess: any) => {
        if (!sess.sessionDate || !sess.sessionDate.startsWith(monthStr)) return false
        if (sess.status === 'CANCELLED') return false
        if (enrollment.enrollmentDate && sess.sessionDate < enrollment.enrollmentDate) return false
        if (enrollment.status === 'DROPPED' && enrollment.dropDate && sess.sessionDate > enrollment.dropDate) return false
        return true
      })

      const totalSessions = sessions.length
      if (totalSessions === 0) continue

      const baseAmount = totalSessions * ratePerSession
      const promos = promotionMap[`${enrollment.studentId}-${enrollment.classId}`] ?? []
      let discountAmount = 0
      for (const sp of promos) {
        if (sp.promotionType === 'PERCENTAGE') discountAmount += (baseAmount * sp.promotionValue) / 100
        else if (sp.promotionType === 'FIXED_AMOUNT') discountAmount += sp.promotionValue
        else if (sp.promotionType === 'FREE_SESSIONS') discountAmount += sp.promotionValue * ratePerSession
      }
      discountAmount = Math.min(discountAmount, baseAmount)

      rows.push({
        studentId: enrollment.studentId,
        studentName: student.fullName,
        gradeLevel: student.gradeLevel ?? null,
        classId: enrollment.classId,
        className: cls.name,
        totalSessions,
        ratePerSession,
        discountAmount,
        baseAmount,
        finalAmount: baseAmount - discountAmount,
      })
    }

    // Học riêng — dùng range query thay vì fetch all rồi filter
    const privateSnap = await db.collection(C.PRIVATE_SCHEDULES)
      .where('sessionDate', '>=', fromDate)
      .where('sessionDate', '<=', toDate)
      .get()
    const allPrivate = toDocs<any>(privateSnap).filter((ps: any) => ps.status !== 'CANCELLED')

    // Group by studentId
    const privateByStudent: Record<string, any[]> = {}
    for (const ps of allPrivate) {
      if (!privateByStudent[ps.studentId]) privateByStudent[ps.studentId] = []
      privateByStudent[ps.studentId].push(ps)
    }

    // Thêm rows học riêng — cần studentName
    const privateStudentIds = Object.keys(privateByStudent).filter(sid => !studentMap[sid])
    if (privateStudentIds.length > 0) {
      const extraDocs = await Promise.all(privateStudentIds.map(id => db.collection(C.STUDENTS).doc(id).get()))
      for (const doc of extraDocs) {
        if (doc.exists) studentMap[doc.id] = { id: doc.id, ...doc.data() }
      }
    }

    // Fetch promotions cho học riêng (classId === 'private') của các students liên quan
    const privatePromoMap: Record<string, any[]> = {}
    const allPrivateStudentIds = Object.keys(privateByStudent)
    await Promise.all(allPrivateStudentIds.map(async (sid) => {
      const snap = await db.collection(C.STUDENT_PROMOTIONS)
        .where('studentId', '==', sid)
        .where('classId', '==', 'private')
        .get()
      privatePromoMap[sid] = toDocs<any>(snap).filter((p: any) =>
        (!p.appliedFrom || p.appliedFrom <= toDate) && (!p.appliedTo || p.appliedTo >= fromDate)
      )
    }))

    for (const [sid, sessions] of Object.entries(privateByStudent)) {
      const student = studentMap[sid]
      if (!student) continue
      const totalAmount = sessions.reduce((sum, ps) => sum + (ps.ratePerSession || 0), 0)
      const totalSessions = sessions.length
      const avgRate = totalSessions > 0 ? Math.round(totalAmount / totalSessions) : 0

      let discountAmount = 0
      for (const p of (privatePromoMap[sid] ?? [])) {
        if (p.promotionType === 'PERCENTAGE') discountAmount += (totalAmount * p.promotionValue) / 100
        else if (p.promotionType === 'FIXED_AMOUNT') discountAmount += p.promotionValue
      }
      discountAmount = Math.min(discountAmount, totalAmount)

      rows.push({
        studentId: sid,
        studentName: student.fullName,
        gradeLevel: student.gradeLevel ?? null,
        classId: 'private',
        className: 'Học riêng',
        totalSessions,
        ratePerSession: avgRate,
        discountAmount,
        baseAmount: totalAmount,
        finalAmount: totalAmount - discountAmount,
      })
    }

    // ─── Enrich rows với tuitionRecord + payment status ───────
    const recordsSnap = await db.collection(C.TUITION_RECORDS)
      .where('billingMonth', '==', m)
      .where('billingYear', '==', y)
      .get()
    const recordsByKey = new Map<string, TuitionRecord>()
    recordsSnap.forEach(doc => {
      const d = { id: doc.id, ...(doc.data() as any) } as TuitionRecord
      recordsByKey.set(`${d.studentId}-${d.classId}`, d)
    })

    const recordIds = Array.from(recordsByKey.values()).map(r => r.id)
    const paidByRecord = new Map<string, number>()
    for (let i = 0; i < recordIds.length; i += 10) {
      const chunk = recordIds.slice(i, i + 10)
      if (chunk.length === 0) continue
      const paySnap = await db.collection(C.PAYMENTS)
        .where('tuitionRecordId', 'in', chunk).get()
      paySnap.forEach(p => {
        const data = p.data() as Payment
        paidByRecord.set(data.tuitionRecordId, (paidByRecord.get(data.tuitionRecordId) || 0) + (data.amount || 0))
      })
    }

    rows.forEach(row => {
      const rec = recordsByKey.get(`${row.studentId}-${row.classId}`)
      if (rec) {
        const paid = paidByRecord.get(rec.id) || 0
        row.tuitionRecord = {
          id: rec.id,
          finalAmount: rec.finalAmount,
          status: rec.status,
          paidAmount: paid,
          remainingAmount: Math.max(0, rec.finalAmount - paid),
        }
      } else {
        row.tuitionRecord = null
      }
    })

    rows.sort((a, b) => a.studentName.localeCompare(b.studentName, 'vi'))
    res.json(rows)
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

// POST /api/tuition/calculate
router.post('/calculate', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { studentId, classId, month, year } = req.body
    if (!classId || !month || !year) { res.status(400).json({ message: 'Cần classId, month, year' }); return }

    if (studentId) {
      const { tuitionRecord } = await calculateTuitionForStudent(studentId, classId, Number(month), Number(year))
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

    // Lấy tên nhân viên nhận tiền
    const receiverDoc = await db.collection(C.USERS).doc(req.user!.userId).get()

    const paymentData: Omit<Payment, 'id'> = {
      tuitionRecordId,
      studentId: record.studentId,
      studentName: record.studentName,
      classId: record.classId,
      amount: Number(amount),
      paymentDate: paymentDate || now().slice(0, 10),
      method: (method || 'CASH') as Payment['method'],
      receivedById: req.user!.userId,
      receivedByName: receiverDoc.data()?.fullName as string ?? '',
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

// ─── PROMOTIONS ────────────────────────────────────────────────

// GET /api/tuition/promotions/list
router.get('/promotions/list', async (_req, res: Response, next: NextFunction) => {
  try {
    const snap = await db.collection(C.PROMOTIONS).where('isActive', '==', true).get()
    res.json(toDocs<Promotion>(snap).sort((a, b) => a.name.localeCompare(b.name)))
  } catch (err) { next(err) }
})

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
