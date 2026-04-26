import { Router, Response, NextFunction } from 'express'
import { db, C, s, toDocs, toObj } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { Class, ClassEnrollment, Student } from '../types/models'

const router = Router()
router.use(authenticate)

const now = () => new Date().toISOString()
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface Test {
  id: string
  name: string
  testDate: string         // YYYY-MM-DD
  classId: string
  className: string
  gradeLevel?: number
  maxScore: number
  teacherId?: string
  teacherName?: string
  notes?: string
  averageScore?: number
  submissionCount?: number
  createdAt: string
  updatedAt: string
}

function validateTestPayload(body: any): { ok: true; data: Omit<Test, 'id' | 'createdAt' | 'updatedAt' | 'averageScore' | 'submissionCount' | 'className' | 'gradeLevel'> & { className?: string; gradeLevel?: number } } | { ok: false; message: string } {
  const name = (body?.name ?? '').toString().trim()
  if (!name) return { ok: false, message: 'Tên bài kiểm tra không được trống' }

  const testDate = (body?.testDate ?? '').toString().trim()
  if (!DATE_RE.test(testDate)) return { ok: false, message: 'Ngày kiểm tra không hợp lệ (YYYY-MM-DD)' }

  const classId = (body?.classId ?? '').toString().trim()
  if (!classId) return { ok: false, message: 'Cần chọn lớp' }

  const maxScore = Number(body?.maxScore ?? 10)
  if (!Number.isFinite(maxScore) || maxScore <= 0) return { ok: false, message: 'Thang điểm không hợp lệ' }

  return {
    ok: true,
    data: {
      name,
      testDate,
      classId,
      maxScore,
      className: body?.className,
      gradeLevel: body?.gradeLevel,
      teacherId: body?.teacherId || undefined,
      teacherName: body?.teacherName || undefined,
      notes: body?.notes ? String(body.notes).trim() : undefined,
    },
  }
}

// GET /api/tests — list tests, optional filters
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { classId, gradeLevel, year, month } = req.query as Record<string, string>
    let query: FirebaseFirestore.Query = db.collection(C.TESTS)
    if (classId) query = query.where('classId', '==', classId)
    if (gradeLevel) query = query.where('gradeLevel', '==', Number(gradeLevel))

    const snap = await query.get()
    let tests = toDocs<Test>(snap)
    if (year && month) {
      const prefix = `${year}-${String(Number(month)).padStart(2, '0')}`
      tests = tests.filter(t => t.testDate.startsWith(prefix))
    } else if (year) {
      tests = tests.filter(t => t.testDate.startsWith(`${year}-`))
    }
    tests.sort((a, b) => b.testDate.localeCompare(a.testDate))
    res.json(tests)
  } catch (err) { next(err) }
})

// GET /api/tests/:testId
router.get('/:testId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await db.collection(C.TESTS).doc(s(req.params.testId)).get()
    if (!doc.exists) { res.status(404).json({ message: 'Không tìm thấy bài kiểm tra' }); return }
    res.json(toObj<Test>(doc))
  } catch (err) { next(err) }
})

// POST /api/tests — create
router.post('/', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const v = validateTestPayload(req.body)
    if (!v.ok) { res.status(400).json({ message: v.message }); return }

    let className = v.data.className
    let gradeLevel = v.data.gradeLevel
    if (!className || gradeLevel == null) {
      const classDoc = await db.collection(C.CLASSES).doc(v.data.classId).get()
      if (classDoc.exists) {
        const c = classDoc.data() as Class
        className = className || c.name
        gradeLevel = gradeLevel ?? (c as any).gradeLevel
      }
    }

    const teacherId = req.user?.role === 'TEACHER' ? req.user.userId : v.data.teacherId
    const ref = db.collection(C.TESTS).doc()
    const data: Omit<Test, 'id'> = {
      name: v.data.name,
      testDate: v.data.testDate,
      classId: v.data.classId,
      className: className || '',
      ...(gradeLevel != null ? { gradeLevel } : {}),
      maxScore: v.data.maxScore,
      ...(teacherId ? { teacherId } : {}),
      ...(v.data.teacherName ? { teacherName: v.data.teacherName } : {}),
      ...(v.data.notes ? { notes: v.data.notes } : {}),
      averageScore: 0,
      submissionCount: 0,
      createdAt: now(),
      updatedAt: now(),
    }
    await ref.set(data)
    res.status(201).json({ id: ref.id, ...data })
  } catch (err) { next(err) }
})

