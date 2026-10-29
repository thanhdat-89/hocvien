import { Router, Response, NextFunction } from 'express'
import { prisma, api } from '../lib/db'
import { s } from '../lib/params'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'

// Chuông thông báo: cảnh báo cần xử lý của cơ sở đang làm việc (lọc theo cơ sở ở lib/db)
const router = Router()
router.use(authenticate, requireRole('ADMIN', 'STAFF'))

// GET /api/alerts — 30 cảnh báo mới nhất và số chưa đọc
router.get('/', async (_req, res: Response, next: NextFunction) => {
  try {
    const [items, unread] = await Promise.all([
      prisma.adminAlert.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.adminAlert.count({ where: { read: false } }),
    ])
    res.setHeader('Cache-Control', 'no-store')
    res.json({ items: items.map(api), unread })
  } catch (err) { next(err) }
})

// POST /api/alerts/read-all — đánh dấu đã đọc mọi cảnh báo của cơ sở
router.post('/read-all', async (_req, res: Response, next: NextFunction) => {
  try {
    const { count } = await prisma.adminAlert.updateMany({ where: { read: false }, data: { read: true } })
    res.json({ count })
  } catch (err) { next(err) }
})

// POST /api/alerts/:id/read
router.post('/:id/read', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.adminAlert.update({ where: { id: s(req.params.id) }, data: { read: true } })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
