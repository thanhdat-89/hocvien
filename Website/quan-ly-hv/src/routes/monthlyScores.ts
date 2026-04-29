import { Router, Response, NextFunction } from 'express'
import { db, C, s, toObj } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { MonthlyScores, Session, PrivateSession, ClassEnrollment, Class } from '../types/models'

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
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
  const monthStart = `${monthPrefix}-01`
  const monthEnd = `${monthPrefix}-31`

  const rows: RowOut[] = []
  const usedIds = new Set<string>()

  // ─── Class rows ────────────────────────────────────────────
  if (classFilter !== PRIVATE_CLASS_ID) {
    const sessionsSnap = await db.collection(C.SESSIONS)
      .where('sessionDate', '>=', monthStart)
      .where('sessionDate', '<=', monthEnd)
      .get()

    // Group sessions by class, count non-cancelled
    const sessionCountByClass = new Map<string, { count: number; className: string }>()
    sessionsSnap.docs.forEach(d => {
      const sess = d.data() as Session
      if (sess.status === 'CANCELLED') return
      if (classFilter && sess.classId !== classFilter) return
      const ent = sessionCountByClass.get(sess.classId)
      if (ent) ent.count += 1
      else sessionCountByClass.set(sess.classId, { count: 1, className: sess.className })
    })

    // For each class, list active enrollments
    for (const [classId, { count: expectedCount, className }] of sessionCountByClass) {
      const enrollSnap = await db.collection(C.ENROLLMENTS)
        .where('classId', '==', classId)
        .where('status', '==', 'ACTIVE')
        .get()
      enrollSnap.docs.forEach(e => {
        const en = e.data() as ClassEnrollment
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
    const psSnap = await db.collection(C.PRIVATE_SCHEDULES)
      .where('sessionDate', '>=', monthStart)
      .where('sessionDate', '<=', monthEnd)
      .get()
    const countByStudent = new Map<string, { count: number; name: string }>()
    psSnap.docs.forEach(d => {
      const ps = d.data() as PrivateSession
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
  const ids = [...usedIds]
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30))
  const docs = await Promise.all(chunks.map(chunk =>
    db.collection(C.MONTHLY_SCORES).where('__name__', 'in', chunk).get()
  ))
  const docMap = new Map<string, MonthlyScores>()
  docs.forEach(snap => snap.docs.forEach(d => docMap.set(d.id, toObj<MonthlyScores>(d))))
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

    // RBAC: TEACHER chỉ được xem lớp mình phụ trách (Class.teacherId === teacher doc ID)
    const classFilter: string | undefined = classId || undefined
    if (req.user?.role === 'TEACHER') {
      const teacherSnap = await db.collection(C.TEACHERS).where('userId', '==', req.user.userId).limit(1).get()
      const teacherDocId = teacherSnap.empty ? null : teacherSnap.docs[0].id
      const allowedClassesSnap = teacherDocId
        ? await db.collection(C.CLASSES).where('teacherId', '==', teacherDocId).get()
        : null
      const allowed = new Set(allowedClassesSnap?.docs.map(d => d.id) ?? [])

      if (classFilter && classFilter !== PRIVATE_CLASS_ID && !allowed.has(classFilter)) {
        res.status(403).json({ message: 'Không có quyền xem lớp này' }); return
      }
      const rows = await buildRows(year, month, classFilter)
      const filtered = rows.filter(r => allowed.has(r.classId) || r.classId === PRIVATE_CLASS_ID)
      res.json({ year, month, rows: filtered }); return
    }

    const rows = await buildRows(year, month, classFilter)
    res.json({ year, month, rows })
  } catch (err) { next(err) }
})

// GET /api/monthly-scores/student/:studentId — toàn bộ tháng đã có điểm của 1 học viên
router.get('/student/:studentId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.studentId)
    const snap = await db.collection(C.MONTHLY_SCORES).where('studentId', '==', studentId).get()
    const docs = snap.docs.map(d => toObj<MonthlyScores>(d))
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
    const ref = db.collection(C.MONTHLY_SCORES).doc(id)

    // Recompute expectedCount on every PUT (in case sessions changed)
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
    const monthStart = `${monthPrefix}-01`
    const monthEnd = `${monthPrefix}-31`

    let expectedCount = 0
    let className = ''
    let studentName = ''

    if (classId === PRIVATE_CLASS_ID) {
      const psSnap = await db.collection(C.PRIVATE_SCHEDULES)
        .where('studentId', '==', studentId)
        .where('sessionDate', '>=', monthStart)
        .where('sessionDate', '<=', monthEnd)
        .get()
      psSnap.docs.forEach(d => {
        const ps = d.data() as PrivateSession
        if (ps.status === 'CANCELLED') return
        expectedCount += 1
        if (ps.studentName) studentName = ps.studentName
      })
      className = PRIVATE_CLASS_NAME
    } else {
      const [sessionsSnap, classDoc, studentDoc] = await Promise.all([
        db.collection(C.SESSIONS)
          .where('classId', '==', classId)
          .where('sessionDate', '>=', monthStart)
          .where('sessionDate', '<=', monthEnd)
          .get(),
        db.collection(C.CLASSES).doc(classId).get(),
        db.collection(C.STUDENTS).doc(studentId).get(),
      ])
      sessionsSnap.docs.forEach(d => {
        const sess = d.data() as Session
        if (sess.status !== 'CANCELLED') expectedCount += 1
      })
      className = (classDoc.exists ? (classDoc.data() as Class).name : '') || ''
      studentName = studentDoc.exists ? ((studentDoc.data() as { fullName?: string }).fullName ?? '') : ''
    }

    // RBAC: TEACHER chỉ chấm lớp họ phụ trách
    if (req.user?.role === 'TEACHER' && classId !== PRIVATE_CLASS_ID) {
      const teacherSnap = await db.collection(C.TEACHERS).where('userId', '==', req.user.userId).limit(1).get()
      const teacherDocId = teacherSnap.empty ? null : teacherSnap.docs[0].id
      const cls = await db.collection(C.CLASSES).doc(classId).get()
      const classTeacherId = cls.exists ? (cls.data() as Class).teacherId : null
      if (!teacherDocId || classTeacherId !== teacherDocId) {
        res.status(403).json({ message: 'Không có quyền chấm lớp này' }); return
      }
    }

    if (expectedCount === 0) { res.status(400).json({ message: 'Tháng này chưa có buổi học' }); return }

    // Load existing or seed
    const existingSnap = await ref.get()
    const existing = existingSnap.exists ? toObj<MonthlyScores>(existingSnap) : null
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
    await ref.set(data, { merge: false })

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
