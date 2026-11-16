import { Router, Response, NextFunction } from 'express'
import { prisma, toClassId } from '../lib/db'
import { enrollmentDoc, enrollmentInclude, monthlyScoreDoc, monthlyScoreInclude, privateSessionDoc, privateSessionInclude, sessionDoc, sessionInclude } from '../lib/docs'
import { s } from '../lib/params'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { MonthlyScores, Session, PrivateSession, ClassEnrollment, Class } from '../types/models'
import { currentClassNames, displayClassName } from '../lib/classDisplayNames'

const router = Router()
router.use(authenticate)

const MAX_SCORE = 10
const PRIVATE_CLASS_ID = 'private'
const PRIVATE_CLASS_NAME = 'Học riêng'

const monthKey = (y: number, m: number) => `${y}${String(m).padStart(2, '0')}`
const rowId = (studentId: string, classId: string, y: number, m: number) =>
  `${studentId}_${classId}_${monthKey(y, m)}`
const now = () => new Date().toISOString()
const inMonth = (date: string, y: number, m: number) =>
  date && date.length >= 7 && date.startsWith(`${y}-${String(m).padStart(2, '0')}`)

interface RowOut {
  id: string
  studentId: string
  studentName: string
  classId: string
  className: string
  year: number
  month: number
  expectedCount: number
  scores: (number | null)[]
  notes?: string
  updatedAt?: string
}

/**
 * Build the spreadsheet rows for (year, month, optional classId).
 * For each (student, class) where class has ≥1 non-cancelled session in month → 1 row.
 * For each student with ≥1 non-cancelled private session in month → 1 row (classId="private").
 *
 * If a row's monthlyScore doc exists, hydrate scores/notes from it; else default empty.
 * No documents are created here — first PUT will create the doc.
 */
async function buildRows(year: number, month: number, classFilter?: string): Promise<RowOut[]> {
  const inMonthRange = { gte: new Date(Date.UTC(year, month - 1, 1)), lte: new Date(Date.UTC(year, month, 0)) }

  const rows: RowOut[] = []
  const usedIds = new Set<string>()

  // ─── Class rows ────────────────────────────────────────────
  if (classFilter !== PRIVATE_CLASS_ID) {
    const sessions: Session[] = (await prisma.session.findMany({ where: { sessionDate: inMonthRange }, include: sessionInclude })).map(sessionDoc)

    // Group sessions by class, count non-cancelled
    const sessionCountByClass = new Map<string, { count: number; className: string }>()
    sessions.forEach(sess => {
      if (sess.status === 'CANCELLED') return
      if (classFilter && sess.classId !== classFilter) return
      const ent = sessionCountByClass.get(sess.classId)
      if (ent) ent.count += 1
      else sessionCountByClass.set(sess.classId, { count: 1, className: sess.className })
    })

    // For each class, list active enrollments
    for (const [classId, { count: expectedCount, className }] of sessionCountByClass) {
      const enrollments: ClassEnrollment[] = (await prisma.classEnrollment.findMany({
        where: { classId, status: 'ACTIVE' }, include: enrollmentInclude,
      })).map(enrollmentDoc)
      enrollments.forEach(en => {
        rows.push({
          id: rowId(en.studentId, classId, year, month),
          studentId: en.studentId,
          studentName: en.studentName,
          classId,
          className,
          year, month,
          expectedCount,
          scores: Array.from({ length: expectedCount }, () => null),
        })
      })
    }
  }

  // ─── Private rows ──────────────────────────────────────────
  if (!classFilter || classFilter === PRIVATE_CLASS_ID) {
    const privates: PrivateSession[] = (await prisma.privateSession.findMany({ where: { sessionDate: inMonthRange }, include: privateSessionInclude })).map(privateSessionDoc)
    const countByStudent = new Map<string, { count: number; name: string }>()
    privates.forEach(ps => {
      if (ps.status === 'CANCELLED') return
      const ent = countByStudent.get(ps.studentId)
      if (ent) ent.count += 1
      else countByStudent.set(ps.studentId, { count: 1, name: ps.studentName })
    })
    for (const [studentId, { count, name }] of countByStudent) {
      rows.push({
        id: rowId(studentId, PRIVATE_CLASS_ID, year, month),
        studentId,
        studentName: name,
        classId: PRIVATE_CLASS_ID,
        className: PRIVATE_CLASS_NAME,
        year, month,
        expectedCount: count,
        scores: Array.from({ length: count }, () => null),
      })
    }
  }

  rows.forEach(r => usedIds.add(r.id))

  // ─── Hydrate from existing docs ────────────────────────────
  if (rows.length === 0) return rows
  const stored = (await prisma.monthlyScore.findMany({ where: { id: { in: [...usedIds] } }, include: monthlyScoreInclude })).map(monthlyScoreDoc) as MonthlyScores[]
  const docMap = new Map<string, MonthlyScores>(stored.map(d => [d.id, d]))
  rows.forEach(r => {
    const doc = docMap.get(r.id)
    if (!doc) return
    // Resize scores to expectedCount: keep existing values up to current expected length
    const filled: (number | null)[] = Array.from({ length: r.expectedCount }, (_, i) =>
      typeof doc.scores?.[i] === 'number' ? doc.scores[i] : null
    )
    r.scores = filled
    r.notes = doc.notes
    r.updatedAt = doc.updatedAt
  })

  const classNames = await currentClassNames(rows.map(row => row.classId))
  rows.forEach(row => { row.className = classNames.get(row.classId) || row.className })

  // Sort by class name, then student name
  rows.sort((a, b) => {
    const c = a.className.localeCompare(b.className, 'vi')
    return c !== 0 ? c : a.studentName.localeCompare(b.studentName, 'vi')
  })
  return rows
}

