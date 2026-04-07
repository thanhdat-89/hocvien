import { Router, Response, NextFunction } from 'express'
import { db, C, s, toDocs } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { StudentAttendance, TeacherAttendance } from '../types/models'

const router = Router()
router.use(authenticate)
const now = () => new Date().toISOString()

// ─── HỌC VIÊN ─────────────────────────────────────────────────

// GET /api/attendance/session/:sessionId — Điểm danh của 1 buổi
router.get('/session/:sessionId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const snap = await db.collection(C.STUDENT_ATTENDANCES)
      .where('sessionId', '==', req.params.sessionId)
      .get()
    const attendances = toDocs<StudentAttendance>(snap)
      .sort((a, b) => a.studentName.localeCompare(b.studentName))
    res.json(attendances)
  } catch (err) { next(err) }
})

// PUT /api/attendance/session/:sessionId/bulk — Cập nhật điểm danh cả buổi
// Body: { attendances: [{ studentAttendanceId, status, notes }] }
router.put('/session/:sessionId/bulk', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { attendances } = req.body as {
      attendances: Array<{ studentAttendanceId: string; status: string; notes?: string }>
    }

    const batch = db.batch()
    for (const a of attendances) {
      const ref = db.collection(C.STUDENT_ATTENDANCES).doc(a.studentAttendanceId)
      batch.update(ref, { status: a.status, notes: a.notes ?? null, updatedAt: now() })
    }
    await batch.commit()

    res.json({ message: `Đã cập nhật ${attendances.length} điểm danh` })
  } catch (err) { next(err) }
})

// PUT /api/attendance/:id — Cập nhật 1 bản ghi
router.put('/:id', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, notes } = req.body
    await db.collection(C.STUDENT_ATTENDANCES).doc(s(req.params.id))
      .update({ status, notes: notes ?? null, updatedAt: now() })
    res.json({ message: 'Đã cập nhật điểm danh' })
  } catch (err) { next(err) }
})

// ─── GIÁO VIÊN ────────────────────────────────────────────────

// GET /api/attendance/teacher/session/:sessionId
router.get('/teacher/session/:sessionId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const snap = await db.collection(C.TEACHER_ATTENDANCES)
      .where('sessionId', '==', req.params.sessionId)
      .get()
    res.json(toDocs<TeacherAttendance>(snap))
  } catch (err) { next(err) }
})

// PUT /api/attendance/teacher/:id
router.put('/teacher/:id', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, substituteTeacherId, checkInTime, checkOutTime, notes } = req.body
    const updates: Record<string, unknown> = { updatedAt: now() }

    if (status !== undefined) updates.status = status
    if (checkInTime !== undefined) updates.checkInTime = checkInTime
    if (checkOutTime !== undefined) updates.checkOutTime = checkOutTime
    if (notes !== undefined) updates.notes = notes

    if (substituteTeacherId !== undefined) {
      updates.substituteTeacherId = substituteTeacherId
      if (substituteTeacherId) {
        const teacherDoc = await db.collection(C.TEACHERS).doc(substituteTeacherId).get()
        updates.substituteTeacherName = teacherDoc.data()?.fullName ?? null
      } else {
        updates.substituteTeacherName = null
      }
    }

    await db.collection(C.TEACHER_ATTENDANCES).doc(s(req.params.id)).update(updates)
    res.json({ message: 'Đã cập nhật chấm công' })
  } catch (err) { next(err) }
})

// GET /api/attendance/teacher/summary?teacherId=&month=&year=
router.get('/teacher/summary', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { teacherId, month, year } = req.query as Record<string, string>
    if (!month || !year) { res.status(400).json({ message: 'Cần month và year' }); return }

    const monthStr = `${year}-${month.padStart(2, '0')}`
    let query = db.collection(C.TEACHER_ATTENDANCES) as FirebaseFirestore.Query
    query = query.where('sessionDate', '>=', `${monthStr}-01`)
    query = query.where('sessionDate', '<=', `${monthStr}-31`)
    if (teacherId) query = query.where('teacherId', '==', teacherId)

    const snap = await query.get()
    const attendances = toDocs<TeacherAttendance>(snap)

    // Nhóm theo giáo viên
    const summary = new Map<string, {
      teacherId: string; teacherName: string; salaryRate: number
      sessions: number; totalSalary: number
    }>()

    // Lấy salary rates
    const teacherIds = [...new Set(attendances.map(a => a.teacherId))]
    const teacherRates = new Map<string, number>()
    for (const tid of teacherIds) {
      const d = await db.collection(C.TEACHERS).doc(tid).get()
      teacherRates.set(tid, Number(d.data()?.salaryRatePerSession ?? 0))
    }

    for (const att of attendances) {
      if (!summary.has(att.teacherId)) {
        summary.set(att.teacherId, {
          teacherId: att.teacherId, teacherName: att.teacherName,
          salaryRate: teacherRates.get(att.teacherId) ?? 0,
          sessions: 0, totalSalary: 0,
        })
      }
      const entry = summary.get(att.teacherId)!
      if (att.status === 'PRESENT' || att.status === 'SUBSTITUTE') {
        entry.sessions++
        entry.totalSalary += entry.salaryRate
      }
    }

    res.json(Array.from(summary.values()))
  } catch (err) { next(err) }
})

export default router
