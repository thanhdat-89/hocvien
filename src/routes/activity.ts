import { Router, Request, Response, NextFunction } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma, api } from '../lib/db'
import { createError } from '../middleware/errorHandler'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'

const router = Router()

// Cron cleanup — must be registered BEFORE the global authenticate so Vercel cron
// (which sends Authorization: Bearer <CRON_SECRET>) can hit it without JWT.
router.get('/cleanup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expected = process.env.CRON_SECRET
    const header = req.headers.authorization
    if (!expected || header !== `Bearer ${expected}`) {
      res.status(401).json({ message: 'Unauthorized' }); return
    }

    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 12)

    const { count } = await prisma.activityLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
    res.json({ deleted: count, cutoff: cutoff.toISOString() })
  } catch (err) { next(err) }
})

router.use(authenticate)
router.use(requireRole('ADMIN', 'STAFF'))

interface ActivityLogDoc {
  id: string
  createdAt: string
  userId: string
  userName: string
  userRole: string
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  resourceType: string
  resourceId?: string
  description: string
  method: string
  path: string
  statusCode: number
  ip?: string
  before?: unknown
  after?: unknown
}

// GET /api/activity?from=&to=&userId=&resourceType=&action=&limit=&cursor=
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to, userId, resourceType, action } = req.query as Record<string, string>
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10))
    const cursor = req.query.cursor as string | undefined
    let after: [string, string] | [string] | undefined
    if (cursor) {
      // Keep old timestamp cursors usable while clients move to the stable pair.
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cursor) && Number.isFinite(Date.parse(cursor))) after = [cursor]
      else {
        try {
          if (cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error()
          const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
          if (value.v !== 1 || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
            || typeof value.id !== 'string' || !value.id || value.id.includes('/') || Buffer.byteLength(value.id) > 1500) throw new Error()
          after = [value.createdAt, value.id]
        } catch { throw createError('Con trỏ phân trang không hợp lệ. Vui lòng tải lại lịch sử.', 400) }
      }
    }

    const where: Prisma.ActivityLogWhereInput = { AND: [] }
    const and = where.AND as Prisma.ActivityLogWhereInput[]
    if (from) and.push({ createdAt: { gte: new Date(from) } })
    if (to)   and.push({ createdAt: { lte: new Date(to) } })
    if (userId)       and.push({ userId })
    if (resourceType) and.push({ resourceType })
    if (action)       and.push({ action })
    // Keyset: sau (createdAt, id) theo thứ tự giảm dần; con trỏ cũ chỉ có createdAt.
    if (after) {
      const at = new Date(after[0])
      and.push(after[1] ? { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: after[1] } }] } : { createdAt: { lt: at } })
    }

    const rows = await prisma.activityLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 })
    const docs: ActivityLogDoc[] = api(rows)
    const hasMore = docs.length > limit
    const data = hasMore ? docs.slice(0, limit) : docs
    const last = data[data.length - 1]
    const nextCursor = hasMore ? Buffer.from(JSON.stringify({ v: 1, createdAt: last.createdAt, id: last.id })).toString('base64url') : null

    res.json({ data, nextCursor })
  } catch (err) { next(err) }
})

// GET /api/activity/:id — chi tiết 1 log (cho diff modal)
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const log = await prisma.activityLog.findUnique({ where: { id } })
    if (!log) { res.status(404).json({ message: 'Không tìm thấy' }); return }
    res.json(api(log))
  } catch (err) { next(err) }
})

export default router
