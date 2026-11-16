import { Router, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { prisma, api, newId } from '../lib/db'
import { s } from '../lib/params'
import { authenticate, requireRole, forgetAccount } from '../middleware/auth'
import { AuthRequest } from '../types'
import { defaultBranchId, parseBranchIds } from '../lib/branchContext'

const router = Router()
router.use(authenticate, requireRole('ADMIN'))

const ROLES = ['ADMIN', 'STAFF', 'TEACHER'] as const
type Role = typeof ROLES[number]
const isRole = (value: unknown): value is Role => ROLES.includes(value as Role)
const userDoc = <T extends { branches: { branch: { id: string; name: string } }[] }>(u: T) => api({ ...u, branches: u.branches.map(b => b.branch) })
const safeUser = { id: true, username: true, fullName: true, email: true, role: true, isActive: true, createdAt: true,
  teacher: { select: { id: true, fullName: true } }, branches: { select: { branch: { select: { id: true, name: true } } } } } as const

// GET /api/users
router.get('/', async (_req, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({ select: safeUser })
    users.sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.fullName.localeCompare(b.fullName, 'vi'))
    res.json(users.map(userDoc))
  } catch (err) { next(err) }
})

// POST /api/users
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { username, fullName, email, role, password, teacherId } = req.body as Record<string, string | undefined>
    const login = username?.trim().toLowerCase() ?? ''
    if (!/^[a-z0-9._-]{3,32}$/.test(login)) {
      res.status(400).json({ message: 'Tên đăng nhập 3–32 ký tự, chỉ gồm chữ thường, số, dấu chấm, gạch ngang, gạch dưới' }); return
    }
    if (!fullName?.trim()) { res.status(400).json({ message: 'Vui lòng nhập họ tên' }); return }
    if (!isRole(role)) { res.status(400).json({ message: 'Vai trò không hợp lệ' }); return }
    if (!password || password.length < 6) { res.status(400).json({ message: 'Mật khẩu phải có ít nhất 6 ký tự' }); return }
    if (await prisma.user.findUnique({ where: { username: login } })) {
      res.status(409).json({ message: 'Tên đăng nhập đã tồn tại' }); return
    }
    if (teacherId && role !== 'TEACHER') { res.status(400).json({ message: 'Chỉ tài khoản giáo viên mới gắn được hồ sơ giáo viên' }); return }
    if (teacherId) {
      const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } })
      if (!teacher) { res.status(404).json({ message: 'Không tìm thấy giáo viên' }); return }
      if (teacher.userId) { res.status(409).json({ message: 'Giáo viên này đã có tài khoản' }); return }
    }
    const branchIds = (await parseBranchIds(req.body.branchIds)) ?? [await defaultBranchId()]
    const id = newId()
    const user = await prisma.$transaction(async tx => {
      await tx.user.create({ data: { id, username: login, fullName: fullName.trim(), email: email?.trim() || null,
        role, passwordHash: await bcrypt.hash(password, 10), branches: { create: branchIds.map(branchId => ({ branchId })) } } })
      if (teacherId) await tx.teacher.update({ where: { id: teacherId }, data: { userId: id } })
      return tx.user.findUniqueOrThrow({ where: { id }, select: safeUser })
    })
    req.activity = { resourceType: 'users', resourceId: id, description: `Tạo tài khoản ${login} (${role})` }
    res.status(201).json(userDoc(user))
  } catch (err) { next(err) }
})

// PUT /api/users/:id — họ tên, email, vai trò, khoá/mở
router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = s(req.params.id)
    const { fullName, email, role, isActive } = req.body as { fullName?: string; email?: string | null; role?: string; isActive?: boolean }
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) { res.status(404).json({ message: 'Không tìm thấy tài khoản' }); return }
    if (role !== undefined && !isRole(role)) { res.status(400).json({ message: 'Vai trò không hợp lệ' }); return }
    if (isActive !== undefined && typeof isActive !== 'boolean') { res.status(400).json({ message: 'Trạng thái không hợp lệ' }); return }
    if (fullName !== undefined && !fullName.trim()) { res.status(400).json({ message: 'Vui lòng nhập họ tên' }); return }
    const self = id === req.user!.userId
    if (self && ((role && role !== user.role) || isActive === false)) {
      res.status(400).json({ message: 'Không thể tự khoá hoặc đổi vai trò của chính mình' }); return
    }
    const losesAdmin = user.role === 'ADMIN' && user.isActive && ((role && role !== 'ADMIN') || isActive === false)
    if (losesAdmin && await prisma.user.count({ where: { role: 'ADMIN', isActive: true } }) <= 1) {
      res.status(400).json({ message: 'Phải còn ít nhất một quản trị viên đang hoạt động' }); return
    }
    const branchIds = await parseBranchIds(req.body.branchIds)
    const updated = await prisma.user.update({
      where: { id }, select: safeUser,
      data: { fullName: fullName?.trim(), email: email === undefined ? undefined : email?.trim() || null, role: role as Role | undefined, isActive,
        ...(branchIds ? { branches: { deleteMany: {}, create: branchIds.map(branchId => ({ branchId })) } } : {}) },
    })
    forgetAccount(id)
    const change = isActive === false ? 'Khoá' : isActive === true && !user.isActive ? 'Mở khoá' : 'Sửa'
    req.activity = { resourceType: 'users', resourceId: id, description: `${change} tài khoản ${user.username}`,
      before: { fullName: user.fullName, email: user.email, role: user.role, isActive: user.isActive },
      after: { fullName: updated.fullName, email: updated.email, role: updated.role, isActive: updated.isActive } }
    res.json(userDoc(updated))
  } catch (err) { next(err) }
})

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = s(req.params.id)
    const { password } = req.body as { password?: string }
    if (!password || password.length < 6) { res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự' }); return }
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) { res.status(404).json({ message: 'Không tìm thấy tài khoản' }); return }
    await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10) } })
    req.activity = { action: 'UPDATE', resourceType: 'users', resourceId: id, description: `Đặt lại mật khẩu tài khoản ${user.username}` }
    res.json({ message: 'Đã đặt lại mật khẩu' })
  } catch (err) { next(err) }
})

export default router
