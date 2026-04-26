import { Router, Response, NextFunction } from 'express'
import { db, C, s, toDocs } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'

const router = Router()
router.use(authenticate)

const now = () => new Date().toISOString()

interface TestScore {
  id: string
  testName: string
  testDate: string         // YYYY-MM-DD
  score: number
  maxScore: number
  classId?: string
  className?: string
  notes?: string
  teacherId?: string
  teacherName?: string
  createdAt: string
  updatedAt: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validatePayload(body: any): { ok: true; data: Omit<TestScore, 'id' | 'createdAt' | 'updatedAt'> } | { ok: false; message: string } {
  const testName = (body?.testName ?? '').toString().trim()
  if (!testName) return { ok: false, message: 'Tên bài kiểm tra không được trống' }

  const testDate = (body?.testDate ?? '').toString().trim()
  if (!DATE_RE.test(testDate)) return { ok: false, message: 'Ngày kiểm tra không hợp lệ (YYYY-MM-DD)' }

  const score = Number(body?.score)
  if (!Number.isFinite(score) || score < 0) return { ok: false, message: 'Điểm số không hợp lệ' }

  const maxScore = Number(body?.maxScore ?? 10)
  if (!Number.isFinite(maxScore) || maxScore <= 0) return { ok: false, message: 'Thang điểm không hợp lệ' }
  if (score > maxScore) return { ok: false, message: `Điểm không được lớn hơn thang điểm (${maxScore})` }

  return {
    ok: true,
    data: {
      testName,
      testDate,
      score,
      maxScore,
      classId: body?.classId || undefined,
      className: body?.className || undefined,
      notes: body?.notes ? String(body.notes).trim() : undefined,
      teacherId: body?.teacherId || undefined,
      teacherName: body?.teacherName || undefined,
    },
  }
}

// GET /api/test-scores/:studentId — list scores newest first
router.get('/:studentId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.studentId)
    const snap = await db.collection(C.STUDENTS).doc(studentId)
      .collection('testScores').get()
    const scores = toDocs<TestScore>(snap)
      .sort((a, b) => b.testDate.localeCompare(a.testDate))
    res.json(scores)
  } catch (err) { next(err) }
})

// POST /api/test-scores/:studentId — create
router.post('/:studentId', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.studentId)
    const v = validatePayload(req.body)
    if (!v.ok) { res.status(400).json({ message: v.message }); return }

    const ref = db.collection(C.STUDENTS).doc(studentId).collection('testScores').doc()
    const teacherId = req.user?.role === 'TEACHER' ? req.user.userId : v.data.teacherId
    const data = {
      ...v.data,
      teacherId,
      createdAt: now(),
      updatedAt: now(),
    }
    await ref.set(data)
    res.status(201).json({ id: ref.id, ...data })
  } catch (err) { next(err) }
})

// PUT /api/test-scores/:studentId/:scoreId — update
router.put('/:studentId/:scoreId', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.studentId)
    const scoreId = s(req.params.scoreId)
    const v = validatePayload(req.body)
    if (!v.ok) { res.status(400).json({ message: v.message }); return }

    const ref = db.collection(C.STUDENTS).doc(studentId).collection('testScores').doc(scoreId)
    const existing = await ref.get()
    if (!existing.exists) { res.status(404).json({ message: 'Không tìm thấy điểm' }); return }

    const data = { ...v.data, updatedAt: now() }
    await ref.set(data, { merge: true })
    res.json({ id: scoreId, ...existing.data(), ...data })
  } catch (err) { next(err) }
})

// DELETE /api/test-scores/:studentId/:scoreId
router.delete('/:studentId/:scoreId', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.studentId)
    const scoreId = s(req.params.scoreId)
    await db.collection(C.STUDENTS).doc(studentId).collection('testScores').doc(scoreId).delete()
    res.json({ message: 'Đã xoá điểm' })
  } catch (err) { next(err) }
})

export default router
