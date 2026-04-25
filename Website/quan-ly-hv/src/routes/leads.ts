import { Router, Response, NextFunction } from 'express'
import { db, C, toDocs, paginate, s } from '../lib/firebase'
import { authenticate } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { Lead } from '../types/models'

const router = Router()
router.use(authenticate)

// GET /api/leads — Danh sách leads (mới nhất trước)
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page   as string) || 1)
    const limit  = Math.min(50, parseInt(req.query.limit  as string) || 20)
    const status = req.query.status as string | undefined

    let query: FirebaseFirestore.Query = db.collection(C.LEADS).orderBy('createdAt', 'desc')
    if (status) query = query.where('status', '==', status)

    const snap = await query.get()
    const all = toDocs<Lead>(snap)
    res.json(paginate(all, page, limit))
  } catch (err) { next(err) }
})

// GET /api/leads/stats — Thống kê nhanh
router.get('/stats', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const snap = await db.collection(C.LEADS).get()
    const leads = snap.docs.map(d => d.data() as Lead)

    const stats = {
      total: leads.length,
      new: leads.filter(l => l.status === 'NEW' || l.status === 'COLLECTING').length,
      completed: leads.filter(l => l.status === 'COMPLETED').length,
      contacted: leads.filter(l => l.status === 'CONTACTED').length,
      enrolled: leads.filter(l => l.status === 'ENROLLED').length,
      lost: leads.filter(l => l.status === 'LOST').length,
    }
    res.json(stats)
  } catch (err) { next(err) }
})

// PATCH /api/leads/:id — Cập nhật trạng thái / ghi chú
router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ref = db.collection(C.LEADS).doc(s(req.params.id))
    const doc = await ref.get()
    if (!doc.exists) {
      res.status(404).json({ message: 'Không tìm thấy lead' })
      return
    }

    const { status, note } = req.body
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
    if (status) updates.status = status
    if (note !== undefined) updates.note = note

    await ref.update(updates)
    res.json({ id: doc.id, ...doc.data(), ...updates })
  } catch (err) { next(err) }
})

// DELETE /api/leads/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ref = db.collection(C.LEADS).doc(s(req.params.id))
    const doc = await ref.get()
    if (!doc.exists) {
      res.status(404).json({ message: 'Không tìm thấy lead' })
      return
    }
    await ref.delete()
    res.json({ message: 'Đã xoá' })
  } catch (err) { next(err) }
})

export default router
