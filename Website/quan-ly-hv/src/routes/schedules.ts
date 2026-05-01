import { Router, Request, Response, NextFunction } from 'express'
import { db, C, s, toDocs, toObj } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { Schedule } from '../types/models'
import { generateSessionsFromSchedule, generateSessionsForClassMonth } from '../services/sessionGenerator'

const router = Router()

// Cron: sinh buổi học cho tháng hiện tại + tháng kế tiếp cho mọi lớp ACTIVE.
// Đăng ký TRƯỚC authenticate để Vercel Cron (Authorization: Bearer <CRON_SECRET>) gọi được.
router.get('/cron/generate-monthly', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expected = process.env.CRON_SECRET
    const header = req.headers.authorization
    if (!expected || header !== `Bearer ${expected}`) {
      res.status(401).json({ message: 'Unauthorized' }); return
    }

    const classesSnap = await db.collection(C.CLASSES).where('status', '==', 'ACTIVE').get()
    const classIds = classesSnap.docs.map(d => d.id)

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
const now = () => new Date().toISOString()

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { classId } = req.query as Record<string, string>
    let query = db.collection(C.SCHEDULES) as FirebaseFirestore.Query
    if (classId) query = query.where('classId', '==', classId)
    const snap = await query.get()
    res.json(toDocs<Schedule>(snap))
  } catch (err) { next(err) }
})

router.post('/', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { classId, dayOfWeek, startTime, endTime, effectiveFrom, effectiveTo } = req.body

    const classDoc = await db.collection(C.CLASSES).doc(classId).get()
    if (!classDoc.exists) { res.status(404).json({ message: 'Không tìm thấy lớp' }); return }

    const data: Record<string, unknown> = {
      classId, className: classDoc.data()!.name as string,
      dayOfWeek, startTime, endTime,
      effectiveFrom,
      createdAt: now(),
    }
    if (effectiveTo) data.effectiveTo = effectiveTo

    const ref = await db.collection(C.SCHEDULES).add(data)
    res.status(201).json({ id: ref.id, ...data })
  } catch (err) { next(err) }
})

router.put('/:id', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { dayOfWeek, startTime, endTime, effectiveFrom, effectiveTo } = req.body
    const updates: Record<string, unknown> = {}
    if (dayOfWeek !== undefined) updates.dayOfWeek = dayOfWeek
    if (startTime !== undefined) updates.startTime = startTime
    if (endTime !== undefined) updates.endTime = endTime
    if (effectiveFrom !== undefined) updates.effectiveFrom = effectiveFrom
    if (effectiveTo !== undefined) updates.effectiveTo = effectiveTo

    await db.collection(C.SCHEDULES).doc(s(req.params.id)).update(updates)
    const updated = toObj<Schedule>(await db.collection(C.SCHEDULES).doc(s(req.params.id)).get())
    res.json(updated)
  } catch (err) { next(err) }
})

router.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await db.collection(C.SCHEDULES).doc(s(req.params.id)).delete()
    res.json({ message: 'Đã xoá lịch học' })
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

// POST /api/schedules/generate-month
router.post('/generate-month', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { classId, year, month } = req.body
    if (!classId || !year || !month) { res.status(400).json({ message: 'Cần classId, year, month' }); return }
    const count = await generateSessionsForClassMonth(classId, Number(year), Number(month))
    res.json({ message: `Đã tạo ${count} buổi cho tháng ${month}/${year}`, count })
  } catch (err) { next(err) }
})

export default router
