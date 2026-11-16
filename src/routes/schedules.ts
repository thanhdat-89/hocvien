import { Router, Request, Response, NextFunction } from 'express'
import { prisma, api, newId, toDay } from '../lib/db'
import { s } from '../lib/params'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import { generateSessionsFromSchedule, generateSessionsForClassMonth } from '../services/sessionGenerator'

const router = Router()

// className lấy theo lớp hiện tại (trước đây là bản denorm + currentClassNames).
const withClassName = { class: { select: { name: true } } } as const
const toApi = <T extends { class: { name: string } }>({ class: cls, ...row }: T) => api({ ...row, className: cls.name })

// Cron: sinh buổi học cho tháng hiện tại + tháng kế tiếp cho mọi lớp ACTIVE.
// Đăng ký TRƯỚC authenticate để Vercel Cron (Authorization: Bearer <CRON_SECRET>) gọi được.
router.get('/cron/generate-monthly', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expected = process.env.CRON_SECRET
    const header = req.headers.authorization
    if (!expected || header !== `Bearer ${expected}`) {
      res.status(401).json({ message: 'Unauthorized' }); return
    }

    const classes = await prisma.class.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })
    const classIds = classes.map(c => c.id)

    const now = new Date()
    const cur = { year: now.getFullYear(), month: now.getMonth() + 1 }
    const nxtDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nxt = { year: nxtDate.getFullYear(), month: nxtDate.getMonth() + 1 }

    const results = await Promise.all(
      classIds.flatMap(id => [
        generateSessionsForClassMonth(id, cur.year, cur.month).catch(() => 0),
        generateSessionsForClassMonth(id, nxt.year, nxt.month).catch(() => 0),
      ])
    )
    const created = results.reduce((sum, n) => sum + n, 0)

    res.json({
      classes: classIds.length,
      months: [cur, nxt],
      sessionsCreated: created,
    })
  } catch (err) { next(err) }
})

router.use(authenticate)

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { classId } = req.query as Record<string, string>
    const schedules = await prisma.schedule.findMany({ where: classId ? { classId } : {}, include: withClassName })
    res.json(schedules.map(toApi))
  } catch (err) { next(err) }
})

router.post('/', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { classId, dayOfWeek, startTime, endTime, effectiveFrom, effectiveTo } = req.body

    const cls = await prisma.class.findUnique({ where: { id: classId }, select: { id: true } })
    if (!cls) { res.status(404).json({ message: 'Không tìm thấy lớp' }); return }

    const schedule = await prisma.schedule.create({
      data: {
        id: newId(), classId, dayOfWeek, startTime, endTime,
        effectiveFrom: toDay(effectiveFrom)!, effectiveTo: toDay(effectiveTo),
      },
      include: withClassName,
    })
    res.status(201).json(toApi(schedule))
  } catch (err) { next(err) }
})

router.put('/:id', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { dayOfWeek, startTime, endTime, effectiveFrom, effectiveTo } = req.body
    const updated = await prisma.schedule.update({
      where: { id: s(req.params.id) },
      data: {
        dayOfWeek, startTime, endTime,
        effectiveFrom: effectiveFrom === undefined ? undefined : toDay(effectiveFrom)!,
        effectiveTo: effectiveTo === undefined ? undefined : toDay(effectiveTo),
      },
      include: withClassName,
    })
    res.json(toApi(updated))
  } catch (err) { next(err) }
})

router.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Buổi đã sinh vẫn giữ lại; khoá ngoại scheduleId tự về NULL.
    await prisma.schedule.delete({ where: { id: s(req.params.id) } })
    res.json({ message: 'Đã xoá lịch học' })
  } catch (err) { next(err) }
})

// POST /api/schedules/generate-month
router.post('/generate-month', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { classId, year, month } = req.body
    if (!classId || !year || !month) { res.status(400).json({ message: 'Cần classId, year, month' }); return }
    const count = await generateSessionsForClassMonth(classId, Number(year), Number(month))
    res.json({ message: `Đã tạo ${count} buổi cho tháng ${month}/${year}`, count })
  } catch (err) { next(err) }
})

// POST /api/schedules/:id/generate
router.post('/:id/generate', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fromDate, toDate } = req.body
    if (!fromDate || !toDate) { res.status(400).json({ message: 'Cần fromDate và toDate' }); return }
    const count = await generateSessionsFromSchedule(s(req.params.id), new Date(fromDate), new Date(toDate))
    res.json({ message: `Đã tạo ${count} buổi học`, count })
  } catch (err) { next(err) }
})

export default router
