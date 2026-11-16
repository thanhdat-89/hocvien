import { Router, Response, NextFunction } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma, newId, toDay } from '../lib/db'
import { sessionDoc, sessionInclude } from '../lib/docs'
import { s } from '../lib/params'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'

const router = Router()
router.use(authenticate)

// GET /api/sessions
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { classId, date, fromDate, toDate, status } = req.query as Record<string, string>
    const where: Prisma.SessionWhereInput = {}

    if (classId) where.classId = classId
    if (status) where.status = status as Prisma.EnumSessionStatusFilter['equals']

    // Lọc ngày
    if (date) {
      where.sessionDate = toDay(date)!
    } else if (fromDate || toDate) {
      where.sessionDate = { ...(fromDate ? { gte: toDay(fromDate)! } : {}), ...(toDate ? { lte: toDay(toDate)! } : {}) }
    }

    // Giáo viên chỉ thấy lớp của mình
    if (req.user?.role === 'TEACHER') {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.userId }, select: { id: true } })
      if (teacher) where.teacherId = teacher.id
    }

    const sessions = await prisma.session.findMany({
      where, include: sessionInclude, orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
    })
    res.json(sessions.map(sessionDoc))
  } catch (err) {
    next(err)
  }
})

// GET /api/sessions/:id
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const session = await prisma.session.findUnique({ where: { id: s(req.params.id) }, include: sessionInclude })
    if (!session) { res.status(404).json({ message: 'Không tìm thấy buổi học' }); return }
    res.json(sessionDoc(session))
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

    // Điểm danh liên quan bị xoá theo (ON DELETE CASCADE).
    const { count } = await prisma.session.deleteMany({ where: { classId, status: 'SCHEDULED', sessionDate: { gte: toDay(fromDate)! } } })
    res.json({ message: `Đã xoá ${count} buổi`, count })
  } catch (err) { next(err) }
})

// POST /api/sessions — buổi học đột xuất / bù
router.post('/', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { classId, sessionDate, startTime, endTime, status, notes } = req.body

    const cls = await prisma.class.findUnique({ where: { id: classId }, select: { teacherId: true } })
    if (!cls) { res.status(404).json({ message: 'Không tìm thấy lớp' }); return }

    const session = await prisma.session.create({
      data: {
        id: newId(), classId, teacherId: cls.teacherId,
        sessionDate: toDay(sessionDate)!, startTime, endTime,
        status: status || 'SCHEDULED', notes,
      },
      include: sessionInclude,
    })
    res.status(201).json(sessionDoc(session))
  } catch (err) {
    next(err)
  }
})

// PUT /api/sessions/:id — Cập nhật thông tin buổi (giáo viên, ghi chú...)
router.put('/:id', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sessionId = s(req.params.id)
    const { teacherId, notes } = req.body
    const data: Prisma.SessionUncheckedUpdateInput = {}

    if (teacherId !== undefined) {
      if (teacherId) {
        const teacher = await prisma.teacher.findUnique({ where: { id: teacherId }, select: { id: true } })
        if (!teacher) { res.status(404).json({ message: 'Không tìm thấy giáo viên' }); return }
        data.teacherId = teacherId
      } else {
        data.teacherId = null
      }
    }
    if (notes !== undefined) data.notes = notes

    await prisma.session.update({ where: { id: sessionId }, data })

    res.json({ message: 'Đã cập nhật buổi học' })
  } catch (err) { next(err) }
})

// PUT /api/sessions/:id/complete — Hoàn thành buổi học, không tạo điểm danh
router.put('/:id/complete', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const updated = await prisma.session.update({
      where: { id: s(req.params.id) },
      data: { status: 'COMPLETED', notes: req.body.notes ?? null },
      include: sessionInclude,
    })
    res.json({ message: 'Đã hoàn thành buổi học', session: sessionDoc(updated) })
  } catch (err) {
    next(err)
  }
})

// POST /api/sessions/complete-past — Hoàn thành các buổi đã qua, không tạo điểm danh
router.post('/complete-past', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const today = toDay(new Date().toISOString().slice(0, 10))!
    const { count } = await prisma.session.updateMany({
      where: { status: 'SCHEDULED', sessionDate: { lte: today } },
      data: { status: 'COMPLETED' },
    })

    if (count === 0) {
      res.json({ message: 'Không có buổi học đã qua nào cần hoàn thành', count: 0 })
      return
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
    await prisma.session.update({
      where: { id: s(req.params.id) },
      data: { status: 'CANCELLED', cancelReason: cancelReason || null },
    })
    res.json({ message: 'Đã huỷ buổi học' })
  } catch (err) {
    next(err)
  }
})

export default router
