import { Router, Response, NextFunction } from 'express'
import { prisma, api, newId } from '../lib/db'
import { s } from '../lib/params'
import { authenticate, forgetAllAccounts, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'

const router = Router()
router.use(authenticate)

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const counts = { _count: { select: { students: { where: { status: 'ACTIVE' } }, classes: { where: { status: 'ACTIVE' } }, users: true, teachers: true } } } as const

// GET /api/branches — cơ sở người dùng được xem (ô chọn cơ sở); ADMIN thấy cả cơ sở ngừng hoạt động
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const admin = req.user!.role === 'ADMIN'
    const assigned = admin ? null : (await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId }, select: { branches: { select: { branchId: true } } } })).branches.map(b => b.branchId)
    const branches = await prisma.branch.findMany({
      where: admin ? {} : { isActive: true, id: { in: assigned! } },
      orderBy: { createdAt: 'asc' },
      ...(admin ? { include: counts } : {}),
    })
    res.json(branches.map(({ _count, ...b }: typeof branches[number] & { _count?: Record<string, number> }) => api({ ...b, ...(_count ? { counts: _count } : {}) })))
  } catch (err) { next(err) }
})

// POST /api/branches
router.post('/', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const name = text(req.body.name)
    if (!name) { res.status(400).json({ message: 'Vui lòng nhập tên cơ sở' }); return }
    if (await prisma.branch.findUnique({ where: { name } })) { res.status(409).json({ message: 'Tên cơ sở đã tồn tại' }); return }
    const branch = await prisma.branch.create({ data: { id: newId(), name, address: text(req.body.address), phone: text(req.body.phone) }, include: counts })
    forgetAllAccounts() // ADMIN được làm việc ở cơ sở mới
    req.activity = { resourceType: 'branches', resourceId: branch.id, description: `Tạo cơ sở ${name}` }
    const { _count, ...rest } = branch
    res.status(201).json(api({ ...rest, counts: _count }))
  } catch (err) { next(err) }
})

// PUT /api/branches/:id — tên, địa chỉ, điện thoại, ngừng / mở lại hoạt động
router.put('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = s(req.params.id)
    const branch = await prisma.branch.findUnique({ where: { id } })
    if (!branch) { res.status(404).json({ message: 'Không tìm thấy cơ sở' }); return }
    const { isActive } = req.body as { isActive?: unknown }
    if (isActive !== undefined && typeof isActive !== 'boolean') { res.status(400).json({ message: 'Trạng thái không hợp lệ' }); return }
    const name = req.body.name === undefined ? undefined : text(req.body.name)
    if (name === null) { res.status(400).json({ message: 'Vui lòng nhập tên cơ sở' }); return }
    if (name && name !== branch.name && await prisma.branch.findUnique({ where: { name } })) { res.status(409).json({ message: 'Tên cơ sở đã tồn tại' }); return }
    if (isActive === false && branch.isActive && await prisma.branch.count({ where: { isActive: true } }) <= 1) {
      res.status(400).json({ message: 'Phải còn ít nhất một cơ sở đang hoạt động' }); return
    }
    const updated = await prisma.branch.update({
      where: { id }, include: counts,
      data: { name, isActive, address: req.body.address === undefined ? undefined : text(req.body.address), phone: req.body.phone === undefined ? undefined : text(req.body.phone) },
    })
    if (isActive !== undefined) forgetAllAccounts() // cơ sở ngừng / mở lại đổi cơ sở làm việc được phép
    req.activity = { resourceType: 'branches', resourceId: id, description: `${isActive === false ? 'Ngừng hoạt động' : isActive === true && !branch.isActive ? 'Mở lại' : 'Sửa'} cơ sở ${updated.name}` }
    const { _count, ...rest } = updated
    res.json(api({ ...rest, counts: _count }))
  } catch (err) { next(err) }
})

export default router
