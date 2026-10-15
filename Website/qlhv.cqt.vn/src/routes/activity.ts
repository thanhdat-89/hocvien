import { Router, Request, Response, NextFunction } from 'express'
import { db, C, toDocs } from '../lib/firebase'
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
    const cutoffIso = cutoff.toISOString()

    let totalDeleted = 0
    while (true) {
      const snap = await db.collection(C.ACTIVITY_LOGS)
        .where('createdAt', '<', cutoffIso)
        .limit(400)
        .get()
      if (snap.empty) break
      const batch = db.batch()
      snap.docs.forEach(d => batch.delete(d.ref))
      await batch.commit()
      totalDeleted += snap.size
      if (snap.size < 400) break
    }
    res.json({ deleted: totalDeleted, cutoff: cutoffIso })
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
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50))
    const cursor = req.query.cursor as string | undefined

    let q: FirebaseFirestore.Query = db.collection(C.ACTIVITY_LOGS).orderBy('createdAt', 'desc')
    if (from) q = q.where('createdAt', '>=', from)
    if (to)   q = q.where('createdAt', '<=', to)
    if (userId)       q = q.where('userId', '==', userId)
    if (resourceType) q = q.where('resourceType', '==', resourceType)
    if (action)       q = q.where('action', '==', action)

    if (cursor) q = q.startAfter(cursor)
    q = q.limit(limit + 1)

    const snap = await q.get()
    const docs = toDocs<ActivityLogDoc>(snap)
    const hasMore = docs.length > limit
    const data = hasMore ? docs.slice(0, limit) : docs
    const nextCursor = hasMore ? data[data.length - 1].createdAt : null

    res.json({ data, nextCursor })
  } catch (err) { next(err) }
})

// GET /api/activity/:id — chi tiết 1 log (cho diff modal)
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const doc = await db.collection(C.ACTIVITY_LOGS).doc(id).get()
    if (!doc.exists) { res.status(404).json({ message: 'Không tìm thấy' }); return }
    const data = doc.data() ?? {}
    res.json({ id: doc.id, ...data })
  } catch (err) { next(err) }
})

export default router
