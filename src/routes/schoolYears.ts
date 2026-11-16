import { Router, Response, NextFunction } from 'express'
import { prisma, api, newId, toDay } from '../lib/db'
import { s } from '../lib/params'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'
import { applyRollover, previewRollover } from '../services/schoolYearRollover'

const router = Router()
router.use(authenticate)

const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? toDay(v) : null)

/** Năm học không được chồng ngày lên nhau (học riêng và học phí xác định năm học theo ngày) */
async function overlapping(startDate: Date, endDate: Date, exceptId?: string) {
  return prisma.schoolYear.findFirst({
    where: { startDate: { lte: endDate }, endDate: { gte: startDate }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { name: true },
  })
}

// GET /api/school-years — mới nhất trước; kèm số lớp mỗi năm
router.get('/', async (_req, res: Response, next: NextFunction) => {
  try {
    const years = await prisma.schoolYear.findMany({ orderBy: { startDate: 'desc' }, include: { _count: { select: { classes: true } } } })
    res.json(years.map(({ _count, ...y }) => api({ ...y, classCount: _count.classes })))
  } catch (err) { next(err) }
})

// POST /api/school-years — năm mới ở trạng thái Sắp tới
router.post('/', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
    const startDate = ymd(req.body.startDate), endDate = ymd(req.body.endDate)
    if (!name) { res.status(400).json({ message: 'Vui lòng nhập tên năm học' }); return }
    if (!startDate || !endDate || endDate < startDate) { res.status(400).json({ message: 'Ngày bắt đầu, kết thúc không hợp lệ' }); return }
    if (await prisma.schoolYear.findUnique({ where: { name } })) { res.status(409).json({ message: 'Tên năm học đã tồn tại' }); return }
    const clash = await overlapping(startDate, endDate)
    if (clash) { res.status(409).json({ message: `Trùng thời gian với năm học ${clash.name}` }); return }
    const year = await prisma.schoolYear.create({ data: { id: newId(), name, startDate, endDate, status: 'UPCOMING' } })
    req.activity = { resourceType: 'school-years', resourceId: year.id, description: `Tạo năm học ${name}` }
    res.status(201).json(api({ ...year, classCount: 0 }))
  } catch (err) { next(err) }
})

// PUT /api/school-years/:id — tên, ngày; status: CURRENT (năm đang chạy cũ chuyển sang Đã đóng), CLOSED, UPCOMING
router.put('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = s(req.params.id)
    const year = await prisma.schoolYear.findUnique({ where: { id } })
    if (!year) { res.status(404).json({ message: 'Không tìm thấy năm học' }); return }
    const name = req.body.name === undefined ? year.name : String(req.body.name).trim()
    const startDate = req.body.startDate === undefined ? year.startDate : ymd(req.body.startDate)
    const endDate = req.body.endDate === undefined ? year.endDate : ymd(req.body.endDate)
    const status = req.body.status === undefined ? year.status : req.body.status
    if (!name) { res.status(400).json({ message: 'Vui lòng nhập tên năm học' }); return }
    if (!startDate || !endDate || endDate < startDate) { res.status(400).json({ message: 'Ngày bắt đầu, kết thúc không hợp lệ' }); return }
    if (!['UPCOMING', 'CURRENT', 'CLOSED'].includes(status)) { res.status(400).json({ message: 'Trạng thái không hợp lệ' }); return }
    if (year.status === 'CURRENT' && status !== 'CURRENT') {
      res.status(400).json({ message: 'Đang là năm học hiện tại: đặt năm khác làm năm hiện tại trước' }); return
    }
    if (name !== year.name && await prisma.schoolYear.findUnique({ where: { name } })) { res.status(409).json({ message: 'Tên năm học đã tồn tại' }); return }
    const clash = await overlapping(startDate, endDate, id)
    if (clash) { res.status(409).json({ message: `Trùng thời gian với năm học ${clash.name}` }); return }
    const updated = await prisma.$transaction(async tx => {
      if (status === 'CURRENT' && year.status !== 'CURRENT') await tx.schoolYear.updateMany({ where: { status: 'CURRENT' }, data: { status: 'CLOSED' } })
      return tx.schoolYear.update({ where: { id }, data: { name, startDate, endDate, status }, include: { _count: { select: { classes: true } } } })
    })
    const change = status === year.status ? 'Sửa' : status === 'CURRENT' ? 'Đặt làm năm hiện tại' : status === 'CLOSED' ? 'Đóng' : 'Mở lại'
    req.activity = { resourceType: 'school-years', resourceId: id, description: `${change} năm học ${updated.name}` }
    const { _count, ...rest } = updated
    res.json(api({ ...rest, classCount: _count.classes }))
  } catch (err) { next(err) }
})

// GET /api/school-years/:id/rollover?targetYearId= — xem trước chuyển năm (lớp trong phạm vi cơ sở đang xem)
router.get('/:id/rollover', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const targetYearId = typeof req.query.targetYearId === 'string' ? req.query.targetYearId : ''
    if (!targetYearId) { res.status(400).json({ message: 'Chọn năm học đích' }); return }
    res.json(await previewRollover(s(req.params.id), targetYearId))
  } catch (err) { next(err) }
})

// POST /api/school-years/:id/rollover — { targetYearId, classes: [{ classId, action, name, gradeLevel }], bumpGrades, graduateIds }
router.post('/:id/rollover', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { targetYearId, classes, bumpGrades, graduateIds } = req.body ?? {}
    if (typeof targetYearId !== 'string' || !Array.isArray(classes) || (graduateIds !== undefined && !Array.isArray(graduateIds))) {
      res.status(400).json({ message: 'Dữ liệu chuyển năm không hợp lệ' }); return
    }
    const result = await applyRollover(s(req.params.id), { targetYearId, classes, bumpGrades: bumpGrades !== false, graduateIds })
    req.activity = { action: 'CREATE', resourceType: 'school-years', resourceId: targetYearId,
      description: `Chuyển năm học sang ${result.targetYear}: ${result.created.length} lớp mới, kết thúc ${result.closed} lớp cũ, ${result.graduated} học viên tốt nghiệp` }
    res.json(result)
  } catch (err) { next(err) }
})

// DELETE /api/school-years/:id — chỉ năm chưa có lớp và không phải năm hiện tại
router.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = s(req.params.id)
    const year = await prisma.schoolYear.findUnique({ where: { id }, include: { _count: { select: { classes: true } } } })
    if (!year) { res.status(404).json({ message: 'Không tìm thấy năm học' }); return }
    if (year.status === 'CURRENT' || year._count.classes) { res.status(400).json({ message: 'Chỉ xoá được năm học chưa có lớp và không phải năm hiện tại' }); return }
    await prisma.schoolYear.delete({ where: { id } })
    req.activity = { resourceType: 'school-years', resourceId: id, description: `Xoá năm học ${year.name}` }
    res.json({ message: 'Đã xoá năm học' })
  } catch (err) { next(err) }
})

export default router
