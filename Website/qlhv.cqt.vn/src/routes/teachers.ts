import { Router, Response, NextFunction } from 'express'
import { prisma, api, newId, toDay } from '../lib/db'
import { s } from '../lib/params'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import { defaultBranchId, parseBranchIds } from '../lib/branchContext'

const router = Router()
router.use(authenticate)

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const status = (req.query.status as string) || 'ACTIVE'
    const teachers = await prisma.teacher.findMany({
      where: status === 'ALL' ? {} : { status: status as 'ACTIVE' | 'INACTIVE' },
      include: { _count: { select: { classes: { where: { status: 'ACTIVE' } } } } },
    })
    teachers.sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'))
    res.json(api(teachers.map(({ _count, ...t }) => ({ ...t, activeClassCount: _count.classes }))))
  } catch (err) { next(err) }
})

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const teacher = await prisma.teacher.findUnique({
      where: { id: s(req.params.id) },
      include: { classes: { where: { status: 'ACTIVE' } } },
    })
    if (!teacher) { res.status(404).json({ message: 'Không tìm thấy giáo viên' }); return }
    res.json(api(teacher))
  } catch (err) { next(err) }
})

router.post('/', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fullName, phone, email, address, dateOfBirth, idCard, bankAccount, bankName, salaryRatePerSession } = req.body
    const branchIds = (await parseBranchIds(req.body.branchIds)) ?? [await defaultBranchId()]
    const teacher = await prisma.teacher.create({
      data: {
        id: newId(), fullName, phone, email, address, dateOfBirth: toDay(dateOfBirth),
        idCard, bankAccount, bankName,
        salaryRatePerSession: Number(salaryRatePerSession) || 0,
        status: 'ACTIVE',
        branches: { create: branchIds.map(branchId => ({ branchId })) },
      },
    })
    res.status(201).json(api(teacher))
  } catch (err) { next(err) }
})

router.put('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fullName, phone, email, address, bankAccount, bankName, salaryRatePerSession, status, notes } = req.body
    const branchIds = await parseBranchIds(req.body.branchIds)
    const updated = await prisma.teacher.update({
      where: { id: s(req.params.id) },
      data: {
        fullName, phone, email, address, bankAccount, bankName, status, notes,
        salaryRatePerSession: salaryRatePerSession === undefined ? undefined : Number(salaryRatePerSession),
        ...(branchIds ? { branches: { deleteMany: {}, create: branchIds.map(branchId => ({ branchId })) } } : {}),
      },
    })
    res.json(api(updated))
  } catch (err) { next(err) }
})

// Soft-delete: chuyển status về INACTIVE để giữ lịch sử lớp đã dạy
router.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const teacherId = s(req.params.id)
    const activeClass = await prisma.class.findFirst({ where: { teacherId, status: 'ACTIVE' }, select: { id: true } })
    if (activeClass) {
      res.status(400).json({ message: 'Giáo viên còn lớp đang dạy — không thể vô hiệu hoá' })
      return
    }
    await prisma.teacher.update({ where: { id: teacherId }, data: { status: 'INACTIVE' } })
    res.json({ message: 'Đã vô hiệu hoá giáo viên' })
  } catch (err) { next(err) }
})

export default router
