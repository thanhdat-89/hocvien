import { Router, Request, Response, NextFunction } from 'express'
import { db, C, s, toDocs, toObj } from '../lib/firebase'
import { computeTuitionSummary, loadStudentPromotions } from '../lib/tuition'
import { listMaterialsForStudent } from './materials'
import { studentShortId } from '../services/sepayMatcher'
import type { Student, ClassEnrollment, Class, Schedule, TuitionRecord, Payment, PrivateSession } from '../types/models'

const router = Router()

// Public endpoint — KHÔNG yêu cầu xác thực.
// Bất kỳ ai có doc ID học viên là xem được. Chỉ trả về dữ liệu cần thiết cho phụ huynh,
// loại các field nội bộ/nhạy cảm (notes, address, primary parent contact...).

interface PublicStudent {
  id: string
  shortId: string
  fullName: string
  dateOfBirth?: string
  gender?: string
  school?: string
  gradeLevel?: number
  enrollmentDate: string
  status: string
  avatarUrl?: string
}


interface PublicClass {
  id: string
  name: string
  subjectName?: string
  teacherName?: string
  room?: string
  startDate?: string
  endDate?: string
  enrollmentDate: string
  enrollmentStatus: string
  schedules: Array<{
    dayOfWeek: string
    startTime: string
    endTime: string
    effectiveFrom: string
    effectiveTo?: string
  }>
}

interface PublicTuition {
  id: string
  billingMonth: number
  billingYear: number
  baseAmount: number
  discountAmount: number
  finalAmount: number
  paidAmount: number
  remainingAmount: number
  totalSessions: number
  chargedSessions: number
  status: string
  dueDate?: string
  className: string
  payments: Array<{
    id: string
    amount: number
    paymentDate: string
    method?: string
    notes?: string
  }>
}

interface PublicReview {
  id: string
  month: string
  content: string
  teacherName?: string
  updatedAt: string
}

// In-memory response cache to reduce Firestore reads when parents refresh.
// 60-second TTL is acceptable: admin updates show up within a minute.
const publicCache = new Map<string, { at: number; payload: any }>()
const PUBLIC_TTL_MS = 60_000

