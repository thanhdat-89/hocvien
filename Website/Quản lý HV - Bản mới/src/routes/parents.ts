import { Router, Response, NextFunction } from 'express'
import { db, C, s } from '../lib/firebase'
import { authenticate } from '../middleware/auth'
import { AuthRequest } from '../types'

const router = Router()
router.use(authenticate)

const now = () => new Date().toISOString()

// POST /api/parents
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { studentId, fullName, relationship, phone, zalo, email, isPrimaryContact } = req.body

    if (isPrimaryContact) {
      // Bỏ isPrimaryContact của các PH khác
      const snap = await db.collection(C.STUDENTS).doc(studentId).collection('parents')
        .where('isPrimaryContact', '==', true).get()
      const batch = db.batch()
      snap.docs.forEach(d => batch.update(d.ref, { isPrimaryContact: false }))
      await batch.commit()
    }

    const ref = db.collection(C.STUDENTS).doc(studentId).collection('parents').doc()
    await ref.set({ studentId, fullName, relationship, phone, zalo, email, isPrimaryContact: !!isPrimaryContact, createdAt: now() })
    res.status(201).json({ id: ref.id, studentId, fullName, relationship, phone, zalo, email, isPrimaryContact: !!isPrimaryContact })
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

    if (isPrimaryContact) {
      const snap = await db.collection(C.STUDENTS).doc(studentId).collection('parents')
        .where('isPrimaryContact', '==', true).get()
      const batch = db.batch()
      snap.docs.forEach(d => { if (d.id !== parentId) batch.update(d.ref, { isPrimaryContact: false }) })
      await batch.commit()
    }

    const updates: Record<string, unknown> = {}
    if (fullName !== undefined) updates.fullName = fullName
    if (relationship !== undefined) updates.relationship = relationship
    if (phone !== undefined) updates.phone = phone
    if (zalo !== undefined) updates.zalo = zalo
    if (email !== undefined) updates.email = email
    if (isPrimaryContact !== undefined) updates.isPrimaryContact = isPrimaryContact

    await db.collection(C.STUDENTS).doc(studentId).collection('parents').doc(parentId).update(updates)
    res.json({ message: 'Đã cập nhật thông tin phụ huynh' })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/parents/:studentId/:parentId
router.delete('/:studentId/:parentId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await db.collection(C.STUDENTS).doc(s(req.params.studentId))
      .collection('parents').doc(s(req.params.parentId)).delete()
    res.json({ message: 'Đã xoá phụ huynh' })
  } catch (err) {
    next(err)
  }
})

export default router
