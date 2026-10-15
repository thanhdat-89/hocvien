import { Router, Response, NextFunction } from 'express'
import { db, C, s, toDocs, toObj } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { Subject } from '../types/models'

const router = Router()
router.use(authenticate)
const now = () => new Date().toISOString()

router.get('/', async (_req, res: Response, next: NextFunction) => {
  try {
    const snap = await db.collection(C.SUBJECTS).where('isActive', '==', true).get()
    const subjects = toDocs<Subject>(snap).sort((a, b) => (a.gradeLevel ?? 0) - (b.gradeLevel ?? 0))
    res.json(subjects)
  } catch (err) { next(err) }
})

router.post('/', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, gradeLevel, tuitionRatePerSession, description } = req.body
    const data: Omit<Subject, 'id'> = {
      name, gradeLevel: gradeLevel ? Number(gradeLevel) : undefined,
      tuitionRatePerSession: Number(tuitionRatePerSession),
      description, isActive: true, createdAt: now(),
    }
    const ref = await db.collection(C.SUBJECTS).add(data)
    res.status(201).json({ id: ref.id, ...data })
  } catch (err) { next(err) }
})

router.put('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, gradeLevel, tuitionRatePerSession, description, isActive } = req.body
    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name
    if (gradeLevel !== undefined) updates.gradeLevel = gradeLevel
    if (tuitionRatePerSession !== undefined) updates.tuitionRatePerSession = Number(tuitionRatePerSession)
    if (description !== undefined) updates.description = description
    if (isActive !== undefined) updates.isActive = isActive

    await db.collection(C.SUBJECTS).doc(s(req.params.id)).update(updates)
    const updated = toObj<Subject>(await db.collection(C.SUBJECTS).doc(s(req.params.id)).get())
    res.json(updated)
  } catch (err) { next(err) }
})

export default router