// PUT /api/tests/:testId — update test metadata
router.put('/:testId', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const testId = s(req.params.testId)
    const v = validateTestPayload(req.body)
    if (!v.ok) { res.status(400).json({ message: v.message }); return }

    const ref = db.collection(C.TESTS).doc(testId)
    const existing = await ref.get()
    if (!existing.exists) { res.status(404).json({ message: 'Không tìm thấy bài kiểm tra' }); return }

    let className = v.data.className
    let gradeLevel = v.data.gradeLevel
    if (!className || gradeLevel == null) {
      const classDoc = await db.collection(C.CLASSES).doc(v.data.classId).get()
      if (classDoc.exists) {
        const c = classDoc.data() as Class
        className = className || c.name
        gradeLevel = gradeLevel ?? (c as any).gradeLevel
      }
    }

    const data: Record<string, any> = {
      name: v.data.name,
      testDate: v.data.testDate,
      classId: v.data.classId,
      className: className || '',
      maxScore: v.data.maxScore,
      teacherName: v.data.teacherName ?? null,
      notes: v.data.notes ?? null,
      updatedAt: now(),
    }
    if (gradeLevel != null) data.gradeLevel = gradeLevel

    await ref.set(data, { merge: true })

    // If maxScore changed, denorm into linked scores so student page reflects it
    const oldMax = (existing.data() as Test).maxScore
    if (oldMax !== v.data.maxScore) {
      const scoresSnap = await db.collectionGroup('testScores').where('testId', '==', testId).get()
      const batch = db.batch()
      scoresSnap.docs.forEach(d => batch.update(d.ref, { maxScore: v.data.maxScore, testName: v.data.name, testDate: v.data.testDate, className: className || '' }))
      if (!scoresSnap.empty) await batch.commit()
    } else {
      // still propagate name/date/className
      const scoresSnap = await db.collectionGroup('testScores').where('testId', '==', testId).get()
      if (!scoresSnap.empty) {
        const batch = db.batch()
        scoresSnap.docs.forEach(d => batch.update(d.ref, { testName: v.data.name, testDate: v.data.testDate, className: className || '' }))
        await batch.commit()
      }
    }

    res.json({ id: testId, ...existing.data(), ...data })
  } catch (err) { next(err) }
})

// DELETE /api/tests/:testId — also cascade-delete linked scores
router.delete('/:testId', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const testId = s(req.params.testId)
    const scoresSnap = await db.collectionGroup('testScores').where('testId', '==', testId).get()
    const batch = db.batch()
    scoresSnap.docs.forEach(d => batch.delete(d.ref))
    batch.delete(db.collection(C.TESTS).doc(testId))
    await batch.commit()
    res.json({ message: 'Đã xoá bài kiểm tra', removedScores: scoresSnap.size })
  } catch (err) { next(err) }
})

