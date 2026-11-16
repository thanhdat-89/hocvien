import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import type { Prisma } from '@prisma/client'
import { prisma, api, newId, toDay } from '../lib/db'
import { classDoc, classInclude, enrollmentDoc, enrollmentInclude, scheduleDoc, scheduleInclude } from '../lib/docs'
import { s } from '../lib/params'
import { authenticate, requireRole } from '../middleware/auth'
import { activityContext } from '../middleware/activityContext'
import { AuthRequest } from '../types'
import { defaultBranchId, openSchoolYearId, viewedSchoolYearId } from '../lib/branchContext'
import { applyClassChange, prepareClassChange, renameClass } from '../services/classChange'
import { auditClassTuition } from '../services/classIntegrityAudit'
import { alertClassAudit } from '../services/adminAlerts'

const router = Router()

async function verifyEditPassword(req: AuthRequest, password?: string) {
  if (!password || !req.user) return false
  const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { passwordHash: true } })
  if (!user) return false
  return bcrypt.compare(password, user.passwordHash)
}
router.get('/cron/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ message: 'Unauthorized' }); return
    }
    const localDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
    const [year, month] = localDate.slice(0, 7).split('-').map(Number)
    const report = await auditClassTuition(month, year)
    const audit = { period: report.period, checkedClasses: report.checkedClasses, checkedRows: report.checkedRows,
      anomalies: report.anomalies as Prisma.InputJsonValue, createdAt: new Date() }
    await prisma.classIntegrityAudit.upsert({ where: { id: localDate }, create: { id: localDate, ...audit }, update: audit })
    if (report.anomalies.length) console.warn('[Class integrity]', JSON.stringify(report))
    const alerts = await alertClassAudit(report.period, report.anomalies)
    res.json({ period: report.period, checkedClasses: report.checkedClasses, anomalies: report.anomalies.length, alerts })
  } catch (err) { next(err) }
})
router.use(authenticate)
router.use(activityContext)

