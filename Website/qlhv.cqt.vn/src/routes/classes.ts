import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { db, C, s, toDocs, toObj, paginate } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { activityContext } from '../middleware/activityContext'
import { AuthRequest } from '../types'
import type { Class, ClassEnrollment } from '../types/models'
import { applyClassChange, prepareClassChange, renameClass } from '../services/classChange'
import { auditClassTuition } from '../services/classIntegrityAudit'

const router = Router()

async function verifyEditPassword(req: AuthRequest, password?: string) {
  if (!password || !req.user) return false
  const userDoc = await db.collection(C.USERS).doc(req.user.userId).get()
  if (!userDoc.exists) return false
  return bcrypt.compare(password, String(userDoc.data()?.passwordHash || ''))
}
router.get('/cron/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ message: 'Unauthorized' }); return
    }
    const localDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
    const [year, month] = localDate.slice(0, 7).split('-').map(Number)
    const report = await auditClassTuition(month, year)
    await db.collection('classIntegrityAudits').doc(localDate).set({ ...report, createdAt: now() })
    if (report.anomalies.length) console.warn('[Class integrity]', JSON.stringify(report))
    res.json({ period: report.period, checkedClasses: report.checkedClasses, anomalies: report.anomalies.length })
  } catch (err) { next(err) }
})
router.use(authenticate)
router.use(activityContext)
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

    // activeStudentCount đã được denorm lên class doc — không cần query ENROLLMENTS
    const result = classes
      .map(c => ({ ...c, activeStudentCount: c.activeStudentCount ?? 0 }))
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
      enrollments: toDocs<ClassEnrollment>(enrollSnap).filter(e => e.status === 'ACTIVE')
        .map(e => ({ ...e, className: cls.name })),
      schedules: toDocs(scheduleSnap).map(schedule => ({ ...schedule, className: cls.name })),
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
router.patch('/:id/name', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, currentPassword } = req.body || {}
    if (Object.keys(req.body || {}).some(key => !['name', 'currentPassword'].includes(key))) {
      res.status(400).json({ message: 'Thao tác này chỉ đổi tên hiển thị của lớp' }); return
    }
    if (!(await verifyEditPassword(req, currentPassword))) {
      res.status(403).json({ message: 'Mật khẩu xác nhận không đúng' }); return
    }
    res.json(await renameClass(s(req.params.id), name))
  } catch (err) { next(err) }
})

router.post('/:id/change-preview', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword: _, ...payload } = req.body || {}
    if (!(await verifyEditPassword(req, req.body?.currentPassword))) {
      res.status(403).json({ message: 'Mật khẩu xác nhận không đúng' }); return
    }
    const plan = await prepareClassChange(s(req.params.id), payload)
    res.json({ ...plan.summary, previewToken: plan.token })
  } catch (err) { next(err) }
})

router.put('/:id/change', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword: _, ...payload } = req.body || {}
    if (!(await verifyEditPassword(req, req.body?.currentPassword))) {
      res.status(403).json({ message: 'Mật khẩu xác nhận không đúng' }); return
    }
    res.json(await applyClassChange(s(req.params.id), payload))
  }
  catch (err) { next(err) }
})

