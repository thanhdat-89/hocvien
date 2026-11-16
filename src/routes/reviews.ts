import { Router, Response, NextFunction } from 'express'
import { prisma, api } from '../lib/db'
import { s } from '../lib/params'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'

const router = Router()
router.use(authenticate)

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// API cũ dùng tháng làm id nhận xét (Firestore: students/{id}/reviews/{YYYY-MM}).
const toApi = <T extends { month: string; studentId: string }>({ studentId: _, ...r }: T) => api({ ...r, id: r.month })

// GET /api/reviews?month=YYYY-MM — bảng nhận xét cho toàn bộ học viên đang học
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const month = (req.query.month ?? '').toString().trim()
    if (!MONTH_RE.test(month)) {
      res.status(400).json({ message: 'Tháng không hợp lệ (YYYY-MM)' })
      return
    }

    const students = await prisma.student.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true, fullName: true, gradeLevel: true,
        enrollments: { where: { status: 'ACTIVE' }, select: { classId: true, class: { select: { name: true } } } },
        reviews: { where: { month }, select: { content: true, teacherName: true, updatedAt: true } },
      },
    })

    const rows = students.map(stu => {
      const r = stu.reviews[0]
      return {
        studentId: stu.id,
        studentName: stu.fullName,
        gradeLevel: stu.gradeLevel ?? null,
        classes: stu.enrollments.map(e => ({ classId: e.classId, className: e.class.name })),
        review: r ? { content: r.content ?? '', teacherName: r.teacherName ?? '', updatedAt: r.updatedAt.toISOString() } : null,
      }
    }).sort((a, b) => {
      const ga = a.gradeLevel ?? 99
      const gb = b.gradeLevel ?? 99
      if (ga !== gb) return ga - gb
      return a.studentName.localeCompare(b.studentName, 'vi')
    })

    res.json({ month, rows })
  } catch (err) { next(err) }
})

// GET /api/reviews/:studentId — danh sách nhận xét của 1 học viên (mới nhất trước)
router.get('/:studentId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const reviews = await prisma.studentReview.findMany({ where: { studentId: s(req.params.studentId) }, orderBy: { month: 'desc' } })
    res.json(reviews.map(toApi))
  } catch (err) { next(err) }
})

// GET /api/reviews/:studentId/:month — lấy nhận xét theo tháng (YYYY-MM)
router.get('/:studentId/:month', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.studentId)
    const month = s(req.params.month)
    if (!MONTH_RE.test(month)) {
      res.status(400).json({ message: 'Tháng không hợp lệ (YYYY-MM)' })
      return
    }
    const review = await prisma.studentReview.findUnique({ where: { studentId_month: { studentId, month } } })
    if (!review) { res.status(404).json({ message: 'Chưa có nhận xét' }); return }
    res.json(toApi(review))
  } catch (err) { next(err) }
})

// PUT /api/reviews/:studentId/:month — upsert nhận xét theo tháng
router.put('/:studentId/:month', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.studentId)
    const month = s(req.params.month)
    if (!MONTH_RE.test(month)) {
      res.status(400).json({ message: 'Tháng không hợp lệ (YYYY-MM)' })
      return
    }

    const content = (req.body?.content ?? '').toString().trim()
    if (!content) {
      res.status(400).json({ message: 'Nội dung nhận xét không được trống' })
      return
    }

    const teacherId = req.user?.role === 'TEACHER' ? req.user.userId : (req.body?.teacherId || undefined)
    const teacherName = req.body?.teacherName || undefined

    const review = await prisma.studentReview.upsert({
      where: { studentId_month: { studentId, month } },
      create: { id: `${studentId}_${month}`, studentId, month, content, teacherId, teacherName },
      update: { content, teacherId, teacherName },
    })
    res.json(toApi(review))
  } catch (err) { next(err) }
})

// DELETE /api/reviews/:studentId/:month
router.delete('/:studentId/:month', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.studentId)
    const month = s(req.params.month)
    if (!MONTH_RE.test(month)) {
      res.status(400).json({ message: 'Tháng không hợp lệ (YYYY-MM)' })
      return
    }
    await prisma.studentReview.deleteMany({ where: { studentId, month } })
    res.json({ message: 'Đã xoá nhận xét' })
  } catch (err) { next(err) }
})

export default router
