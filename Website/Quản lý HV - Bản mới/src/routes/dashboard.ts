import { Router, Response, NextFunction } from 'express'
import { db, C, toDocs } from '../lib/firebase'
import { authenticate } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { Session, TuitionRecord, Payment, Student } from '../types/models'

const router = Router()
router.use(authenticate)

// GET /api/dashboard
router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const thisMonth = today.slice(0, 7) // "YYYY-MM"
    const thisYear = Number(today.slice(0, 4))
    const thisMonthNum = Number(today.slice(5, 7))

    const [
      activeStudentsSnap,
      activeClassesSnap,
      sessionsTodaySnap,
      newStudentsSnap,
      revenueSnap,
      overdueSnap,
      recentPaymentsSnap,
    ] = await Promise.all([
      db.collection(C.STUDENTS).where('status', '==', 'ACTIVE').get(),
      db.collection(C.CLASSES).where('status', '==', 'ACTIVE').get(),
      db.collection(C.SESSIONS).where('sessionDate', '==', today).get(),
      db.collection(C.STUDENTS)
        .where('enrollmentDate', '>=', `${thisMonth}-01`)
        .where('enrollmentDate', '<=', `${thisMonth}-31`)
        .get(),
      db.collection(C.PAYMENTS)
        .where('paymentDate', '>=', `${thisMonth}-01`)
        .where('paymentDate', '<=', `${thisMonth}-31`)
        .get(),
      db.collection(C.TUITION_RECORDS)
        .where('dueDate', '<', today)
        .get(),
      db.collection(C.PAYMENTS).orderBy('createdAt', 'desc').limit(10).get(),
    ])

    const revenueThisMonth = toDocs<Payment>(revenueSnap)
      .reduce((sum, p) => sum + p.amount, 0)

    const overdueCount = toDocs<TuitionRecord>(overdueSnap)
      .filter(r => r.status === 'PENDING' || r.status === 'PARTIAL').length

    const sessionsToday = toDocs<Session>(sessionsTodaySnap)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))

    const recentPayments = toDocs<Payment>(recentPaymentsSnap)

    res.json({
      stats: {
        totalActiveStudents: activeStudentsSnap.size,
        totalActiveClasses: activeClassesSnap.size,
        newStudentsThisMonth: newStudentsSnap.size,
        revenueThisMonth,
        overdueCount,
        sessionsTodayCount: sessionsToday.length,
      },
      sessionsToday,
      recentPayments,
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/dashboard/revenue — Doanh thu 12 tháng gần nhất
router.get('/revenue', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const today = new Date()
    const months: Array<{ year: number; month: number; revenue: number }> = []

    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      const year = d.getFullYear()
      const month = d.getMonth() + 1
      const monthStr = `${year}-${String(month).padStart(2, '0')}`

      const snap = await db.collection(C.PAYMENTS)
        .where('paymentDate', '>=', `${monthStr}-01`)
        .where('paymentDate', '<=', `${monthStr}-31`)
        .get()

      const revenue = toDocs<Payment>(snap).reduce((sum, p) => sum + p.amount, 0)
      months.push({ year, month, revenue })
    }

    res.json(months)
  } catch (err) {
    next(err)
  }
})

// GET /api/dashboard/students-by-grade
router.get('/students-by-grade', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
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

    res.json(result)
  } catch (err) {
    next(err)
  }
})

export default router