// PUT /api/classes/:id — metadata-only compatibility route; never changes sessions.
router.put('/:id', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, subjectId, teacherId, room, maxStudents, status, notes, tuitionRate, sessionsPerMonth, startDate, endDate } = req.body
    const updates: Record<string, unknown> = { updatedAt: now() }

    if (name !== undefined) { res.status(409).json({ message: 'Đổi tên hiển thị phải dùng thao tác sửa tên lớp' }); return }
    if (room !== undefined) updates.room = room
    if (maxStudents !== undefined) updates.maxStudents = Number(maxStudents)
    if (status !== undefined || subjectId !== undefined || sessionsPerMonth !== undefined) {
      res.status(409).json({ message: 'Thông tin ảnh hưởng lịch và học phí cần được đổi qua chức năng chuyên biệt' }); return
    }
    if (notes !== undefined) updates.notes = notes
    if (tuitionRate !== undefined) { res.status(409).json({ message: 'Đổi đơn giá phải dùng chức năng sửa lớp có ngày áp dụng' }); return }
    if (startDate !== undefined || endDate !== undefined) {
      res.status(409).json({ message: 'Không đổi ngày bắt đầu/kết thúc qua thao tác sửa thông tin lớp' }); return
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
    const endDateTime = endDate ? Date.parse(`${endDate}T00:00:00Z`) : NaN
    if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(endDateTime)
      || new Date(endDateTime).toISOString().slice(0, 10) !== endDate) {
      res.status(400).json({ message: 'Ngày kết thúc không hợp lệ' }); return
    }
    const [classDoc, tuitionSnap] = await Promise.all([
      db.collection(C.CLASSES).doc(classId).get(),
      db.collection(C.TUITION_RECORDS).where('classId', '==', classId).get(),
    ])
    if (!classDoc.exists) { res.status(404).json({ message: 'Không tìm thấy lớp học' }); return }
    if (endDate < new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })) {
      res.status(409).json({ message: 'Không thể kết thúc lớp trong quá khứ vì có thể ảnh hưởng học phí đã lập' }); return
    }
    if (tuitionSnap.docs.some(d => {
      const data = d.data()
      const period = `${data.billingYear}-${String(data.billingMonth).padStart(2, '0')}`
      return period >= endDate.slice(0, 7)
    })) {
      res.status(409).json({ message: 'Đã có phiếu học phí trong hoặc sau tháng kết thúc; cần đối chiếu trước' }); return
    }

    const [schedulesSnap, scheduledSnap] = await Promise.all([
      db.collection(C.SCHEDULES).where('classId', '==', classId).get(),
      db.collection(C.SESSIONS).where('classId', '==', classId).where('status', '==', 'SCHEDULED').get(),
    ])
    const futureSessions = scheduledSnap.docs.filter(d => (d.data().sessionDate as string) > endDate)
    const futureSessionIds = futureSessions.map(d => d.id)
    const attendanceDocs: FirebaseFirestore.QueryDocumentSnapshot[] = []
    if (futureSessionIds.length > 0) {
      for (let i = 0; i < futureSessionIds.length; i += 30) {
        const chunk = futureSessionIds.slice(i, i + 30)
        const [students, teachers] = await Promise.all([
          db.collection(C.STUDENT_ATTENDANCES).where('sessionId', 'in', chunk).get(),
          db.collection(C.TEACHER_ATTENDANCES).where('sessionId', 'in', chunk).get(),
        ])
        attendanceDocs.push(...students.docs, ...teachers.docs)
      }
    }

    const schedulesToEnd = schedulesSnap.docs.filter(d => !d.data().effectiveTo || d.data().effectiveTo > endDate)
    if (1 + schedulesToEnd.length + futureSessions.length + attendanceDocs.length > 450) {
      res.status(409).json({ message: 'Lớp có quá nhiều buổi tương lai; cần xử lý riêng trước khi kết thúc' }); return
    }
    const batch = db.batch()
    batch.update(classDoc.ref, { status: 'CLOSED', endDate, updatedAt: now() })
    for (const schedule of schedulesToEnd) batch.update(schedule.ref, { effectiveTo: endDate })
    for (const session of futureSessions) batch.delete(session.ref)
    for (const attendance of attendanceDocs) batch.delete(attendance.ref)
    await batch.commit()

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
    if (!sessionsSnap.empty || !enrollSnap.empty || !tuitionSnap.empty) {
      res.status(409).json({ message: 'Lớp đã có lịch sử học tập hoặc học phí. Hãy kết thúc lớp thay vì xoá.' }); return
    }

    const related = [...schedulesSnap.docs, ...studAttSnap.docs, ...teachAttSnap.docs]
    if (related.length > 450) { res.status(409).json({ message: 'Lớp có quá nhiều dữ liệu liên quan; cần xử lý riêng' }); return }
    const batch = db.batch()
    related.forEach(d => batch.delete(d.ref))
    batch.delete(db.collection(C.CLASSES).doc(classId))
    await batch.commit()
    res.json({ message: 'Đã xoá lớp học' })
  } catch (err) { next(err) }
})

// GET /api/classes/:id/students
router.get('/:id/students', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const classDoc = await db.collection(C.CLASSES).doc(s(req.params.id)).get()
    if (!classDoc.exists) { res.status(404).json({ message: 'Không tìm thấy lớp học' }); return }
    const snap = await db.collection(C.ENROLLMENTS)
      .where('classId', '==', req.params.id)
      .get()
    const enrollments = toDocs<ClassEnrollment>(snap).filter(e => e.status === 'ACTIVE')
      .map(e => ({ ...e, className: String(classDoc.data()?.name || e.className) }))

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