// GET /api/tests/:testId/scores — list rows: all students linked to this class
router.get('/:testId/scores', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const testId = s(req.params.testId)
    const testDoc = await db.collection(C.TESTS).doc(testId).get()
    if (!testDoc.exists) { res.status(404).json({ message: 'Không tìm thấy bài kiểm tra' }); return }
    const test = toObj<Test>(testDoc)

    // Collect candidate studentIds from enrollments (any status — student may have
    // dropped before/after but still owns a score) and from session attendance as
    // a fallback for classes that track membership through sessions only.
    const [enrollSnap, attendanceSnap] = await Promise.all([
      db.collection(C.ENROLLMENTS).where('classId', '==', test.classId).get(),
      db.collection(C.STUDENT_ATTENDANCES).where('classId', '==', test.classId).limit(500).get(),
    ])
    const enrollments = toDocs<ClassEnrollment>(enrollSnap)
    const candidateIds = new Set<string>()
    enrollments.forEach(e => candidateIds.add(e.studentId))
    attendanceSnap.docs.forEach(d => {
      const sid = (d.data() as any).studentId
      if (sid) candidateIds.add(sid)
    })

    const studentIds = [...candidateIds]
    const studentDocs = await Promise.all(studentIds.map(id => db.collection(C.STUDENTS).doc(id).get()))
    const studentMap = new Map<string, Student>()
    studentDocs.forEach(d => { if (d.exists) studentMap.set(d.id, toObj<Student>(d)) })

    const scoresSnap = await db.collectionGroup('testScores').where('testId', '==', testId).get()
    const scoreMap = new Map<string, any>()
    scoresSnap.docs.forEach(d => {
      const data = d.data() as any
      const studentId = d.ref.parent.parent?.id
      if (studentId) scoreMap.set(studentId, { id: d.id, ...data })
    })

    const rows = studentIds
      .map(sid => {
        const stu = studentMap.get(sid)
        if (!stu || stu.status !== 'ACTIVE') return null
        const enroll = enrollments.find(e => e.studentId === sid)
        // Skip rows where the student is formally dropped from the class before
        // the test was held — they can't reasonably have a score for it.
        if (enroll && enroll.status === 'DROPPED') {
          const dropDate = (enroll as any).dropDate
          if (dropDate && dropDate < test.testDate) return null
        }
        const score = scoreMap.get(sid)
        return {
          studentId: sid,
          studentName: stu.fullName,
          gradeLevel: stu.gradeLevel,
          enrollmentStatus: enroll?.status ?? 'ATTENDED',
          scoreId: score?.id,
          score: score?.score ?? null,
          notes: score?.notes ?? '',
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.studentName.localeCompare(b.studentName, 'vi'))

    res.json({ test, rows })
  } catch (err) { next(err) }
})

// PUT /api/tests/:testId/scores — bulk upsert
// Body: { scores: [{ studentId, score, notes? }] }
router.put('/:testId/scores', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const testId = s(req.params.testId)
    const testDoc = await db.collection(C.TESTS).doc(testId).get()
    if (!testDoc.exists) { res.status(404).json({ message: 'Không tìm thấy bài kiểm tra' }); return }
    const test = toObj<Test>(testDoc)

    const incoming: any[] = Array.isArray(req.body?.scores) ? req.body.scores : []
    const teacherId = req.user?.role === 'TEACHER' ? req.user.userId : undefined
    const teacherName = req.body?.teacherName || test.teacherName || undefined

    const batch = db.batch()
    let kept = 0
    let total = 0
    let sum = 0

    for (const row of incoming) {
      const studentId = s(row?.studentId ?? '')
      if (!studentId) continue

      const scoreVal = row?.score
      const isEmpty = scoreVal === null || scoreVal === undefined || scoreVal === ''
      const studentScoresRef = db.collection(C.STUDENTS).doc(studentId).collection('testScores')
      // find existing score by testId
      const existingSnap = await studentScoresRef.where('testId', '==', testId).limit(1).get()
      const existingDoc = existingSnap.docs[0]

      if (isEmpty) {
        if (existingDoc) batch.delete(existingDoc.ref)
        continue
      }

      const num = Number(scoreVal)
      if (!Number.isFinite(num) || num < 0 || num > test.maxScore) {
        res.status(400).json({ message: `Điểm không hợp lệ cho học viên ${studentId} (phải từ 0 đến ${test.maxScore})` })
        return
      }
      kept++
      sum += num
      total++

      const data = {
        testId,
        testName: test.name,
        testDate: test.testDate,
        score: num,
        maxScore: test.maxScore,
        classId: test.classId,
        className: test.className,
        notes: row?.notes ? String(row.notes).trim() : undefined,
        teacherId: teacherId || test.teacherId || undefined,
        teacherName: teacherName,
        updatedAt: now(),
      }

      const ref = existingDoc ? existingDoc.ref : studentScoresRef.doc()
      batch.set(ref, existingDoc ? data : { ...data, createdAt: now() }, { merge: true })
    }

    // refresh test aggregates
    const avg = total > 0 ? Math.round((sum / total) * 100) / 100 : 0
    batch.set(db.collection(C.TESTS).doc(testId), { averageScore: avg, submissionCount: kept, updatedAt: now() }, { merge: true })

    await batch.commit()
    res.json({ message: 'Đã lưu điểm', count: kept, average: avg })
  } catch (err) { next(err) }
})

export default router
