import { Router, Response, NextFunction } from 'express'
import { prisma, newId } from '../lib/db'
import { s } from '../lib/params'
import { authenticate } from '../middleware/auth'
import { AuthRequest } from '../types'

const router = Router()
router.use(authenticate)

// POST /api/parents
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { studentId, fullName, relationship, phone, zalo, email, isPrimaryContact } = req.body
    const id = newId()

    await prisma.$transaction([
      // Chỉ một liên hệ chính mỗi học viên
      ...(isPrimaryContact ? [prisma.parent.updateMany({ where: { studentId, isPrimaryContact: true }, data: { isPrimaryContact: false } })] : []),
      prisma.parent.create({
        data: { id, studentId, fullName, relationship: relationship || null, phone, zalo, email, isPrimaryContact: !!isPrimaryContact },
      }),
    ])
    res.status(201).json({ id, studentId, fullName, relationship, phone, zalo, email, isPrimaryContact: !!isPrimaryContact })
  } catch (err) {
    next(err)
  }
})

// PUT /api/parents/:studentId/:parentId
router.put('/:studentId/:parentId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.studentId)
    const parentId = s(req.params.parentId)
    const { fullName, relationship, phone, zalo, email, isPrimaryContact } = req.body

    await prisma.$transaction([
      ...(isPrimaryContact
        ? [prisma.parent.updateMany({ where: { studentId, isPrimaryContact: true, id: { not: parentId } }, data: { isPrimaryContact: false } })]
        : []),
      prisma.parent.update({
        where: { id: parentId, studentId },
        data: { fullName, relationship: relationship === '' ? null : relationship, phone, zalo, email, isPrimaryContact },
      }),
    ])
    res.json({ message: 'Đã cập nhật thông tin phụ huynh' })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/parents/:studentId/:parentId
router.delete('/:studentId/:parentId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.parent.delete({ where: { id: s(req.params.parentId), studentId: s(req.params.studentId) } })
    res.json({ message: 'Đã xoá phụ huynh' })
  } catch (err) {
    next(err)
  }
})

export default router
