import { Router, Response, NextFunction } from 'express'
import { db, C, s, toDocs } from '../lib/firebase'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthRequest } from '../types'

const router = Router()
router.use(authenticate)

const now = () => new Date().toISOString()

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

interface StudentReview {
  id: string
  month: string
  content: string
  teacherId?: string
  teacherName?: string
  createdAt: string
  updatedAt: string
}

// GET /api/reviews?month=YYYY-MM — bảng nhận xét cho toàn bộ học viên đang học
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const month = (req.query.month ?? '').toString().trim()
    if (!MONTH_RE.test(month)) {
      res.status(400).json({ message: 'Tháng không hợp lệ (YYYY-MM)' })
      return
    }

    const [studentsSnap, enrollSnap, reviewsSnap] = await Promise.all([
      db.collection(C.STUDENTS).where('status', '==', 'ACTIVE').get(),
      db.collection(C.ENROLLMENTS).where('status', '==', 'ACTIVE').get(),
      db.collectionGroup('reviews').where('month', '==', month).get(),
    ])

    const enrollByStudent = new Map<string, { classId: string; className: string }[]>()
    enrollSnap.docs.forEach(d => {
      const e = d.data() as any
      if (!e.studentId || !e.classId) return
      const list = enrollByStudent.get(e.studentId) ?? []
      list.push({ classId: e.classId, className: e.className ?? '' })
      enrollByStudent.set(e.studentId, list)
    })

    const reviewByStudent = new Map<string, any>()
    reviewsSnap.docs.forEach(d => {
      const sid = d.ref.parent.parent?.id
      if (sid) reviewByStudent.set(sid, { id: d.id, ...d.data() })
    })

    const rows = studentsSnap.docs.map(d => {
      const stu = d.data() as any
      const classes = enrollByStudent.get(d.id) ?? []
      const r = reviewByStudent.get(d.id)
      return {
        studentId: d.id,
        studentName: stu.fullName,
        gradeLevel: stu.gradeLevel ?? null,
        classes,
        review: r ? { content: r.content ?? '', teacherName: r.teacherName ?? '', updatedAt: r.updatedAt ?? '' } : null,
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
    const studentId = s(req.params.studentId)
    const snap = await db.collection(C.STUDENTS).doc(studentId)
      .collection('reviews').orderBy('month', 'desc').get()
    res.json(toDocs<StudentReview>(snap))
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
    const doc = await db.collection(C.STUDENTS).doc(studentId)
      .collection('reviews').doc(month).get()
    if (!doc.exists) { res.status(404).json({ message: 'Chưa có nhận xét' }); return }
    res.json({ id: doc.id, ...doc.data() })
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

    const ref = db.collection(C.STUDENTS).doc(studentId)
      .collection('reviews').doc(month)
    const existing = await ref.get()
    const teacherId = req.user?.role === 'TEACHER' ? req.user.userId : (req.body?.teacherId || undefined)
    const teacherName = req.body?.teacherName || undefined

    const data = {
      month,
      content,
      teacherId,
      teacherName,
      updatedAt: now(),
      ...(existing.exists ? {} : { createdAt: now() }),
    }
    await ref.set(data, { merge: true })
    res.json({ id: month, ...data })
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
    await db.collection(C.STUDENTS).doc(studentId)
      .collection('reviews').doc(month).delete()
    res.json({ message: 'Đã xoá nhận xét' })
  } catch (err) { next(err) }
})

export default router