// GET /api/monthly-scores?year=&month=&classId=
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear()
    const month = parseInt(req.query.month as string) || (new Date().getMonth() + 1)
    const classId = (req.query.classId as string) || ''

    // GET cho phép mọi role xem (trường nhỏ, giáo viên cần xem tổng quan)
    // Quyền ghi (PUT) vẫn chặt: chỉ ADMIN/STAFF hoặc TEACHER của đúng lớp đó.
    const classFilter: string | undefined = classId || undefined
    const rows = await buildRows(year, month, classFilter)
    res.json({ year, month, rows })
  } catch (err) { next(err) }
})

// GET /api/monthly-scores/student/:studentId — toàn bộ tháng đã có điểm của 1 học viên
router.get('/student/:studentId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.studentId)
    const stored = (await prisma.monthlyScore.findMany({ where: { studentId }, include: monthlyScoreInclude })).map(monthlyScoreDoc) as MonthlyScores[]
    const classNames = await currentClassNames(stored.map(row => row.classId))
    const docs = stored.map(row => displayClassName(row, classNames))
      .sort((a, b) => (b.year - a.year) || (b.month - a.month) || a.className.localeCompare(b.className, 'vi'))
    res.json(docs)
  } catch (err) { next(err) }
})

// PUT /api/monthly-scores/:rowId  — autosave 1 ô hoặc notes
// rowId = `${studentId}_${classId|private}_${YYYYMM}`
router.put('/:rowId', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = s(req.params.rowId)
    const parts = id.split('_')
    if (parts.length < 3) { res.status(400).json({ message: 'rowId không hợp lệ' }); return }
    const ymPart = parts[parts.length - 1]
    if (!/^\d{6}$/.test(ymPart)) { res.status(400).json({ message: 'rowId không hợp lệ' }); return }
    const year = parseInt(ymPart.slice(0, 4))
    const month = parseInt(ymPart.slice(4, 6))
    const classId = parts[parts.length - 2]
    const studentId = parts.slice(0, -2).join('_')

    const body = req.body as { index?: number; score?: number | null; notes?: string }

    // Recompute expectedCount on every PUT (in case sessions changed)
    const inMonthRange = { gte: new Date(Date.UTC(year, month - 1, 1)), lte: new Date(Date.UTC(year, month, 0)) }

    let expectedCount = 0
    let className = ''
    let studentName = ''

    if (classId === PRIVATE_CLASS_ID) {
      const privates: PrivateSession[] = (await prisma.privateSession.findMany({
        where: { studentId, sessionDate: inMonthRange }, include: privateSessionInclude,
      })).map(privateSessionDoc)
      privates.forEach(ps => {
        if (ps.status === 'CANCELLED') return
        expectedCount += 1
        if (ps.studentName) studentName = ps.studentName
      })
      className = PRIVATE_CLASS_NAME
    } else {
      const [sessionCount, cls, student] = await Promise.all([
        prisma.session.count({ where: { classId, sessionDate: inMonthRange, status: { not: 'CANCELLED' } } }),
        prisma.class.findUnique({ where: { id: classId }, select: { name: true } }),
        prisma.student.findUnique({ where: { id: studentId }, select: { fullName: true } }),
      ])
      expectedCount = sessionCount
      className = cls?.name || ''
      studentName = student?.fullName ?? ''
    }

    // RBAC: TEACHER chỉ chấm lớp họ phụ trách
    if (req.user?.role === 'TEACHER' && classId !== PRIVATE_CLASS_ID) {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.userId }, select: { id: true } })
      const teacherDocId = teacher?.id ?? null
      const cls = await prisma.class.findUnique({ where: { id: classId }, select: { teacherId: true } })
      const classTeacherId = cls?.teacherId ?? null
      if (!teacherDocId || classTeacherId !== teacherDocId) {
        res.status(403).json({ message: 'Không có quyền chấm lớp này' }); return
      }
    }

    if (expectedCount === 0) { res.status(400).json({ message: 'Tháng này chưa có buổi học' }); return }

    // Load existing or seed
    const existingRow = await prisma.monthlyScore.findUnique({ where: { id }, include: monthlyScoreInclude })
    const existing = existingRow ? monthlyScoreDoc(existingRow) as MonthlyScores : null
    const scores: (number | null)[] = Array.from({ length: expectedCount }, (_, i) =>
      typeof existing?.scores?.[i] === 'number' ? existing.scores[i] : null
    )

    // Apply patch
    if (typeof body.index === 'number') {
      const i = Math.floor(body.index)
      if (i < 0 || i >= expectedCount) { res.status(400).json({ message: 'index ngoài phạm vi' }); return }
      if (body.score === null) {
        scores[i] = null
      } else if (typeof body.score === 'number') {
        if (!Number.isFinite(body.score) || body.score < 0 || body.score > MAX_SCORE) {
          res.status(400).json({ message: `Điểm phải từ 0 đến ${MAX_SCORE}` }); return
        }
        scores[i] = Math.round(body.score * 4) / 4   // làm tròn 0.25
      } else {
        res.status(400).json({ message: 'score không hợp lệ' }); return
      }
    }

    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : (existing?.notes ?? undefined)

    const data: Omit<MonthlyScores, 'id'> = {
      studentId,
      studentName: studentName || existing?.studentName || '',
      classId,
      className: className || existing?.className || '',
      year, month,
      expectedCount,
      scores,
      maxScore: MAX_SCORE,
      notes,
      updatedAt: now(),
      updatedBy: req.user!.userId,
    }
    // Ghi đè toàn bộ dòng như set({ merge: false }); classId "private" → NULL.
    const fields = {
      studentId, classId: toClassId(classId), className: data.className, year, month, expectedCount, scores,
      maxScore: MAX_SCORE, notes: notes ?? null, updatedAt: new Date(), updatedBy: data.updatedBy,
    }
    await prisma.monthlyScore.upsert({ where: { id }, create: { id, ...fields }, update: fields })

    req.activity = {
      description: `Chấm điểm ${data.className} — ${data.studentName} tháng ${month}/${year}`,
      resourceType: 'monthly-scores',
      resourceId: id,
      after: { scores, notes, expectedCount },
    }
    res.json({ id, ...data })
  } catch (err) { next(err) }
})

export default router
