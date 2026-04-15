import { Router, Response, NextFunction } from 'express'
import { db, C, s, toDocs, toObj, paginate } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { Class, ClassEnrollment } from '../types/models'

const router = Router()
router.use(authenticate)
const now = () => new Date().toISOString()

// GET /api/classes
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = '1', limit = '20', status, teacherId, subjectId } = req.query as Record<string, string>

    let classes = toDocs<Class>(await db.collection(C.CLASSES).get())

    // Giáo viên chỉ thấy lớp của mình
    if (req.user?.role === 'TEACHER') {
      const teacherSnap = await db.collection(C.TEACHERS).where('userId', '==', req.user.userId).limit(1).get()
      if (!teacherSnap.empty) {
        const tid = teacherSnap.docs[0].id
        classes = classes.filter(c => c.teacherId === tid)
      }
    }

    if (status) classes = classes.filter(c => c.status === status)
    if (teacherId) classes = classes.filter(c => c.teacherId === teacherId)
    if (subjectId) classes = classes.filter(c => c.subjectId === subjectId)

    // Batch 1 query lấy tất cả enrollments active, đếm theo classId
    const allEnrollSnap = await db.collection(C.ENROLLMENTS)
      .where('status', '==', 'ACTIVE')
      .get()
    const countByClass = new Map<string, number>()
    for (const doc of allEnrollSnap.docs) {
      const cid = doc.data().classId as string
      countByClass.set(cid, (countByClass.get(cid) ?? 0) + 1)
    }

    const result = classes
      .map(c => ({ ...c, activeStudentCount: countByClass.get(c.id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name))
    res.json(paginate(result, Number(page), Number(limit)))
  } catch (err) {
    next(err)
  }
})

// GET /api/classes/:id
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await db.collection(C.CLASSES).doc(s(req.params.id)).get()
    if (!doc.exists) { res.status(404).json({ message: 'Không tìm thấy lớp' }); return }
    const cls = toObj<Class>(doc)

    const [enrollSnap, scheduleSnap] = await Promise.all([
      db.collection(C.ENROLLMENTS).where('classId', '==', cls.id).get(),
      db.collection(C.SCHEDULES).where('classId', '==', cls.id).get(),
    ])

    res.json({
      ...cls,
      enrollments: toDocs<ClassEnrollment>(enrollSnap).filter(e => e.status === 'ACTIVE'),
      schedules: toDocs(scheduleSnap),
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/classes
router.post('/', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, subjectId, teacherId, room, maxStudents, notes, tuitionRate, sessionsPerMonth, gradeLevel, startDate, endDate } = req.body

    if (!name) { res.status(400).json({ message: 'Tên lớp là bắt buộc' }); return }

    let subjectName: string | undefined
    let teacherName: string | undefined

    if (subjectId) {
      const subjectDoc = await db.collection(C.SUBJECTS).doc(subjectId).get()
      if (!subjectDoc.exists) { res.status(404).json({ message: 'Không tìm thấy môn học' }); return }
      subjectName = subjectDoc.data()!.name as string
    }

    if (teacherId) {
      const teacherDoc = await db.collection(C.TEACHERS).doc(teacherId).get()
      if (!teacherDoc.exists) { res.status(404).json({ message: 'Không tìm thấy giáo viên' }); return }
      teacherName = teacherDoc.data()!.fullName as string
    }

    // Build data, loại bỏ undefined để Firestore không bị lỗi
    const raw: Record<string, unknown> = {
      name,
      status: 'ACTIVE',
      createdAt: now(),
      updatedAt: now(),
    }
    if (subjectId)     { raw.subjectId = subjectId; raw.subjectName = subjectName }
    if (teacherId)     { raw.teacherId = teacherId; raw.teacherName = teacherName }
    if (room)          raw.room = room
    if (notes)         raw.notes = notes
    if (tuitionRate)   raw.tuitionRate = Number(tuitionRate)
    if (sessionsPerMonth) raw.sessionsPerMonth = Number(sessionsPerMonth)
    if (maxStudents)   raw.maxStudents = Number(maxStudents)
    if (gradeLevel)    raw.gradeLevel = Number(gradeLevel)
    if (startDate)     raw.startDate = startDate
    if (endDate)       raw.endDate = endDate

    const ref = await db.collection(C.CLASSES).add(raw)
    res.status(201).json({ id: ref.id, ...raw })
  } catch (err) {
    next(err)
  }
})

// PUT /api/classes/:id
router.put('/:id', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, subjectId, teacherId, room, maxStudents, status, notes, tuitionRate, sessionsPerMonth, startDate, endDate } = req.body
    const updates: Record<string, unknown> = { updatedAt: now() }

    if (name !== undefined) updates.name = name
    if (room !== undefined) updates.room = room
    if (maxStudents !== undefined) updates.maxStudents = Number(maxStudents)
    if (status !== undefined) updates.status = status
    if (notes !== undefined) updates.notes = notes
    if (tuitionRate !== undefined) updates.tuitionRate = Number(tuitionRate)
    if (sessionsPerMonth !== undefined) updates.sessionsPerMonth = Number(sessionsPerMonth)
    if (startDate !== undefined) updates.startDate = startDate
    if (endDate !== undefined) updates.endDate = endDate

    if (subjectId) {
      const d = await db.collection(C.SUBJECTS).doc(subjectId).get()
      updates.subjectId = subjectId
      updates.subjectName = d.data()?.name
    }
    if (teacherId) {
      const d = await db.collection(C.TEACHERS).doc(teacherId).get()
      updates.teacherId = teacherId
      updates.teacherName = d.data()?.fullName
    }

    await db.collection(C.CLASSES).doc(s(req.params.id)).update(updates)
    const updated = toObj<Class>(await db.collection(C.CLASSES).doc(s(req.params.id)).get())
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

