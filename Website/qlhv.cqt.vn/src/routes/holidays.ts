import { Router, Response, NextFunction } from 'express'
import { prisma, api, newId, toDay } from '../lib/db'
import { s } from '../lib/params'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import { currentScope } from '../lib/scope'

const router = Router()
router.use(authenticate)

// API cũ có thêm `date` (= ngày bắt đầu) để tương thích ngược; `branches` = các cơ sở áp dụng.
const withBranches = { branches: { select: { branch: { select: { id: true, name: true } } } } } as const
const toApi = <T extends { startDate: Date; branches?: { branch: { id: string; name: string } }[] }>({ branches, ...h }: T) =>
  api({ ...h, date: h.startDate, ...(branches ? { branches: branches.map(b => b.branch) } : {}) })

/** Cơ sở áp dụng: danh sách gửi lên (phải trong phạm vi), mặc định mọi cơ sở đang hoạt động trong phạm vi */
async function holidayBranchIds(requested: unknown): Promise<string[] | null> {
  const scope = currentScope()?.branchIds
  const active = await prisma.branch.findMany({ where: { isActive: true, ...(scope ? { id: { in: scope } } : {}) }, select: { id: true } })
  if (requested === undefined) return active.map(b => b.id)
  if (!Array.isArray(requested) || !requested.length || requested.some(id => typeof id !== 'string')) return null
  const allowed = new Set(active.map(b => b.id))
  return requested.every(id => allowed.has(id)) ? [...new Set(requested as string[])] : null
}

// Lấy danh sách ngày nghỉ lễ
router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const holidays = await prisma.holiday.findMany({ orderBy: { startDate: 'desc' }, include: withBranches })
    res.json(holidays.map(toApi))
  } catch (err) {
    next(err)
  }
})

// Thêm ngày nghỉ lễ mới (hỗ trợ theo ngày hoặc theo giai đoạn)
router.post('/', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, date, startDate, endDate, description } = req.body
    const branchIds = await holidayBranchIds(req.body.branchIds)
    if (!branchIds?.length) { res.status(400).json({ message: 'Chọn ít nhất một cơ sở áp dụng trong quyền của bạn' }); return }

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
    const inBranches = { branchId: { in: branchIds } }

    // Tạo ngày nghỉ và huỷ các buổi SCHEDULED trong khoảng của các cơ sở áp dụng — cùng một transaction.
    const [holiday, sessions, privates] = await prisma.$transaction([
      prisma.holiday.create({
        data: { id: newId(), name, startDate: toDay(start)!, endDate: toDay(end)!, dates, description: description || '', branches: { create: branchIds.map(branchId => ({ branchId })) } },
        include: withBranches,
      }),
      prisma.session.updateMany({ where: { ...range, class: inBranches }, data: { status: 'CANCELLED', cancelReason } }),
      prisma.privateSession.updateMany({ where: { ...range, student: inBranches }, data: { status: 'CANCELLED', cancelReason } }),
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

    const holiday = await prisma.holiday.findUnique({ where: { id: holidayId }, include: { branches: { select: { branchId: true } } } })
    if (!holiday) {
      res.status(404).json({ message: 'Không tìm thấy ngày nghỉ lễ' })
      return
    }
    // Xoá ngày nghỉ ảnh hưởng mọi cơ sở áp dụng: phải có quyền với tất cả
    const holidayBranches = holiday.branches.map(b => b.branchId)
    const scope = currentScope()?.branchIds
    if (scope && holidayBranches.some(id => !scope.includes(id))) {
      res.status(403).json({ message: 'Ngày nghỉ áp dụng cả cơ sở ngoài quyền của bạn' })
      return
    }

    // Chỉ khôi phục buổi bị huỷ bởi chính ngày nghỉ này, trong các cơ sở áp dụng.
    const restoreWhere = {
      sessionDate: { gte: holiday.startDate, lte: holiday.endDate },
      status: 'CANCELLED' as const,
      cancelReason: `Nghỉ lễ: ${holiday.name}`,
    }
    const inBranches = { branchId: { in: holidayBranches } }
    const restoreData = { status: 'SCHEDULED' as const, cancelReason: null }

    const [, sessions, privates] = await prisma.$transaction([
      prisma.holiday.delete({ where: { id: holidayId } }),
      ...(restoreSessions === 'true'
        ? [
            prisma.session.updateMany({ where: { ...restoreWhere, class: inBranches }, data: restoreData }),
            prisma.privateSession.updateMany({ where: { ...restoreWhere, student: inBranches }, data: restoreData }),
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
