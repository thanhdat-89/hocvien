import { Router, Response, NextFunction } from 'express'
import { prisma, api } from '../lib/db'
import { s } from '../lib/params'
import { authenticate } from '../middleware/auth'
import { AuthRequest } from '../types'

const router = Router()
router.use(authenticate)

// GET /api/leads — Danh sách leads (mới nhất trước)
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page   as string) || 1)
    const limit  = Math.min(50, parseInt(req.query.limit  as string) || 20)
    const status = req.query.status as string | undefined
    const where = status ? { status } : {}

    const [total, data] = await prisma.$transaction([
      prisma.lead.count({ where }),
      prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    ])
    res.json({ data: api(data), total, page, limit, totalPages: Math.ceil(total / limit) })
  } catch (err) { next(err) }
})

// GET /api/leads/stats — Thống kê nhanh
router.get('/stats', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const groups = await prisma.lead.groupBy({ by: ['status'], _count: { _all: true } })
    const count = (...statuses: string[]) => groups.filter(g => statuses.includes(g.status)).reduce((n, g) => n + g._count._all, 0)

    const stats = {
      total: groups.reduce((n, g) => n + g._count._all, 0),
      new: count('NEW', 'COLLECTING'),
      completed: count('COMPLETED'),
      contacted: count('CONTACTED'),
      enrolled: count('ENROLLED'),
      lost: count('LOST'),
    }
    res.json(stats)
  } catch (err) { next(err) }
})

// PATCH /api/leads/:id — Cập nhật trạng thái / ghi chú
router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = s(req.params.id)
    const existing = await prisma.lead.findUnique({ where: { id }, select: { id: true } })
    if (!existing) {
      res.status(404).json({ message: 'Không tìm thấy lead' })
      return
    }

    const { status, note } = req.body
    const updated = await prisma.lead.update({
      where: { id },
      data: { status: status || undefined, note, updatedAt: new Date() },
    })
    res.json(api(updated))
  } catch (err) { next(err) }
})

// DELETE /api/leads/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { count } = await prisma.lead.deleteMany({ where: { id: s(req.params.id) } })
    if (!count) {
      res.status(404).json({ message: 'Không tìm thấy lead' })
      return
    }
    res.json({ message: 'Đã xoá' })
  } catch (err) { next(err) }
})

export default router
