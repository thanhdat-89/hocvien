import { Router, Response, NextFunction } from 'express'
import { db, C, s, toDocs, toObj } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { Session } from '../types/models'
import { currentClassNames, displayClassName } from '../lib/classDisplayNames'

const router = Router()
router.use(authenticate)
const now = () => new Date().toISOString()

// GET /api/sessions
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { classId, date, fromDate, toDate, status } = req.query as Record<string, string>

    let query = db.collection(C.SESSIONS) as FirebaseFirestore.Query

    if (classId) query = query.where('classId', '==', classId)
    if (status) query = query.where('status', '==', status)

    // Lọc ngày
    if (date) {
      query = query.where('sessionDate', '==', date)
    } else if (fromDate || toDate) {
      if (fromDate) query = query.where('sessionDate', '>=', fromDate)
      if (toDate) query = query.where('sessionDate', '<=', toDate)
    }

    // Giáo viên chỉ thấy lớp của mình
    if (req.user?.role === 'TEACHER') {
      const teacherSnap = await db.collection(C.TEACHERS).where('userId', '==', req.user.userId).limit(1).get()
      if (!teacherSnap.empty) {
        query = query.where('teacherId', '==', teacherSnap.docs[0].id)
      }
    }

    const snap = await query.get()
    const stored = toDocs<Session>(snap)
    const classNames = await currentClassNames(stored.map(session => session.classId))
    const result = stored.map(session => displayClassName(session, classNames)).sort((a, b) =>
      a.sessionDate !== b.sessionDate
        ? a.sessionDate.localeCompare(b.sessionDate)
        : a.startTime.localeCompare(b.startTime)
    )
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// GET /api/sessions/:id
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await db.collection(C.SESSIONS).doc(s(req.params.id)).get()
    if (!doc.exists) { res.status(404).json({ message: 'Không tìm thấy buổi học' }); return }

    const session = toObj<Session>(doc)
    const classNames = await currentClassNames([session.classId])
    res.json(displayClassName(session, classNames))
  } catch (err) {
    next(err)
  }
})

// DELETE /api/sessions/scheduled?classId=X&fromDate=YYYY-MM-DD — chỉ xoá buổi chưa diễn ra từ ngày áp dụng lịch mới
router.delete('/scheduled', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { classId, fromDate } = req.query as Record<string, string>
    if (!classId) { res.status(400).json({ message: 'Cần classId' }); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate ?? '')) {
      res.status(400).json({ message: 'Cần fromDate theo định dạng YYYY-MM-DD để bảo vệ lịch học cũ' }); return
    }

    const snap = await db.collection(C.SESSIONS)
      .where('classId', '==', classId)
      .get()

    const toDelete = snap.docs.filter(d => {
      const data = d.data()
      if (data.status !== 'SCHEDULED') return false
      if ((data.sessionDate as string) < fromDate) return false
      return true
    })

    // Xoá attendance records liên quan trước
    if (toDelete.length > 0) {
      const sessionIds = toDelete.map(d => d.id)
      // Firestore `in` giới hạn 30 phần tử mỗi lần
      const chunks: string[][] = []
      for (let i = 0; i < sessionIds.length; i += 30) chunks.push(sessionIds.slice(i, i + 30))
      for (const chunk of chunks) {
        const [studentAtts, teacherAtts] = await Promise.all([
          db.collection(C.STUDENT_ATTENDANCES).where('sessionId', 'in', chunk).get(),
          db.collection(C.TEACHER_ATTENDANCES).where('sessionId', 'in', chunk).get(),
        ])
        await Promise.all([
          ...studentAtts.docs.map(d => d.ref.delete()),
          ...teacherAtts.docs.map(d => d.ref.delete()),
        ])
      }
    }

    await Promise.all(toDelete.map(d => d.ref.delete()))
    res.json({ message: `Đã xoá ${toDelete.length} buổi`, count: toDelete.length })
  } catch (err) { next(err) }
})

// POST /api/sessions — buổi học đột xuất / bù
router.post('/', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { classId, sessionDate, startTime, endTime, status, notes } = req.body

    const classDoc = await db.collection(C.CLASSES).doc(classId).get()
    if (!classDoc.exists) { res.status(404).json({ message: 'Không tìm thấy lớp' }); return }
    const cls = classDoc.data()!

    const data: Omit<Session, 'id'> = {
      classId, className: cls.name as string,
      teacherId: cls.teacherId as string, teacherName: cls.teacherName as string,
      sessionDate, startTime, endTime,
      status: status || 'SCHEDULED', notes,
      createdAt: now(), updatedAt: now(),
    }
    const ref = await db.collection(C.SESSIONS).add(data)
    res.status(201).json({ id: ref.id, ...data })
  } catch (err) {
    next(err)
  }
})

// PUT /api/sessions/:id — Cập nhật thông tin buổi (giáo viên, ghi chú...)
router.put('/:id', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sessionId = s(req.params.id)
    const { teacherId, notes } = req.body
    const updates: Record<string, unknown> = { updatedAt: now() }

    if (teacherId !== undefined) {
      if (teacherId) {
        const teacherDoc = await db.collection(C.TEACHERS).doc(teacherId).get()
        if (!teacherDoc.exists) { res.status(404).json({ message: 'Không tìm thấy giáo viên' }); return }
        updates.teacherId = teacherId
        updates.teacherName = teacherDoc.data()!.fullName ?? ''
      } else {
        updates.teacherId = null
        updates.teacherName = null
      }
    }
    if (notes !== undefined) updates.notes = notes

    await db.collection(C.SESSIONS).doc(sessionId).update(updates)

    res.json({ message: 'Đã cập nhật buổi học' })
  } catch (err) { next(err) }
})

// PUT /api/sessions/:id/complete — Hoàn thành buổi học, không tạo điểm danh
router.put('/:id/complete', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sessionId = s(req.params.id)
    await db.collection(C.SESSIONS).doc(sessionId).update({
      status: 'COMPLETED',
      notes: req.body.notes ?? null,
      updatedAt: now(),
    })
    const updated = toObj<Session>(await db.collection(C.SESSIONS).doc(sessionId).get())
    res.json({ message: 'Đã hoàn thành buổi học', session: updated })
  } catch (err) {
    next(err)
  }
})

// POST /api/sessions/complete-past — Hoàn thành các buổi đã qua, không tạo điểm danh
router.post('/complete-past', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const today = new Date().toISOString().slice(0, 10)

    // Lấy tất cả sessions SCHEDULED có ngày <= hôm nay
    const sessionsSnap = await db.collection(C.SESSIONS)
      .where('status', '==', 'SCHEDULED')
      .get()

    const pastSessions = toDocs<Session>(sessionsSnap).filter(s => s.sessionDate <= today)

    if (pastSessions.length === 0) {
      res.json({ message: 'Không có buổi học đã qua nào cần hoàn thành', count: 0 })
      return
    }

    let count = 0
    for (const session of pastSessions) {
      await db.collection(C.SESSIONS).doc(session.id).update({
        status: 'COMPLETED', updatedAt: now(),
      })
      count++
    }

    res.json({ message: `Đã hoàn thành ${count} buổi học`, count })
  } catch (err) {
    next(err)
  }
})

// PUT /api/sessions/:id/cancel
router.put('/:id/cancel', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { cancelReason } = req.body
    await db.collection(C.SESSIONS).doc(s(req.params.id)).update({
      status: 'CANCELLED', cancelReason: cancelReason || null, updatedAt: now(),
    })
    res.json({ message: 'Đã huỷ buổi học' })
  } catch (err) {
    next(err)
  }
})

export default router
