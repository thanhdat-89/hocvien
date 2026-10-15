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

// Thêm ngày nghỉ lễ mới (hỗ trợ theo ngày hoặc theo giai đoạn)
router.post('/', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, date, startDate, endDate, description } = req.body
    
    const start = startDate || date
    const end = endDate || start

    if (!name || !start) {
      res.status(400).json({ message: 'Tên và ngày bắt đầu nghỉ lễ không được để trống' })
      return
    }

    if (start > end) {
      res.status(400).json({ message: 'Ngày bắt đầu không được lớn hơn ngày kết thúc' })
      return
    }

    // Tạo danh sách tất cả các ngày trong khoảng [start, end]
    const dates: string[] = []
    let curr = new Date(start + 'T00:00:00Z')
    const endD = new Date(end + 'T00:00:00Z')
    while (curr <= endD) {
      dates.push(curr.toISOString().slice(0, 10))
      curr.setUTCDate(curr.getUTCDate() + 1)
    }

    // 1. Tạo Holiday record
    const data: Omit<Holiday, 'id'> = {
      name,
      date: start, // YYYY-MM-DD (backward compatibility)
      startDate: start,
      endDate: end,
      dates,
      description: description || '',
      createdAt: now(),
    }
    const ref = await db.collection(C.HOLIDAYS).add(data)

    const cancelReason = `Nghỉ lễ: ${name}`

    // 2. Tìm tất cả các sessions trong khoảng [start, end] đang SCHEDULED
    const sessionsSnap = await db.collection(C.SESSIONS)
      .where('sessionDate', '>=', start)
      .where('sessionDate', '<=', end)
      .get()

    // 3. Tìm tất cả privateSchedules trong khoảng [start, end] đang SCHEDULED
    const privateSchedulesSnap = await db.collection(C.PRIVATE_SCHEDULES)
      .where('sessionDate', '>=', start)
      .where('sessionDate', '<=', end)
      .get()

    // 4. Thực hiện batch update thành CANCELLED (hỗ trợ chia nhỏ batch nếu > 400 docs)
    const updates: { ref: FirebaseFirestore.DocumentReference; data: any }[] = []

    sessionsSnap.docs.forEach(doc => {
      if (doc.data().status === 'SCHEDULED') {
        updates.push({
          ref: doc.ref,
          data: {
            status: 'CANCELLED',
            cancelReason,
            updatedAt: now()
          }
        })
      }
    })

    privateSchedulesSnap.docs.forEach(doc => {
      if (doc.data().status === 'SCHEDULED') {
        updates.push({
          ref: doc.ref,
          data: {
            status: 'CANCELLED',
            cancelReason,
            updatedAt: now()
          }
        })
      }
    })

    for (let i = 0; i < updates.length; i += 400) {
      const chunk = updates.slice(i, i + 400)
      const batch = db.batch()
      chunk.forEach(u => batch.update(u.ref, u.data))
      await batch.commit()
    }

    const cancelledCount = updates.length

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
    const start = holiday.startDate || holiday.date
    const end = holiday.endDate || holiday.date || start

    await db.collection(C.HOLIDAYS).doc(holidayId).delete()

    let restoredCount = 0
    if (restoreSessions === 'true') {
      const updates: { ref: FirebaseFirestore.DocumentReference; data: any }[] = []

      // Khôi phục sessions
      const sessionsSnap = await db.collection(C.SESSIONS)
        .where('sessionDate', '>=', start)
        .where('sessionDate', '<=', end)
        .get()

      sessionsSnap.docs.forEach(d => {
        const data = d.data()
        if (data.status === 'CANCELLED' && data.cancelReason === cancelReason) {
          updates.push({
            ref: d.ref,
            data: {
              status: 'SCHEDULED',
              cancelReason: null, // Xóa lý do hủy
              updatedAt: now()
            }
          })
        }
      })

      // Khôi phục privateSchedules
      const privateSnap = await db.collection(C.PRIVATE_SCHEDULES)
        .where('sessionDate', '>=', start)
        .where('sessionDate', '<=', end)
        .get()

      privateSnap.docs.forEach(d => {
        const data = d.data()
        if (data.status === 'CANCELLED' && data.cancelReason === cancelReason) {
          updates.push({
            ref: d.ref,
            data: {
              status: 'SCHEDULED',
              cancelReason: null,
              updatedAt: now()
            }
          })
        }
      })

      for (let i = 0; i < updates.length; i += 400) {
        const chunk = updates.slice(i, i + 400)
        const batch = db.batch()
        chunk.forEach(u => batch.update(u.ref, u.data))
        await batch.commit()
      }

      restoredCount = updates.length
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
