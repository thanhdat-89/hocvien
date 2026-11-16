import { Router, Request, Response, NextFunction } from 'express'
import { prisma, api } from '../lib/db'
import {
  classDoc, classInclude, enrollmentDoc, enrollmentInclude, monthlyScoreDoc, monthlyScoreInclude, paymentDoc, paymentInclude,
  privateSessionDoc, privateSessionInclude, scheduleDoc, scheduleInclude, tuitionRecordDoc, tuitionRecordInclude,
} from '../lib/docs'
import { s } from '../lib/params'
import { computeTuitionSummary, loadStudentPromotions } from '../lib/tuition'
import { currentClassNames } from '../lib/classDisplayNames'
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

// In-memory response cache when parents refresh repeatedly.
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

    const studentRow = await prisma.student.findUnique({ where: { id: studentId } })
    if (!studentRow) {
      res.status(404).json({ message: 'Không tìm thấy học viên' })
      return
    }
    const student: Student = api(studentRow)

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
    const enrollments: ClassEnrollment[] = (await prisma.classEnrollment.findMany({
      where: { studentId, status: 'ACTIVE' }, include: enrollmentInclude,
    })).map(enrollmentDoc)
    const classIds = enrollments.map(e => e.classId)

    const classesById = new Map<string, Class>()
    const schedulesByClass = new Map<string, Schedule[]>()

    if (classIds.length > 0) {
      const [classes, schedules] = await Promise.all([
        prisma.class.findMany({ where: { id: { in: classIds } }, include: classInclude }),
        prisma.schedule.findMany({ where: { classId: { in: classIds } }, include: scheduleInclude }),
      ])
      classes.map(classDoc).forEach((c: Class) => classesById.set(c.id, c))
      schedules.map(scheduleDoc).forEach((sc: Schedule) => {
        const arr = schedulesByClass.get(sc.classId) ?? []
        arr.push(sc)
        schedulesByClass.set(sc.classId, arr)
      })
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
    const [tuitionRows, paymentRows] = await Promise.all([
      prisma.tuitionRecord.findMany({ where: { studentId }, include: tuitionRecordInclude }),
      prisma.payment.findMany({ where: { tuitionRecord: { studentId } }, include: paymentInclude }),
    ])
    const tuitionRecords: TuitionRecord[] = tuitionRows.map(tuitionRecordDoc)

    const paymentsByTuition = new Map<string, Payment[]>()
    paymentRows.map(paymentDoc).forEach((p: Payment) => {
      const arr = paymentsByTuition.get(p.tuitionRecordId) ?? []
      arr.push(p)
      paymentsByTuition.set(p.tuitionRecordId, arr)
    })

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
    const [reviewRows, scoreRows] = await Promise.all([
      prisma.studentReview.findMany({ where: { studentId }, orderBy: { month: 'desc' } }),
      prisma.monthlyScore.findMany({ where: { studentId }, include: monthlyScoreInclude }),
    ])
    const reviews: PublicReview[] = reviewRows.map(r => ({
      id: r.month, // API cũ dùng tháng làm id nhận xét
      month: r.month,
      content: r.content,
      teacherName: r.teacherName ?? undefined,
      updatedAt: r.updatedAt.toISOString(),
    }))
    const scoreDocs = scoreRows.map(monthlyScoreDoc)
    const scoreNames = await currentClassNames(scoreDocs.map((m: any) => String(m.classId || '')))
    const monthlyScores = scoreDocs
      .sort((a, b) => (b.year - a.year) || (b.month - a.month) || (scoreNames.get(a.classId) ?? a.className ?? '').localeCompare(scoreNames.get(b.classId) ?? b.className ?? '', 'vi'))
      .map(m => ({
        id: m.id,
        classId: m.classId,
        className: scoreNames.get(m.classId) || m.className,
        year: m.year,
        month: m.month,
        expectedCount: m.expectedCount,
        scores: m.scores ?? [],
        notes: m.notes,
      }))

    const [tuitionSummary, promotions, privateSessionsRaw] = await Promise.all([
      computeTuitionSummary(studentId),
      loadStudentPromotions(studentId),
      prisma.privateSession.findMany({ where: { studentId }, include: privateSessionInclude }),
    ])

    const startOfMonth = new Date().toISOString().slice(0, 7) + '-01'
    const privateSchedules = (privateSessionsRaw.map(privateSessionDoc) as PrivateSession[])
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

// GET /api/public/payments/:studentId?month=&year=
// Trả về tóm tắt thanh toán tháng để public page polling realtime.
// Không cache — caller dùng để check trạng thái sau khi CK.
router.get('/payments/:studentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.studentId)
    const month = Number(req.query.month) || (new Date().getMonth() + 1)
    const year = Number(req.query.year) || new Date().getFullYear()

    const studentRow = await prisma.student.findUnique({ where: { id: studentId }, select: { status: true } })
    if (!studentRow || studentRow.status !== 'ACTIVE') {
      res.status(404).json({ message: 'Học viên không khả dụng' })
      return
    }

    const records: TuitionRecord[] = (await prisma.tuitionRecord.findMany({
      where: { studentId, billingMonth: month, billingYear: year }, include: tuitionRecordInclude,
    })).map(tuitionRecordDoc)
    if (records.length === 0) {
      res.json({ month, year, records: [], totalFinalAmount: 0, totalPaid: 0 })
      return
    }

    const payments = (await prisma.payment.findMany({
      where: { tuitionRecordId: { in: records.map(r => r.id).slice(0, 10) } }, include: paymentInclude,
    })).map(paymentDoc) as Payment[]

    const result = records.map(r => {
      const paid = payments.filter(p => p.tuitionRecordId === r.id)
        .reduce((sum, p) => sum + (p.amount || 0), 0)
      return {
        id: r.id,
        classId: r.classId,
        className: r.className,
        finalAmount: r.finalAmount,
        totalPaid: paid,
        status: r.status,
      }
    })

    const totalFinalAmount = result.reduce((s, r) => s + r.finalAmount, 0)
    const totalPaid = result.reduce((s, r) => s + r.totalPaid, 0)
    res.json({ month, year, records: result, totalFinalAmount, totalPaid })
  } catch (err) {
    next(err)
  }
})

export default router