// GET /api/public/student/:id — toàn bộ dữ liệu cần cho trang chia sẻ phụ huynh
router.get('/student/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.id)

    const cached = publicCache.get(studentId)
    if (cached && Date.now() - cached.at < PUBLIC_TTL_MS) {
      res.json(cached.payload)
      return
    }

    const studentDoc = await db.collection(C.STUDENTS).doc(studentId).get()
    if (!studentDoc.exists) {
      res.status(404).json({ message: 'Không tìm thấy học viên' })
      return
    }
    const student = toObj<Student>(studentDoc)

    // Chỉ trả về học viên ACTIVE (đã nghỉ thì không cho xem)
    if (student.status !== 'ACTIVE') {
      res.status(404).json({ message: 'Học viên không khả dụng' })
      return
    }

    const publicStudent: PublicStudent = {
      id: student.id,
      shortId: studentShortId(student.id),
      fullName: student.fullName,
      dateOfBirth: student.dateOfBirth,
      gender: student.gender,
      school: student.school,
      gradeLevel: student.gradeLevel,
      enrollmentDate: student.enrollmentDate,
      status: student.status,
      avatarUrl: student.avatarUrl,
    }

    // ─── Lấy lớp + lịch học ────────────────────────────────────
    const enrollSnap = await db.collection(C.ENROLLMENTS)
      .where('studentId', '==', studentId)
      .where('status', '==', 'ACTIVE')
      .get()
    const enrollments = toDocs<ClassEnrollment>(enrollSnap)
    const classIds = enrollments.map(e => e.classId)

    const classesById = new Map<string, Class>()
    const schedulesByClass = new Map<string, Schedule[]>()

    if (classIds.length > 0) {
      // Firestore `in` query giới hạn 30 phần tử — chia chunk
      const chunks: string[][] = []
      for (let i = 0; i < classIds.length; i += 30) {
        chunks.push(classIds.slice(i, i + 30))
      }
      for (const chunk of chunks) {
        const [classSnap, scheduleSnap] = await Promise.all([
          db.collection(C.CLASSES).where('__name__', 'in', chunk).get(),
          db.collection(C.SCHEDULES).where('classId', 'in', chunk).get(),
        ])
        toDocs<Class>(classSnap).forEach(c => classesById.set(c.id, c))
        toDocs<Schedule>(scheduleSnap).forEach(sc => {
          const arr = schedulesByClass.get(sc.classId) ?? []
          arr.push(sc)
          schedulesByClass.set(sc.classId, arr)
        })
      }
    }

    const classes: PublicClass[] = enrollments.map(e => {
      const cls = classesById.get(e.classId)
      const scheds = (schedulesByClass.get(e.classId) ?? []).map(sc => ({
        dayOfWeek: sc.dayOfWeek,
        startTime: sc.startTime,
        endTime: sc.endTime,
        effectiveFrom: sc.effectiveFrom,
        effectiveTo: sc.effectiveTo,
      }))
      return {
        id: e.classId,
        name: cls?.name ?? e.className,
        subjectName: cls?.subjectName,
        teacherName: cls?.teacherName,
        room: cls?.room,
        startDate: cls?.startDate,
        endDate: cls?.endDate,
        enrollmentDate: e.enrollmentDate,
        enrollmentStatus: e.status,
        schedules: scheds,
      }
    })

    // ─── Học phí + lịch sử thanh toán ──────────────────────────
    const tuitionSnap = await db.collection(C.TUITION_RECORDS)
      .where('studentId', '==', studentId)
      .get()
    const tuitionRecords = toDocs<TuitionRecord>(tuitionSnap)
    const tuitionIds = tuitionRecords.map(t => t.id)

    const paymentsByTuition = new Map<string, Payment[]>()
    if (tuitionIds.length > 0) {
      const chunks: string[][] = []
      for (let i = 0; i < tuitionIds.length; i += 30) {
        chunks.push(tuitionIds.slice(i, i + 30))
      }
      for (const chunk of chunks) {
        const paySnap = await db.collection(C.PAYMENTS)
          .where('tuitionRecordId', 'in', chunk).get()
        toDocs<Payment>(paySnap).forEach(p => {
          const arr = paymentsByTuition.get(p.tuitionRecordId) ?? []
          arr.push(p)
          paymentsByTuition.set(p.tuitionRecordId, arr)
        })
      }
    }

    const tuition: PublicTuition[] = tuitionRecords
      .sort((a, b) => (b.billingYear - a.billingYear) || (b.billingMonth - a.billingMonth))
      .map(t => {
        const pays = (paymentsByTuition.get(t.id) ?? [])
          .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))
        const paidAmount = pays.reduce((sum, p) => sum + (p.amount || 0), 0)
        return {
          id: t.id,
          billingMonth: t.billingMonth,
          billingYear: t.billingYear,
          baseAmount: t.baseAmount,
          discountAmount: t.discountAmount,
          finalAmount: t.finalAmount,
          paidAmount,
          remainingAmount: Math.max(0, t.finalAmount - paidAmount),
          totalSessions: t.totalSessions,
          chargedSessions: t.chargedSessions,
          status: t.status,
          dueDate: t.dueDate,
          className: t.className,
          payments: pays.map(p => ({
            id: p.id,
            amount: p.amount,
            paymentDate: p.paymentDate,
            method: p.method,
            notes: p.notes,
          })),
        }
      })

    // ─── Nhận xét theo tháng ───────────────────────────────────
    const [reviewSnap, monthlyScoresSnap] = await Promise.all([
      db.collection(C.STUDENTS).doc(studentId).collection('reviews').orderBy('month', 'desc').get(),
      db.collection(C.MONTHLY_SCORES).where('studentId', '==', studentId).get(),
    ])
    const reviews: PublicReview[] = reviewSnap.docs.map(d => {
      const data = d.data()
      return {
        id: d.id,
        month: data.month,
        content: data.content,
        teacherName: data.teacherName,
        updatedAt: data.updatedAt,
      }
    })
    const monthlyScores = monthlyScoresSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .sort((a, b) => (b.year - a.year) || (b.month - a.month) || (a.className ?? '').localeCompare(b.className ?? '', 'vi'))
      .map(m => ({
        id: m.id,
        classId: m.classId,
        className: m.className,
        year: m.year,
        month: m.month,
        expectedCount: m.expectedCount,
        scores: m.scores ?? [],
        notes: m.notes,
      }))

    const [tuitionSummary, promotions, privateSessionsRaw] = await Promise.all([
      computeTuitionSummary(studentId),
      loadStudentPromotions(studentId),
      db.collection(C.PRIVATE_SCHEDULES).where('studentId', '==', studentId).get(),
    ])

    const startOfMonth = new Date().toISOString().slice(0, 7) + '-01'
    const privateSchedules = toDocs<PrivateSession>(privateSessionsRaw)
      .filter(p => p.status !== 'CANCELLED' && p.sessionDate >= startOfMonth)
      .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))
      .slice(0, 60)
      .map(p => ({
        id: p.id,
        sessionDate: p.sessionDate,
        startTime: p.startTime,
        endTime: p.endTime,
        teacherName: p.teacherName,
      }))

    const materials = await listMaterialsForStudent(studentId)

    const payload = {
      student: publicStudent,
      classes,
      privateSchedules,
      tuition,
      tuitionSummary,
      promotions,
      reviews,
      monthlyScores,
      materials,
    }
    publicCache.set(studentId, { at: Date.now(), payload })
    res.json(payload)
  } catch (err) { next(err) }
})

export default router