// GET /api/classes
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = '1', limit = '20', status, teacherId, subjectId } = req.query as Record<string, string>
    const where: Prisma.ClassWhereInput = { schoolYearId: await viewedSchoolYearId() }

    // Giáo viên chỉ thấy lớp của mình
    if (req.user?.role === 'TEACHER') {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.userId }, select: { id: true } })
      if (teacher) where.teacherId = teacher.id
    }

    if (status) where.status = status as Prisma.EnumClassStatusFilter['equals']
    if (teacherId) where.AND = [{ teacherId }]
    if (subjectId) where.subjectId = subjectId

    // activeStudentCount được cập nhật cùng transaction với ghi danh — không cần đếm lại
    const classes = (await prisma.class.findMany({ where, include: classInclude })).map(classDoc)
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
    const pageNum = Number(page), limitNum = Number(limit)
    res.json({
      data: classes.slice((pageNum - 1) * limitNum, pageNum * limitNum),
      total: classes.length, page: pageNum, limit: limitNum, totalPages: Math.ceil(classes.length / limitNum),
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/classes/:id
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cls = await prisma.class.findUnique({ where: { id: s(req.params.id) }, include: classInclude })
    if (!cls) { res.status(404).json({ message: 'Không tìm thấy lớp' }); return }

    const [enrollments, schedules] = await Promise.all([
      prisma.classEnrollment.findMany({ where: { classId: cls.id, status: 'ACTIVE' }, include: enrollmentInclude }),
      prisma.schedule.findMany({ where: { classId: cls.id }, include: scheduleInclude }),
    ])

    res.json({
      ...classDoc(cls),
      enrollments: enrollments.map(enrollmentDoc),
      schedules: schedules.map(scheduleDoc),
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

    if (subjectId && !(await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true } }))) {
      res.status(404).json({ message: 'Không tìm thấy môn học' }); return
    }
    if (teacherId && !(await prisma.teacher.findUnique({ where: { id: teacherId }, select: { id: true } }))) {
      res.status(404).json({ message: 'Không tìm thấy giáo viên' }); return
    }

    const created = await prisma.class.create({
      data: {
        id: newId(),
        name,
        status: 'ACTIVE',
        subjectId: subjectId || null,
        teacherId: teacherId || null,
        room: room || null,
        notes: notes || null,
        tuitionRate: tuitionRate ? Number(tuitionRate) : null,
        sessionsPerMonth: sessionsPerMonth ? Number(sessionsPerMonth) : null,
        maxStudents: maxStudents ? Number(maxStudents) : null,
        gradeLevel: gradeLevel ? Number(gradeLevel) : null,
        startDate: toDay(startDate),
        endDate: toDay(endDate),
        branchId: await defaultBranchId(),
        schoolYearId: await openSchoolYearId(),
      },
      include: classInclude,
    })
    res.status(201).json(classDoc(created))
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
    const data: Prisma.ClassUncheckedUpdateInput = {}

    if (name !== undefined) { res.status(409).json({ message: 'Đổi tên hiển thị phải dùng thao tác sửa tên lớp' }); return }
    if (room !== undefined) data.room = room
    if (maxStudents !== undefined) data.maxStudents = Number(maxStudents)
    if (status !== undefined || subjectId !== undefined || sessionsPerMonth !== undefined) {
      res.status(409).json({ message: 'Thông tin ảnh hưởng lịch và học phí cần được đổi qua chức năng chuyên biệt' }); return
    }
    if (notes !== undefined) data.notes = notes
    if (tuitionRate !== undefined) { res.status(409).json({ message: 'Đổi đơn giá phải dùng chức năng sửa lớp có ngày áp dụng' }); return }
    if (startDate !== undefined || endDate !== undefined) {
      res.status(409).json({ message: 'Không đổi ngày bắt đầu/kết thúc qua thao tác sửa thông tin lớp' }); return
    }

    if (teacherId) data.teacherId = teacherId

    const updated = await prisma.class.update({ where: { id: s(req.params.id) }, data, include: classInclude })
    res.json(classDoc(updated))
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
    const [cls, records] = await Promise.all([
      prisma.class.findUnique({ where: { id: classId }, select: { id: true } }),
      prisma.tuitionRecord.findMany({ where: { classId }, select: { billingYear: true, billingMonth: true } }),
    ])
    if (!cls) { res.status(404).json({ message: 'Không tìm thấy lớp học' }); return }
    if (endDate < new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })) {
      res.status(409).json({ message: 'Không thể kết thúc lớp trong quá khứ vì có thể ảnh hưởng học phí đã lập' }); return
    }
    if (records.some(r => `${r.billingYear}-${String(r.billingMonth).padStart(2, '0')}` >= endDate.slice(0, 7))) {
      res.status(409).json({ message: 'Đã có phiếu học phí trong hoặc sau tháng kết thúc; cần đối chiếu trước' }); return
    }

    const end = toDay(endDate)!
    await prisma.$transaction([
      prisma.class.update({ where: { id: classId }, data: { status: 'CLOSED', endDate: end } }),
      prisma.schedule.updateMany({ where: { classId, OR: [{ effectiveTo: null }, { effectiveTo: { gt: end } }] }, data: { effectiveTo: end } }),
      // Điểm danh của các buổi này bị xoá theo (khoá ngoại ON DELETE CASCADE).
      prisma.session.deleteMany({ where: { classId, status: 'SCHEDULED', sessionDate: { gt: end } } }),
    ])

    res.json({ message: 'Đã kết thúc lớp học' })
  } catch (err) { next(err) }
})

// DELETE /api/classes/:id — Xoá toàn bộ dữ liệu lớp học
router.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const classId = s(req.params.id)

    const [sessions, enrollments, records] = await Promise.all([
      prisma.session.count({ where: { classId } }),
      prisma.classEnrollment.count({ where: { classId } }),
      prisma.tuitionRecord.count({ where: { classId } }),
    ])
    if (sessions || enrollments || records) {
      res.status(409).json({ message: 'Lớp đã có lịch sử học tập hoặc học phí. Hãy kết thúc lớp thay vì xoá.' }); return
    }

    // Lịch học và lịch sử đơn giá bị xoá theo lớp (ON DELETE CASCADE).
    await prisma.class.delete({ where: { id: classId } })
    res.json({ message: 'Đã xoá lớp học' })
  } catch (err) { next(err) }
})

// GET /api/classes/:id/students
router.get('/:id/students', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const classId = s(req.params.id)
    const cls = await prisma.class.findUnique({ where: { id: classId }, select: { id: true } })
    if (!cls) { res.status(404).json({ message: 'Không tìm thấy lớp học' }); return }

    // Gắn thông tin phụ huynh liên hệ chính
    const enrollments = await prisma.classEnrollment.findMany({
      where: { classId, status: 'ACTIVE' },
      include: { ...enrollmentInclude, student: { select: { fullName: true, parents: { where: { isPrimaryContact: true }, take: 1 } } } },
    })
    const result = enrollments.map(({ student, ...e }) => ({
      ...enrollmentDoc({ ...e, student }),
      primaryParent: student.parents[0] ? api(student.parents[0]) : null,
    }))

    result.sort((a: any, b: any) => a.studentName.localeCompare(b.studentName))
    res.json(result)
  } catch (err) {
    next(err)
  }
})

export default router
