import { Router, Response, NextFunction } from 'express'
import { db, C, toDocs } from '../lib/firebase'
import { getTuitionScheduleSummary } from '../services/tuitionScheduleSummary'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { Session, TuitionRecord, Payment, Student, ClassEnrollment, PrivateSession } from '../types/models'

const router = Router()
router.use(authenticate)

const DASHBOARD_TTL_MS = 5 * 60 * 1000 // 5 phút
const REVENUE_TTL_MS = 12 * 60 * 60 * 1000 // 12 giờ
const STUDENTS_BY_GRADE_TTL_MS = 10 * 60 * 1000 // 10 phút

function dateInVietnam(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
}

function nextMonthStart(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`
}

let revenueCache: { at: number; data: any[] } | null = null
let studentsByGradeCache: { at: number; data: any[] } | null = null

async function computeDashboard() {
  const today = dateInVietnam()
  const thisMonth = today.slice(0, 7)
  const nextMonth = nextMonthStart(thisMonth)

  const [
    activeStudentsSnap,
    activeClassesSnap,
    sessionsTodaySnap,
    privateSessionsTodaySnap,
    newStudentsSnap,
    revenueSnap,
    overdueSnap,
    recentPaymentsSnap,
  ] = await Promise.all([
    db.collection(C.STUDENTS).where('status', '==', 'ACTIVE').get(),
    db.collection(C.CLASSES).where('status', '==', 'ACTIVE').get(),
    db.collection(C.SESSIONS).where('sessionDate', '==', today).get(),
    db.collection(C.PRIVATE_SCHEDULES).where('sessionDate', '==', today).get(),
    db.collection(C.STUDENTS)
      .where('enrollmentDate', '>=', `${thisMonth}-01`)
      .where('enrollmentDate', '<=', `${thisMonth}-31`)
      .get(),
    db.collection(C.PAYMENTS)
      .where('paymentDate', '>=', `${thisMonth}-01`)
      .where('paymentDate', '<=', `${thisMonth}-31`)
      .get(),
    db.collection(C.TUITION_RECORDS).where('dueDate', '<', today).get(),
    db.collection(C.PAYMENTS).orderBy('createdAt', 'desc').limit(10).get(),
  ])

  const revenueThisMonth = toDocs<Payment>(revenueSnap).reduce((sum, p) => sum + p.amount, 0)
  const overdueCount = toDocs<TuitionRecord>(overdueSnap)
    .filter(r => r.status === 'PENDING' || r.status === 'PARTIAL').length
  const sessionsToday = toDocs<Session>(sessionsTodaySnap)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const recentPayments = toDocs<Payment>(recentPaymentsSnap)

  let unscheduledPrivateStudentsThisMonth: number | null = null
  let totalPrivateStudents: number | null = null
  let unpaidStudentsThisMonth: number | null = null
  try {
    const [enrollmentsSnap, privateSchedulesSnap] = await Promise.all([
      db.collection(C.ENROLLMENTS).where('status', '==', 'ACTIVE').get(),
      db.collection(C.PRIVATE_SCHEDULES)
        .where('sessionDate', '>=', `${thisMonth}-01`)
        .where('sessionDate', '<', nextMonth).get(),
    ])
    const enrolledStudents = new Set(toDocs<ClassEnrollment>(enrollmentsSnap).map(e => e.studentId))
    const scheduledStudents = new Set(toDocs<PrivateSession>(privateSchedulesSnap).map(p => p.studentId))
    const privateStudents = toDocs<Student>(activeStudentsSnap).filter(s => !enrolledStudents.has(s.id))
    totalPrivateStudents = privateStudents.length
    unscheduledPrivateStudentsThisMonth = privateStudents.filter(s => !scheduledStudents.has(s.id)).length

  } catch (error: any) {
    console.warn('[Dashboard] Firebase monthly metrics unavailable', error?.code ?? error?.name ?? 'unknown')
  }

  // Use the same schedule rows and outstanding amounts as the tuition page.
  try {
    const rows = await getTuitionScheduleSummary(Number(thisMonth.slice(5)), Number(thisMonth.slice(0, 4)))
    unpaidStudentsThisMonth = new Set(rows
      .filter(row => (row.tuitionRecord ? row.tuitionRecord.remainingAmount : row.finalAmount) > 0)
      .map(row => row.studentId)).size
  } catch (error: any) {
    console.warn('[Dashboard] Tuition summary unavailable', error?.code ?? error?.name ?? 'unknown')
  }

  return {
    stats: {
      totalActiveStudents: activeStudentsSnap.size,
      totalActiveClasses: activeClassesSnap.size,
      newStudentsThisMonth: newStudentsSnap.size,
      revenueThisMonth,
      overdueCount,
      sessionsTodayCount: sessionsToday.length + privateSessionsTodaySnap.size,
      unscheduledPrivateStudentsThisMonth,
      totalPrivateStudents,
      unpaidStudentsThisMonth,
    },
    sessionsToday,
    recentPayments,
    metricsMonth: thisMonth,
    metricsVersion: 5,
    cachedAt: Date.now(),
  }
}

// GET /api/dashboard — lazy write-through: trả aggregate doc nếu fresh, nếu không compute + lưu
router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const aggRef = db.collection(C.AGGREGATES).doc('dashboard')
    const aggSnap = await aggRef.get()

    if (aggSnap.exists) {
      const cached = aggSnap.data() as { cachedAt?: number; metricsMonth?: string; metricsVersion?: number; stats?: Record<string, unknown> }
      const hasMonthlyMetrics = cached.metricsVersion === 5 && cached.metricsMonth === dateInVietnam().slice(0, 7)
        && ['unscheduledPrivateStudentsThisMonth', 'totalPrivateStudents', 'unpaidStudentsThisMonth']
          .every(key => typeof cached.stats?.[key] === 'number' && Number.isFinite(cached.stats[key]))
      if (cached.cachedAt && Date.now() - cached.cachedAt < DASHBOARD_TTL_MS && hasMonthlyMetrics) {
        res.json(cached)
        return
      }
    }

    const fresh = await computeDashboard()
    await aggRef.set(fresh)
    res.json(fresh)
  } catch (err) {
    next(err)
  }
})

// POST /api/dashboard/refresh — force refresh (dùng khi có payment/enrollment mới)
router.post('/refresh', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const fresh = await computeDashboard()
    await db.collection(C.AGGREGATES).doc('dashboard').set(fresh)
    res.json(fresh)
  } catch (err) {
    next(err)
  }
})

// GET /api/dashboard/revenue — Doanh thu 12 tháng gần nhất
router.get('/revenue', requireRole('ADMIN', 'STAFF'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (revenueCache && Date.now() - revenueCache.at < REVENUE_TTL_MS) {
      res.json(revenueCache.data)
      return
    }
    const today = new Date()

    // Tính khoảng 12 tháng
    const monthRanges = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - (11 - i), 1)
      return { year: d.getFullYear(), month: d.getMonth() + 1 }
    })

    // Query song song thay vì tuần tự
    const snaps = await Promise.all(
      monthRanges.map(({ year, month }) => {
        const monthStr = `${year}-${String(month).padStart(2, '0')}`
        return db.collection(C.PAYMENTS)
          .where('paymentDate', '>=', `${monthStr}-01`)
          .where('paymentDate', '<=', `${monthStr}-31`)
          .get()
      })
    )

    const months = monthRanges.map((r, i) => ({
      ...r,
      revenue: toDocs<Payment>(snaps[i]).reduce((sum, p) => sum + p.amount, 0),
    }))

    revenueCache = { at: Date.now(), data: months }
    res.json(months)
  } catch (err) {
    next(err)
  }
})

// GET /api/dashboard/students-by-grade
router.get('/students-by-grade', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (studentsByGradeCache && Date.now() - studentsByGradeCache.at < STUDENTS_BY_GRADE_TTL_MS) {
      res.json(studentsByGradeCache.data)
      return
    }
    const snap = await db.collection(C.STUDENTS).where('status', '==', 'ACTIVE').get()
    const students = toDocs<Student>(snap)

    const groups = new Map<number, number>()
    for (const s of students) {
      if (s.gradeLevel) {
        groups.set(s.gradeLevel, (groups.get(s.gradeLevel) ?? 0) + 1)
      }
    }

    const result = Array.from(groups.entries())
      .map(([gradeLevel, count]) => ({ gradeLevel, count }))
      .sort((a, b) => a.gradeLevel - b.gradeLevel)

    studentsByGradeCache = { at: Date.now(), data: result }
    res.json(result)
  } catch (err) {
    next(err)
  }
})

export default router