// PUT /api/classes/:id/end — Kết thúc lớp: đặt endDate, xoá dữ liệu tương lai
router.put('/:id/end', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const classId = s(req.params.id)
    const { endDate } = req.body as { endDate?: string }
    if (!endDate) { res.status(400).json({ message: 'Cần cung cấp ngày kết thúc' }); return }

    // Cập nhật class
    await db.collection(C.CLASSES).doc(classId).update({ status: 'CLOSED', endDate, updatedAt: now() })

    // Xoá schedules (lịch lặp lại không còn cần thiết)
    const schedulesSnap = await db.collection(C.SCHEDULES).where('classId', '==', classId).get()
    await Promise.all(schedulesSnap.docs.map(d => d.ref.delete()))

    // Xoá SCHEDULED sessions sau endDate + attendances liên quan (filter in-memory để tránh cần composite index)
    const scheduledSnap = await db.collection(C.SESSIONS)
      .where('classId', '==', classId)
      .where('status', '==', 'SCHEDULED')
      .get()
    const futureSessions = scheduledSnap.docs.filter(d => (d.data().sessionDate as string) > endDate)
    const futureSessionIds = futureSessions.map(d => d.id)
    await Promise.all(futureSessions.map(d => d.ref.delete()))

    if (futureSessionIds.length > 0) {
      // Firestore 'in' chỉ hỗ trợ tối đa 30 phần tử
      const chunks = []
      for (let i = 0; i < futureSessionIds.length; i += 30) chunks.push(futureSessionIds.slice(i, i + 30))
      const [studAttDocs, teachAttDocs] = await Promise.all([
        Promise.all(chunks.map(c => db.collection(C.STUDENT_ATTENDANCES).where('sessionId', 'in', c).get())),
        Promise.all(chunks.map(c => db.collection(C.TEACHER_ATTENDANCES).where('sessionId', 'in', c).get())),
      ])
      await Promise.all([
        ...studAttDocs.flatMap(s => s.docs.map(d => d.ref.delete())),
        ...teachAttDocs.flatMap(s => s.docs.map(d => d.ref.delete())),
      ])
    }

    // Xoá tuition records có dueDate sau endDate
    const tuitionSnap = await db.collection(C.TUITION_RECORDS).where('classId', '==', classId).get()
    const futureTuition = tuitionSnap.docs.filter(d => {
      const due = d.data().dueDate as string | undefined
      return due && due > endDate
    })
    await Promise.all(futureTuition.map(d => d.ref.delete()))

    res.json({ message: 'Đã kết thúc lớp học' })
  } catch (err) { next(err) }
})

// DELETE /api/classes/:id — Xoá toàn bộ dữ liệu lớp học
router.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const classId = s(req.params.id)

    const [schedulesSnap, sessionsSnap, enrollSnap, studAttSnap, teachAttSnap, tuitionSnap] = await Promise.all([
      db.collection(C.SCHEDULES).where('classId', '==', classId).get(),
      db.collection(C.SESSIONS).where('classId', '==', classId).get(),
      db.collection(C.ENROLLMENTS).where('classId', '==', classId).get(),
      db.collection(C.STUDENT_ATTENDANCES).where('classId', '==', classId).get(),
      db.collection(C.TEACHER_ATTENDANCES).where('classId', '==', classId).get(),
      db.collection(C.TUITION_RECORDS).where('classId', '==', classId).get(),
    ])

    await Promise.all([
      ...schedulesSnap.docs.map(d => d.ref.delete()),
      ...sessionsSnap.docs.map(d => d.ref.delete()),
      ...enrollSnap.docs.map(d => d.ref.delete()),
      ...studAttSnap.docs.map(d => d.ref.delete()),
      ...teachAttSnap.docs.map(d => d.ref.delete()),
      ...tuitionSnap.docs.map(d => d.ref.delete()),
    ])

    await db.collection(C.CLASSES).doc(classId).delete()
    res.json({ message: 'Đã xoá lớp học' })
  } catch (err) { next(err) }
})

// GET /api/classes/:id/students
router.get('/:id/students', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const snap = await db.collection(C.ENROLLMENTS)
      .where('classId', '==', req.params.id)
      .get()
    const enrollments = toDocs<ClassEnrollment>(snap).filter(e => e.status === 'ACTIVE')

    // Gắn thông tin phụ huynh liên hệ chính
    const result = await Promise.all(
      enrollments.map(async e => {
        const parentsSnap = await db.collection(C.STUDENTS).doc(e.studentId)
          .collection('parents').where('isPrimaryContact', '==', true).limit(1).get()
        const primaryParent = parentsSnap.empty ? null : { id: parentsSnap.docs[0].id, ...parentsSnap.docs[0].data() }
        return { ...e, primaryParent }
      })
    )

    result.sort((a, b) => a.studentName.localeCompare(b.studentName))
    res.json(result)
  } catch (err) {
    next(err)
  }
})

export default router
