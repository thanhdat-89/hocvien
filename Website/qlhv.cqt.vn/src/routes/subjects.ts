import { Router, Response, NextFunction } from 'express'
import { prisma, api, newId } from '../lib/db'
import { s } from '../lib/params'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'

const router = Router()
router.use(authenticate)

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const all = req.query.all === '1' && req.user!.role === 'ADMIN'
    const subjects = await prisma.subject.findMany({ where: all ? {} : { isActive: true } })
    subjects.sort((a, b) => (a.gradeLevel ?? 0) - (b.gradeLevel ?? 0))
    res.json(api(subjects))
  } catch (err) { next(err) }
})

router.post('/', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, gradeLevel, tuitionRatePerSession, description } = req.body
    const subject = await prisma.subject.create({
      data: {
        id: newId(), name, gradeLevel: gradeLevel ? Number(gradeLevel) : null,
        tuitionRatePerSession: Number(tuitionRatePerSession) || 0,
        description, isActive: true,
      },
    })
    res.status(201).json(api(subject))
  } catch (err) { next(err) }
})

router.put('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, gradeLevel, tuitionRatePerSession, description, isActive } = req.body
    const updated = await prisma.subject.update({
      where: { id: s(req.params.id) },
      data: {
        name, description, isActive,
        gradeLevel: gradeLevel === undefined ? undefined : gradeLevel === null || gradeLevel === '' ? null : Number(gradeLevel),
        tuitionRatePerSession: tuitionRatePerSession === undefined ? undefined : Number(tuitionRatePerSession),
      },
    })
    res.json(api(updated))
  } catch (err) { next(err) }
})

export default router
