import { Router, Response, NextFunction } from 'express'
import { prisma, toDay } from '../lib/db'
import { paymentDoc, paymentInclude, sessionDoc, sessionInclude } from '../lib/docs'
import { getCachedTuitionSummary } from '../services/tuitionReadView'
import { getMissingPrivateStudents, readView } from '../services/readViews'
import { getStudentIndex } from '../services/studentReadView'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import { viewedSchoolYearId } from '../lib/branchContext'
import type { Session } from '../types/models'

/** Ngày đầu và cuối tháng "YYYY-MM" cho cột @db.Date. */
function monthRange(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return { gte: new Date(Date.UTC(year, month - 1, 1)), lte: new Date(Date.UTC(year, month, 0)) }
}

const router = Router()
router.use(authenticate)

const DASHBOARD_TTL_MS = 5 * 60 * 1000 // 5 phút
const REVENUE_TTL_MS = 12 * 60 * 60 * 1000 // 12 giờ
const STUDENTS_BY_GRADE_TTL_MS = 10 * 60 * 1000 // 10 phút
const DASHBOARD_METRICS_VERSION = 7

function dateInVietnam(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
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


async function computeDashboard(force = false) {
  const today = dateInVietnam()
  const thisMonth = today.slice(0, 7)

  const todayDate = toDay(today)!
  const [
    studentsIndex,
    activeClassCount,
    sessionsTodayRows,
    privateSessionsTodayCount,
    newStudentsCount,
    revenue,
    overdueCount,
    recentPaymentRows,
  ] = await Promise.all([
    getStudentIndex(),
    prisma.class.count({ where: { status: 'ACTIVE', schoolYearId: await viewedSchoolYearId() } }),
    prisma.session.findMany({ where: { sessionDate: todayDate }, include: sessionInclude }),
    prisma.privateSession.count({ where: { sessionDate: todayDate } }),
    prisma.student.count({ where: { enrollmentDate: monthRange(thisMonth) } }),
    prisma.payment.aggregate({ where: { paymentDate: monthRange(thisMonth) }, _sum: { amount: true } }),
    prisma.tuitionRecord.count({ where: { dueDate: { lt: todayDate }, status: { in: ['PENDING', 'PARTIAL'] } } }),
    prisma.payment.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: paymentInclude }),
  ])
  const activeStudents = studentsIndex.data!.filter(student => student.status === 'ACTIVE')

  const revenueThisMonth = revenue._sum.amount ?? 0
  const sessionsToday: Session[] = sessionsTodayRows.map(sessionDoc)
    .sort((a: Session, b: Session) => a.startTime.localeCompare(b.startTime))
  const recentPayments = recentPaymentRows.map(paymentDoc)

  let unscheduledPrivateStudentsThisMonth: number | null = null
  let totalPrivateStudents: number | null = null
  let unpaidStudentsThisMonth: number | null = null
  let unpaidStudentsByMonth: Array<{ year: number; month: number; count: number }> = []
  try {
    const [enrollments, missingPrivateStudents] = await Promise.all([
      prisma.classEnrollment.findMany({ where: { status: 'ACTIVE' }, select: { studentId: true } }),
      getMissingPrivateStudents(Number(thisMonth.slice(5)), Number(thisMonth.slice(0, 4)), undefined, force),
    ])
    const enrolledStudents = new Set(enrollments.map(e => e.studentId))
    const privateStudents = activeStudents.filter(s => !enrolledStudents.has(s.id))
    totalPrivateStudents = privateStudents.length
    // Count the exact list shown by /students/private-schedule/missing, including its eligibility rules.
    unscheduledPrivateStudentsThisMonth = missingPrivateStudents.data!.length

  } catch (error: any) {
    console.warn('[Dashboard] monthly metrics unavailable', error?.code ?? error?.name ?? 'unknown')
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
      totalActiveClasses: activeClassCount,
      newStudentsThisMonth: newStudentsCount,
      revenueThisMonth,
      overdueCount,
      sessionsTodayCount: sessionsToday.length + privateSessionsTodayCount,
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
    const view = await readView('dashboard', `v${DASHBOARD_METRICS_VERSION}-${today}`, () => computeDashboard(true), undefined, true, DASHBOARD_TTL_MS)
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

      // Một truy vấn gộp theo tháng cho cả 12 tháng (tham số là chuỗi ngày → không phụ thuộc múi giờ phiên)
      const first = monthRanges[0], last = monthRanges[monthRanges.length - 1]
      const rows = await prisma.$queryRaw<{ ym: string; revenue: bigint }[]>`
        SELECT to_char("paymentDate", 'YYYY-MM') AS ym, SUM(amount)::bigint AS revenue FROM payments
        WHERE "paymentDate" BETWEEN ${new Date(Date.UTC(first.year, first.month - 1, 1)).toISOString().slice(0, 10)}::date
          AND ${new Date(Date.UTC(last.year, last.month, 0)).toISOString().slice(0, 10)}::date
        GROUP BY 1`
      const byMonth = new Map(rows.map(r => [r.ym, Number(r.revenue)]))

      const months = monthRanges.map(r => ({
        ...r,
        revenue: byMonth.get(`${r.year}-${String(r.month).padStart(2, '0')}`) ?? 0,
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
