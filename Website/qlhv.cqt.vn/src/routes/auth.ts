import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma, api } from '../lib/db'
import { allowedBranchIds, authenticate, forgetAccount } from '../middleware/auth'
import { currentScope } from '../lib/scope'
import { AuthRequest } from '../types'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret'

// User không còn cột teacherId; liên kết nằm ở teachers.userId.
const withTeacher = { teacher: { select: { id: true } } } as const

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body as { username: string; password: string }

    if (!username || !password) {
      res.status(400).json({ message: 'Vui lòng nhập username và password' })
      return
    }

    const user = await prisma.user.findUnique({ where: { username }, include: withTeacher })

    if (!user) {
      res.status(401).json({ message: 'Tài khoản không tồn tại' })
      return
    }

    if (!user.isActive) {
      res.status(401).json({ message: 'Tài khoản đã bị khoá' })
      return
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      res.status(401).json({ message: 'Sai mật khẩu' })
      return
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        email: user.email ?? null,
        teacherId: user.teacher?.id ?? null,
      },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, include: withTeacher })
    if (!user) { res.status(404).json({ message: 'Không tìm thấy tài khoản' }); return }

    const { passwordHash: _, teacher, ...safeUser } = user
    const scope = currentScope()
    // workingBranchId: cơ sở đang làm việc thực tế (cơ sở mặc định nếu còn hợp lệ, nếu không thì cơ sở đầu tiên được phép)
    res.json(api({ ...safeUser, teacherId: teacher?.id, workingBranchId: scope?.branchIds?.[0] ?? null, allowedBranchIds: scope?.allowedBranchIds ?? [] }))
  } catch (err) {
    next(err)
  }
})

// PUT /api/auth/me — họ tên, email, cơ sở làm việc của chính mình
router.put('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fullName, email, defaultBranchId } = req.body as { fullName?: string; email?: string | null; defaultBranchId?: string }
    if (fullName !== undefined && !fullName.trim()) { res.status(400).json({ message: 'Vui lòng nhập họ tên' }); return }
    if (defaultBranchId !== undefined) {
      const assigned = await prisma.userBranch.findMany({ where: { userId: req.user!.userId }, select: { branchId: true } })
      if (typeof defaultBranchId !== 'string' || !(await allowedBranchIds(req.user!.role, assigned.map(b => b.branchId))).includes(defaultBranchId)) {
        res.status(403).json({ message: 'Không có quyền làm việc tại cơ sở này' }); return
      }
    }
    const user = await prisma.user.update({
      where: { id: req.user!.userId }, include: withTeacher,
      data: { fullName: fullName?.trim(), email: email === undefined ? undefined : email?.trim() || null, defaultBranchId },
    })
    forgetAccount(user.id)
    const { passwordHash: _, teacher, ...safeUser } = user
    res.json(api({ ...safeUser, teacherId: teacher?.id }))
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/verify-password — re-authenticate sensitive actions.
router.post('/verify-password', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { password } = req.body as { password?: string }
    if (!password) { res.status(400).json({ message: 'Vui lòng nhập mật khẩu' }); return }
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
    if (!user) { res.status(404).json({ message: 'Không tìm thấy tài khoản' }); return }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      res.status(403).json({ message: 'Mật khẩu không đúng' }); return
    }
    res.json({ verified: true })
  } catch (err) { next(err) }
})

// PUT /api/auth/change-password
router.put('/change-password', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { oldPassword, newPassword } = req.body as { oldPassword: string; newPassword: string }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
    if (!user) { res.status(404).json({ message: 'Không tìm thấy tài khoản' }); return }

    const valid = await bcrypt.compare(oldPassword, user.passwordHash)
    if (!valid) { res.status(400).json({ message: 'Mật khẩu cũ không đúng' }); return }

    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự' })
      return
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    })

    res.json({ message: 'Đổi mật khẩu thành công' })
  } catch (err) {
    next(err)
  }
})

export default router
