import { Router, Response, NextFunction } from 'express'
import { db, C, s, toDocs, toObj } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import { Holiday } from '../types/models'

const router = Router()
router.use(authenticate)
const now = () => new Date().toISOString()

// Lấy danh sách ngày nghỉ lễ
router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const snap = await db.collection(C.HOLIDAYS)
      .orderBy('date', 'desc')
      .get()
    
    const holidays = toDocs<Holiday>(snap)
    res.json(holidays)
  } catch (err) {
    next(err)
  }
})

// Thêm ngày nghỉ lễ mới
router.post('/', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, date, description } = req.body
    
    if (!name || !date) {
      res.status(400).json({ message: 'Tên và ngày nghỉ lễ không được để trống' })
      return
    }

    // 1. Tạo Holiday record
    const data: Omit<Holiday, 'id'> = {
      name,
      date, // YYYY-MM-DD
      description: description || '',
      createdAt: now(),
    }
    const ref = await db.collection(C.HOLIDAYS).add(data)

    const cancelReason = `Nghỉ lễ: ${name}`

    // 2. Tìm tất cả các sessions trùng ngày này và đang SCHEDULED
    const sessionsSnap = await db.collection(C.SESSIONS)
      .where('sessionDate', '==', date)
      .where('status', '==', 'SCHEDULED')
      .get()

    // 3. Tìm tất cả privateSchedules trùng ngày này và đang SCHEDULED
    const privateSchedulesSnap = await db.collection(C.PRIVATE_SCHEDULES)
      .where('sessionDate', '==', date)
      .where('status', '==', 'SCHEDULED')
      .get()

    // 4. Thực hiện batch update thành CANCELLED
    const batch = db.batch()
    let cancelledCount = 0

    sessionsSnap.docs.forEach(doc => {
      batch.update(doc.ref, {
        status: 'CANCELLED',
        cancelReason,
        updatedAt: now()
      })
      cancelledCount++
    })

    privateSchedulesSnap.docs.forEach(doc => {
      batch.update(doc.ref, {
        status: 'CANCELLED',
        cancelReason,
        updatedAt: now()
      })
      cancelledCount++
    })

    if (cancelledCount > 0) {
      await batch.commit()
    }

    res.status(201).json({
      message: `Đã tạo ngày nghỉ lễ và hủy ${cancelledCount} buổi học.`,
      holiday: { id: ref.id, ...data },
      cancelledCount
    })
  } catch (err) {
    next(err)
  }
})

// Xóa ngày nghỉ lễ
router.delete('/:id', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { restoreSessions } = req.query
    const holidayId = s(req.params.id)

    const doc = await db.collection(C.HOLIDAYS).doc(holidayId).get()
    if (!doc.exists) {
      res.status(404).json({ message: 'Không tìm thấy ngày nghỉ lễ' })
      return
    }

    const holiday = doc.data() as Holiday
    const cancelReason = `Nghỉ lễ: ${holiday.name}`

    await db.collection(C.HOLIDAYS).doc(holidayId).delete()

    let restoredCount = 0
    if (restoreSessions === 'true') {
      const batch = db.batch()

      // Khôi phục sessions
      const sessionsSnap = await db.collection(C.SESSIONS)
        .where('sessionDate', '==', holiday.date)
        .where('status', '==', 'CANCELLED')
        .where('cancelReason', '==', cancelReason)
        .get()

      sessionsSnap.docs.forEach(d => {
        batch.update(d.ref, {
          status: 'SCHEDULED',
          cancelReason: null, // Xóa lý do hủy
          updatedAt: now()
        })
        restoredCount++
      })

      // Khôi phục privateSchedules
      const privateSnap = await db.collection(C.PRIVATE_SCHEDULES)
        .where('sessionDate', '==', holiday.date)
        .where('status', '==', 'CANCELLED')
        .where('cancelReason', '==', cancelReason)
        .get()

      privateSnap.docs.forEach(d => {
        batch.update(d.ref, {
          status: 'SCHEDULED',
          cancelReason: null,
          updatedAt: now()
        })
        restoredCount++
      })

      if (restoredCount > 0) {
        await batch.commit()
      }
    }

    res.json({ 
      message: restoreSessions === 'true' 
        ? `Đã xóa ngày nghỉ lễ và khôi phục ${restoredCount} buổi học.` 
        : 'Đã xóa ngày nghỉ lễ.',
      restoredCount
    })
  } catch (err) {
    next(err)
  }
})

export default router
