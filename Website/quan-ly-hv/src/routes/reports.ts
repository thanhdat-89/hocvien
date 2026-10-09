import { Router, Request, Response, NextFunction } from 'express'
import { timingSafeEqual } from 'crypto'
import { db, C, toDocs } from '../lib/firebase'

const router = Router()
interface Row { id: string; [key: string]: any }
router.get('/snapshot', async (req: Request, res: Response, next: NextFunction) => {
  const secret = process.env.REPORTS_SECRET
  const supplied = req.headers.authorization ?? ''
  const expected = secret ? `Bearer ${secret}` : ''
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    res.status(401).json({ message: 'Unauthorized' }); return
  }
  const kind = req.query.kind
  if (kind !== 'week' && kind !== 'month') { res.status(400).json({ message: 'kind must be week or month' }); return }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
  const [year, month] = today.split('-').map(Number)
  const local = new Date(`${today}T12:00:00Z`)
  const startDate = kind === 'month' ? `${today.slice(0, 7)}-01` : (() => {
    const day = local.getUTCDay(); const monday = new Date(local)
    monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1))
    return monday.toISOString().slice(0, 10)
  })()
  try {
    const [studentSnap, classSnap, enrollmentSnap, tuitionSnap] = await Promise.all([
      db.collection(C.STUDENTS).get(), db.collection(C.CLASSES).get(),
      db.collection(C.ENROLLMENTS).where('status', '==', 'ACTIVE').get(),
      kind === 'month' ? db.collection(C.TUITION_RECORDS).where('billingYear', '==', year).where('billingMonth', '==', month).get() : Promise.resolve(null),
    ])
    const students = toDocs<Row>(studentSnap), classes = toDocs<Row>(classSnap), enrollments = toDocs<Row>(enrollmentSnap)
    const ids = new Set(students.map(s => s.id))
    const activeIds = new Set(students.filter(s => s.status === 'ACTIVE').map(s => s.id))
    const classIds = new Set(classes.map(c => c.id))
    const enrolled = new Set(enrollments.filter(e => ids.has(e.studentId) && classIds.has(e.classId)).map(e => e.studentId))
    const newStudents = students.filter(s => typeof s.enrollmentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.enrollmentDate) && s.enrollmentDate >= startDate && s.enrollmentDate <= today)
    const invalidDates = students.filter(s => typeof s.enrollmentDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.enrollmentDate)).length
    const tuition = tuitionSnap ? toDocs<Row>(tuitionSnap) : []
    if (tuition.some(t => typeof t.finalAmount !== 'number' || !Number.isFinite(t.finalAmount))) throw new Error('Invalid tuition finalAmount; report aborted')
    res.setHeader('Cache-Control', 'no-store')
    res.json({ kind, startDate, endDate: today, generatedAt: new Date().toISOString(), totalStudents: students.length,
      activeStudents: activeIds.size, newStudentCount: newStudents.length,
      classes: classes.sort((a,b) => String(a.name).localeCompare(String(b.name), 'vi')).map(c => ({id:c.id,name:c.name,grade:c.gradeLevel ?? '',status:c.status,
        studentCount: new Set(enrollments.filter(e=> e.classId===c.id && ids.has(e.studentId)).map(e=>e.studentId)).size})),
      privateStudentCount: students.filter(s=>!enrolled.has(s.id)).length,
      newStudents: newStudents.map(s=>({id:s.id,name:s.fullName,grade:s.gradeLevel ?? '',enrollmentDate:s.enrollmentDate})),
      ...(kind==='month' ? {tuitionDue:tuition.reduce((sum,t)=>sum+t.finalAmount,0),tuitionRecordCount:tuition.length} : {}),
      notes: [`Số học viên/lớp là ảnh chụp tại thời điểm chạy; một học viên có thể đăng ký nhiều lớp.`,
        `Học viên mới tính theo enrollmentDate; ${invalidDates} hồ sơ thiếu ngày ISO bị loại khỏi chỉ tiêu mới.`,
        `Học riêng là học viên không có đăng ký lớp ACTIVE.`,
        ...(kind==='month' ? ['Học phí phải thu = tổng finalAmount của kỳ billingMonth/billingYear, gồm bản ghi đã thu; không phải tiền thực thu. Bản ghi học phí chưa tạo không được tính.'] : [])],
    })
  } catch (error) { next(error) }
})
export default router
