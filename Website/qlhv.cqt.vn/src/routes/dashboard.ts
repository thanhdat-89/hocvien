import { Router, Response, NextFunction } from 'express'
import { db, C, toDocs } from '../lib/firebase'
import { getCachedTuitionSummary } from '../services/tuitionReadView'
import { readView } from '../services/readViews'
import { getStudentIndex } from '../services/studentReadView'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { Session, TuitionRecord, Payment, ClassEnrollment, PrivateSession } from '../types/models'

const router = Router()
router.use(authenticate)

const DASHBOARD_TTL_MS = 5 * 60 * 1000 // 5 phút
const REVENUE_TTL_MS = 12 * 60 * 60 * 1000 // 12 giờ
const STUDENTS_BY_GRADE_TTL_MS = 10 * 60 * 1000 // 10 phút
const DASHBOARD_METRICS_VERSION = 6

function dateInVietnam(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
}

function nextMonthStart(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function monthsFromSeptember2026(throughMonthKey: string) {
  const [throughYear, throughMonth] = throughMonthKey.split('-').map(Number)
  const months: Array<{ year: number; month: number }> = []

  for (let year = 2026, month = 9; year < throughYear || (year === throughYear && month <= throughMonth);) {
    months.push({ year, month })
    month += 1
    if (month === 13) {
      year += 1
      month = 1
    }
  }

  return months
}


async function computeDashboard() {
  const today = dateInVietnam()
  const thisMonth = today.slice(0, 7)
  const nextMonth = nextMonthStart(thisMonth)

  const [
    studentsIndex,
    activeClassesSnap,
    sessionsTodaySnap,
    privateSessionsTodaySnap,
    newStudentsSnap,
    revenueSnap,
    overdueSnap,
    recentPaymentsSnap,
  ] = await Promise.all([
    getStudentIndex(),
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
  const activeStudents = studentsIndex.data!.filter(student => student.status === 'ACTIVE')

  const revenueThisMonth = toDocs<Payment>(revenueSnap).reduce((sum, p) => sum + p.amount, 0)
  const overdueCount = toDocs<TuitionRecord>(overdueSnap)
    .filter(r => r.status === 'PENDING' || r.status === 'PARTIAL').length
  const sessionsToday = toDocs<Session>(sessionsTodaySnap)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const recentPayments = toDocs<Payment>(recentPaymentsSnap)

  let unscheduledPrivateStudentsThisMonth: number | null = null
  let totalPrivateStudents: number | null = null
  let unpaidStudentsThisMonth: number | null = null
  let unpaidStudentsByMonth: Array<{ year: number; month: number; count: number }> = []
  try {
    const [enrollmentsSnap, privateSchedulesSnap] = await Promise.all([
      db.collection(C.ENROLLMENTS).where('status', '==', 'ACTIVE').get(),
      db.collection(C.PRIVATE_SCHEDULES)
        .where('sessionDate', '>=', `${thisMonth}-01`)
        .where('sessionDate', '<', nextMonth).get(),
    ])
    const enrolledStudents = new Set(toDocs<ClassEnrollment>(enrollmentsSnap).map(e => e.studentId))
    const scheduledStudents = new Set(toDocs<PrivateSession>(privateSchedulesSnap).map(p => p.studentId))
    const privateStudents = activeStudents.filter(s => !enrolledStudents.has(s.id))
    totalPrivateStudents = privateStudents.length
    unscheduledPrivateStudentsThisMonth = privateStudents.filter(s => !scheduledStudents.has(s.id)).length

  } catch (error: any) {
    console.warn('[Dashboard] Firebase monthly metrics unavailable', error?.code ?? error?.name ?? 'unknown')
  }

  // Use the same schedule rows and outstanding amounts as the tuition page.
  try {
    const months = monthsFromSeptember2026(thisMonth)
    const summaries = await Promise.all(months.map(({ month, year }) => getCachedTuitionSummary(month, year)))
    unpaidStudentsByMonth = months.map(({ month, year }, index) => ({
      month,
      year,
      count: summaries[index].unpaidStudents,
    }))
    unpaidStudentsThisMonth = unpaidStudentsByMonth[unpaidStudentsByMonth.length - 1]?.count ?? null
  } catch (error: any) {
    console.warn('[Dashboard] Tuition summaries unavailable', error?.code ?? error?.name ?? 'unknown')
  }

  return {
    stats: {
      totalActiveStudents: activeStudents.length,
      totalActiveClasses: activeClassesSnap.size,
      newStudentsThisMonth: newStudentsSnap.size,
      revenueThisMonth,
      overdueCount,
      sessionsTodayCount: sessionsToday.length + privateSessionsTodaySnap.size,
      unscheduledPrivateStudentsThisMonth,
      totalPrivateStudents,
      unpaidStudentsThisMonth,
      unpaidStudentsByMonth,
    },
    sessionsToday,
    recentPayments,
    metricsMonth: thisMonth,
    metricsVersion: DASHBOARD_METRICS_VERSION,
    cachedAt: Date.now(),
  }
}

// Shared revision invalidation refreshes all workers after business mutations.
router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const view = await readView('dashboard', `v${DASHBOARD_METRICS_VERSION}-${dateInVietnam()}`, computeDashboard, undefined, false, DASHBOARD_TTL_MS)
    res.json(view.data)
  } catch (err) { next(err) }
})

router.post('/refresh', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const today = dateInVietnam()
    await getCachedTuitionSummary(Number(today.slice(5, 7)), Number(today.slice(0, 4)), true)
    const view = await readView('dashboard', `v${DASHBOARD_METRICS_VERSION}-${today}`, computeDashboard, undefined, true, DASHBOARD_TTL_MS)
    res.json(view.data)
  } catch (err) { next(err) }
})

// GET /api/dashboard/revenue — Doanh thu 12 tháng gần nhất
router.get('/revenue', requireRole('ADMIN', 'STAFF'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const view = await readView('dashboard', `revenue-${dateInVietnam().slice(0, 7)}`, async () => {
      const [currentYear, currentMonth] = dateInVietnam().slice(0, 7).split('-').map(Number)

      // Tính khoảng 12 tháng
      const monthRanges = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(Date.UTC(currentYear, currentMonth - 1 - (11 - i), 1))
        return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
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

      return months
    }, undefined, false, REVENUE_TTL_MS)
    res.json(view.data)
  } catch (err) {
    next(err)
  }
})

// GET /api/dashboard/students-by-grade
router.get('/students-by-grade', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const view = await readView('dashboard', 'students-by-grade', async () => {
      const index = await getStudentIndex()
      const students = index.data!.filter(student => student.status === 'ACTIVE')

      const groups = new Map<number, number>()
      for (const s of students) {
        if (s.gradeLevel) {
          groups.set(s.gradeLevel, (groups.get(s.gradeLevel) ?? 0) + 1)
        }
      }

      const result = Array.from(groups.entries())
        .map(([gradeLevel, count]) => ({ gradeLevel, count }))
        .sort((a, b) => a.gradeLevel - b.gradeLevel)

      return result
    }, undefined, false, STUDENTS_BY_GRADE_TTL_MS)
    res.json(view.data)
  } catch (err) {
    next(err)
  }
})

export default router
