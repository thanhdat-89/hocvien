import { Router, Response, NextFunction } from 'express'
import { prisma, api, newId, toDay } from '../lib/db'
import { s } from '../lib/params'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import { defaultBranchId } from '../lib/branchContext'

const router = Router()
router.use(authenticate)

// API cũ có thêm `date` (= ngày bắt đầu) để tương thích ngược.
const toApi = <T extends { startDate: Date }>(h: T) => api({ ...h, date: h.startDate })

// Lấy danh sách ngày nghỉ lễ
router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const holidays = await prisma.holiday.findMany({ orderBy: { startDate: 'desc' } })
    res.json(holidays.map(toApi))
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
    const dates: Date[] = []
    for (const curr = toDay(start)!; curr <= toDay(end)!; curr.setUTCDate(curr.getUTCDate() + 1)) dates.push(new Date(curr))

    const cancelReason = `Nghỉ lễ: ${name}`
    const range = { sessionDate: { gte: toDay(start)!, lte: toDay(end)! }, status: 'SCHEDULED' as const }

    // Tạo ngày nghỉ và huỷ các buổi SCHEDULED trong khoảng — cùng một transaction.
    const branchId = await defaultBranchId()
    const [holiday, sessions, privates] = await prisma.$transaction([
      prisma.holiday.create({
        data: { id: newId(), name, startDate: toDay(start)!, endDate: toDay(end)!, dates, description: description || '', branches: { create: { branchId } } },
      }),
      prisma.session.updateMany({ where: range, data: { status: 'CANCELLED', cancelReason } }),
      prisma.privateSession.updateMany({ where: range, data: { status: 'CANCELLED', cancelReason } }),
    ])

    const cancelledCount = sessions.count + privates.count

    res.status(201).json({
      message: `Đã tạo ngày nghỉ lễ và hủy ${cancelledCount} buổi học.`,
      holiday: toApi(holiday),
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

    const holiday = await prisma.holiday.findUnique({ where: { id: holidayId } })
    if (!holiday) {
      res.status(404).json({ message: 'Không tìm thấy ngày nghỉ lễ' })
      return
    }

    // Chỉ khôi phục buổi bị huỷ bởi chính ngày nghỉ này.
    const restoreWhere = {
      sessionDate: { gte: holiday.startDate, lte: holiday.endDate },
      status: 'CANCELLED' as const,
      cancelReason: `Nghỉ lễ: ${holiday.name}`,
    }
    const restoreData = { status: 'SCHEDULED' as const, cancelReason: null }

    const [, sessions, privates] = await prisma.$transaction([
      prisma.holiday.delete({ where: { id: holidayId } }),
      ...(restoreSessions === 'true'
        ? [
            prisma.session.updateMany({ where: restoreWhere, data: restoreData }),
            prisma.privateSession.updateMany({ where: restoreWhere, data: restoreData }),
          ]
        : []),
    ])
    const restoredCount = (sessions?.count ?? 0) + (privates?.count ?? 0)

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
