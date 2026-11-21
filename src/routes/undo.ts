import { Router, Response, NextFunction } from 'express'
import { prisma } from '../lib/db'
import { s } from '../lib/params'
import { currentScope } from '../lib/scope'
import { undoSnapshot } from '../lib/undo'
import { authenticate, requireRole } from '../middleware/auth'
import { invalidateReadView, type ViewKind } from '../services/readViews'
import { AuthRequest } from '../types'

/**
 * Hoàn tác thao tác nguy hiểm từ Lịch sử hoạt động (nhật ký có after.undoId). Xem src/lib/undo.ts.
 *   GET  /api/undo/:id              trạng thái + xem trước (không ghi)
 *   POST /api/undo/:id              hoàn tác thật
 * Khôi phục học viên đã xoá hẳn: chỉ ADMIN (như thao tác xoá). Hoàn tác hàng loạt: ADMIN, STAFF.
 */
const router = Router()
router.use(authenticate, requireRole('ADMIN', 'STAFF'))

async function load(req: AuthRequest) {
  const snap = await prisma.undoSnapshot.findUnique({ where: { id: s(req.params.id) },
    select: { id: true, kind: true, label: true, branchId: true, createdAt: true, expiresAt: true, undoneAt: true, undoneById: true, undoResult: true } })
  const allowed = currentScope()?.allowedBranchIds
  if (!snap || (snap.branchId && allowed && !allowed.includes(snap.branchId))) return null
  return snap
}
const canUndo = (req: AuthRequest, kind: string) => kind === 'batch' || req.user!.role === 'ADMIN'

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const snap = await load(req)
    if (!snap) { res.status(404).json({ message: 'Không còn dữ liệu để hoàn tác (đã quá 30 ngày hoặc không tồn tại)' }); return }
    const undoneBy = snap.undoneById ? (await prisma.user.findUnique({ where: { id: snap.undoneById }, select: { fullName: true } }))?.fullName : null
    const preview = !snap.undoneAt && canUndo(req, snap.kind)
      ? await undoSnapshot(snap.id, req.user!.userId, true).catch(err => ({ error: err.message as string }))
      : null
    res.json({ ...snap, undoneBy, allowed: canUndo(req, snap.kind), preview })
  } catch (err) { next(err) }
})

router.post('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const snap = await load(req)
    if (!snap) { res.status(404).json({ message: 'Không còn dữ liệu để hoàn tác (đã quá 30 ngày hoặc không tồn tại)' }); return }
    if (!canUndo(req, snap.kind)) { res.status(403).json({ message: 'Chỉ quản trị viên được khôi phục học viên đã xoá' }); return }
    const result = await undoSnapshot(snap.id, req.user!.userId, false)
    const kinds: ViewKind[] = ['privateMissing', 'studentsIndex', 'tuition', 'dashboard', 'invoices']
    kinds.forEach(kind => void invalidateReadView(kind))
    req.activity = { action: 'UPDATE', resourceType: 'undo', resourceId: snap.id, description: `Hoàn tác: ${snap.label}`, after: result }
    res.json(result)
  } catch (err) { next(err) }
})

export default router
