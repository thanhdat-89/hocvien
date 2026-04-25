import { Router, Response, NextFunction } from 'express'
import { db, C, s, toDocs, toObj } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import type { Teacher } from '../types/models'

const router = Router()
router.use(authenticate)
const now = () => new Date().toISOString()

router.get('/', async (_req, res: Response, next: NextFunction) => {
  try {
    const snap = await db.collection(C.TEACHERS).where('status', '==', 'ACTIVE').get()
    const teachers = toDocs<Teacher>(snap).sort((a, b) => a.fullName.localeCompare(b.fullName))
    res.json(teachers)
  } catch (err) { next(err) }
})

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await db.collection(C.TEACHERS).doc(s(req.params.id)).get()
    if (!doc.exists) { res.status(404).json({ message: 'Không tìm thấy giáo viên' }); return }

    const teacher = toObj<Teacher>(doc)
    const classesSnap = await db.collection(C.CLASSES)
      .where('teacherId', '==', teacher.id)
      .where('status', '==', 'ACTIVE')
      .get()
    const classes = toDocs(classesSnap)
    res.json({ ...teacher, classes })
  } catch (err) { next(err) }
})

router.post('/', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fullName, phone, email, address, dateOfBirth, idCard, bankAccount, bankName, salaryRatePerSession } = req.body
    const data: Omit<Teacher, 'id'> = {
      fullName, phone, email, address, dateOfBirth,
      idCard, bankAccount, bankName,
      salaryRatePerSession: Number(salaryRatePerSession),
      status: 'ACTIVE', createdAt: now(), updatedAt: now(),
    }
    const ref = await db.collection(C.TEACHERS).add(data)
    res.status(201).json({ id: ref.id, ...data })
  } catch (err) { next(err) }
})

router.put('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fullName, phone, email, address, bankAccount, bankName, salaryRatePerSession, status, notes } = req.body
    const updates: Record<string, unknown> = { updatedAt: now() }
    if (fullName !== undefined) updates.fullName = fullName
    if (phone !== undefined) updates.phone = phone
    if (email !== undefined) updates.email = email
    if (address !== undefined) updates.address = address
    if (bankAccount !== undefined) updates.bankAccount = bankAccount
    if (bankName !== undefined) updates.bankName = bankName
    if (salaryRatePerSession !== undefined) updates.salaryRatePerSession = Number(salaryRatePerSession)
    if (status !== undefined) updates.status = status
    if (notes !== undefined) updates.notes = notes

    await db.collection(C.TEACHERS).doc(s(req.params.id)).update(updates)
    const updated = toObj<Teacher>(await db.collection(C.TEACHERS).doc(s(req.params.id)).get())
    res.json(updated)
  } catch (err) { next(err) }
})

export default router
