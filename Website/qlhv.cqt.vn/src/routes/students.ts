import { Router, Response, NextFunction } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma, api, newId, toDay } from '../lib/db'
import {
  classDoc, classInclude, enrollmentDoc, enrollmentInclude, privateSessionDoc, privateSessionInclude,
  sessionDoc, sessionInclude, studentAttendanceDoc, studentAttendanceInclude, studentPromotionDoc,
  studentPromotionInclude, tuitionRecordDoc, tuitionRecordInclude,
} from '../lib/docs'
import { s } from '../lib/params'
import { recountClassActiveStudents } from '../lib/classSync'
import { computeTuitionSummary } from '../lib/tuition'
import { classRateForMonth } from '../services/classChange'
import { requireRole } from '../middleware/auth'
import { authenticate } from '../middleware/auth'
import { activityContext } from '../middleware/activityContext'
import { getMissingPrivateStudents, validPeriod } from '../services/readViews'
import { getStudentPage } from '../services/studentReadView'
import { AuthRequest } from '../types'
import type { ClassEnrollment } from '../types/models'

const router = Router()
router.use(authenticate)
router.use(activityContext)

const today = () => new Date().toISOString().slice(0, 10)

/** Ngày từ client hoặc file Excel đã chuẩn hoá; giá trị không đọc được → null (bulk ghi chú lỗi riêng). */
function dayOrNull(value: unknown): Date | null {
  try { return toDay(value) } catch { return null }
}

// Phụ huynh liên hệ chính: ưu tiên isPrimaryContact, nếu không có lấy phụ huynh đầu tiên (như syncPrimaryParentToStudent cũ).
const primaryParentInclude = { orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }], take: 1 } satisfies Prisma.Student$parentsArgs

async function enrichStudents(ids: string[]) {
  const now = toDay(today())!
  const students = await prisma.student.findMany({
    where: { id: { in: ids } },
    include: {
      parents: primaryParentInclude,
      enrollments: { where: { status: 'ACTIVE' }, include: enrollmentInclude },
      promotions: {
        where: { AND: [{ OR: [{ appliedFrom: { lte: now } }] }, { OR: [{ appliedTo: null }, { appliedTo: { gte: now } }] }] },
        include: studentPromotionInclude,
      },
    },
  })
  const positions = new Map(ids.map((id, index) => [id, index]))
  students.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!)

  return students.map(({ parents, enrollments, promotions, ...stu }) => {
    const p = parents[0]
    return {
      ...api(stu),
      primaryParent: p?.fullName ? { fullName: p.fullName, phone: p.phone ?? null, zalo: p.zalo ?? null } : null,
      enrollments: enrollments.map(enrollmentDoc),
      promotions: promotions.map(studentPromotionDoc),
    }
  })
}

// GET /api/students
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = '1', limit = '20', search, status, classId, gradeLevel, cursor } = req.query as Record<string, string>
    const pageNum = Math.max(1, Math.floor(Number(page) || 1))
    const limitNum = Math.min(500, Math.max(1, Math.floor(Number(limit) || 20)))
    const { ids, ...pagination } = await getStudentPage({ page: pageNum, limit: limitNum, search, status, classId, gradeLevel, cursor })
    const result = await enrichStudents(ids)
    res.json({ data: result, ...pagination })
  } catch (err) {
    next(err)
  }
})

// POST /api/students/bulk — Import hàng loạt từ Excel
router.post('/bulk', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { students } = req.body as {
      students: Array<{
        fullName: string
        dateOfBirth?: string
        gender?: string
        school?: string
        gradeLevel?: string | number
        address?: string
        notes?: string
        parentName?: string
        parentPhone?: string
        className?: string
        enrollmentDate?: string
      }>
    }
    if (!students?.length) { res.status(400).json({ message: 'Danh sách rỗng' }); return }

    // Tra lớp theo tên (không phân biệt hoa thường), nạp một lần
    const classes = await prisma.class.findMany({ select: { id: true, name: true } })
    const classByName = new Map(classes.map(c => [c.name.trim().toLowerCase(), c]))

    const created: string[] = []
    const failed: { row: number; name: string; error: string }[] = []

    for (let i = 0; i < students.length; i++) {
      const s = students[i]
      if (!s.fullName?.trim()) { failed.push({ row: i + 1, name: '', error: 'Thiếu họ tên' }); continue }
      try {
        const dateOfBirth = dayOrNull(s.dateOfBirth)
        if (s.dateOfBirth && !dateOfBirth) {
          failed.push({ row: i + 1, name: s.fullName, error: `Ngày sinh "${s.dateOfBirth}" không đọc được — học viên vẫn được tạo, chưa có ngày sinh` })
        }
        const enrollmentDate = dayOrNull(s.enrollmentDate) ?? toDay(today())!
        const cls = s.className?.trim() ? classByName.get(s.className.trim().toLowerCase()) : undefined
        const studentId = newId()

        // Học viên + phụ huynh + ghi danh của một dòng: cùng một transaction
        await prisma.$transaction(async tx => {
          await tx.student.create({
            data: {
              id: studentId,
              fullName: s.fullName.trim(),
              dateOfBirth,
              gender: (s.gender as Prisma.StudentCreateInput['gender']) || null,
              school: s.school || null,
              gradeLevel: s.gradeLevel ? Number(s.gradeLevel) : null,
              address: s.address || null,
              notes: s.notes || null,
              enrollmentDate,
              status: 'ACTIVE',
            },
          })
          if (s.parentName?.trim()) {
            await tx.parent.create({
              data: { id: newId(), studentId, fullName: s.parentName.trim(), phone: s.parentPhone?.trim() || null, relationship: 'PHỤ HUYNH', isPrimaryContact: true },
            })
          }
          if (cls) {
            await tx.classEnrollment.create({ data: { id: newId(), classId: cls.id, studentId, enrollmentDate, status: 'ACTIVE' } })
            await recountClassActiveStudents(cls.id, tx)
          }
        })

        if (s.className?.trim() && !cls) {
          // Ghi chú lỗi phụ nhưng không fail học viên
          failed.push({ row: i + 1, name: s.fullName, error: `Không tìm thấy lớp "${s.className}" — học viên đã được tạo nhưng chưa đăng ký lớp` })
        }

        created.push(studentId)
      } catch (err: any) {
        failed.push({ row: i + 1, name: s.fullName, error: err.message ?? 'Lỗi không xác định' })
      }
    }

    res.status(201).json({ message: `Đã thêm ${created.length} học viên`, created: created.length, failed })
  } catch (err) { next(err) }
})

// GET /api/students/private-sessions?fromDate=&toDate= — Tất cả lịch học riêng theo tuần
router.get('/private-sessions/all', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fromDate, toDate } = req.query as Record<string, string>
    const sessions = await prisma.privateSession.findMany({
      where: { sessionDate: { ...(fromDate ? { gte: toDay(fromDate)! } : {}), ...(toDate ? { lte: toDay(toDate)! } : {}) } },
      include: privateSessionInclude,
    })
    res.json(sessions.map(privateSessionDoc))
  } catch (err) { next(err) }
})

// GET /api/students/private-schedule/missing — shared monthly eligibility view.
router.get('/private-schedule/missing', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const month = Number(req.query.month), year = Number(req.query.year)
    if (!validPeriod(month, year)) { res.status(400).json({ message: 'Tháng/năm không hợp lệ.' }); return }
    res.setHeader('Cache-Control', 'no-store')
    res.json(await getMissingPrivateStudents(month, year, String(req.query.version || ''), req.query.force === 'true'))
  } catch (error) { next(error) }
})

// GET /api/students/:id — Hồ sơ chi tiết
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: s(req.params.id) },
      include: {
        parents: true,
        enrollments: { include: enrollmentInclude },
        // 6 phiếu học phí gần nhất
        tuitionRecords: { include: tuitionRecordInclude, orderBy: [{ billingYear: 'desc' }, { billingMonth: 'desc' }], take: 6 },
        // Khuyến mãi đang hiệu lực (chưa có ngày kết thúc)
        promotions: { where: { appliedTo: null }, include: studentPromotionInclude },
      },
    })
    if (!student) { res.status(404).json({ message: 'Không tìm thấy học viên' }); return }

    const { parents, enrollments, tuitionRecords, promotions, ...rest } = student
    res.json({
      ...api(rest),
      parents: api(parents),
      enrollments: enrollments.map(enrollmentDoc),
      tuitionRecords: tuitionRecords.map(tuitionRecordDoc),
      promotions: promotions.map(studentPromotionDoc),
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/students
router.post('/', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fullName, dateOfBirth, gender, school, gradeLevel, address, notes, parents } = req.body
    const studentId = newId()

    const [student] = await prisma.$transaction([
      prisma.student.create({
        data: {
          id: studentId,
          fullName,
          dateOfBirth: toDay(dateOfBirth),
          gender: gender || null,
          school: school || null,
          gradeLevel: gradeLevel ? Number(gradeLevel) : null,
          address: address || null,
          enrollmentDate: toDay(today())!,
          status: 'ACTIVE',
          notes: notes || null,
        },
      }),
      // Thêm phụ huynh
      prisma.parent.createMany({
        data: ((parents ?? []) as Record<string, any>[]).map(p => ({
          id: newId(), studentId, fullName: p.fullName ?? '', relationship: p.relationship || null,
          phone: p.phone || null, zalo: p.zalo || null, email: p.email || null, isPrimaryContact: !!p.isPrimaryContact,
        })),
      }),
    ])
    res.status(201).json(api(student))
  } catch (err) {
    next(err)
  }
})

// PUT /api/students/:id
router.put('/:id', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fullName, dateOfBirth, gender, school, gradeLevel, address, status, notes, parentName, phone, parentId } = req.body
    const studentId = s(req.params.id)

    const updated = await prisma.$transaction(async tx => {
      const student = await tx.student.update({
        where: { id: studentId },
        data: {
          fullName, gender, school, address, status, notes,
          dateOfBirth: dateOfBirth === undefined ? undefined : toDay(dateOfBirth),
          gradeLevel: gradeLevel === undefined ? undefined : gradeLevel ? Number(gradeLevel) : null,
        },
      })

      // Cập nhật hoặc tạo mới primary parent
      if (parentName !== undefined || phone !== undefined) {
        if (parentId) {
          await tx.parent.update({ where: { id: s(parentId), studentId }, data: { fullName: parentName ?? '', phone: phone ?? '' } })
        } else if (parentName || phone) {
          await tx.parent.create({ data: { id: newId(), studentId, fullName: parentName || '', phone: phone || '', isPrimaryContact: true } })
        }
      }
      return student
    })

    res.json(api(updated))
  } catch (err) {
    next(err)
  }
})

// POST /api/students/:id/enroll/:enrollmentId/remove — xoá enrollment
router.post('/:id/enroll/:enrollmentId/remove', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.$transaction(async tx => {
      const enrollment = await tx.classEnrollment.findUnique({ where: { id: s(req.params.enrollmentId) }, select: { classId: true } })
      if (!enrollment) return
      await tx.classEnrollment.delete({ where: { id: s(req.params.enrollmentId) } })
      await recountClassActiveStudents(enrollment.classId, tx)
    })
    res.json({ message: 'Đã xoá đăng ký lớp học' })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/students/:id — soft delete
router.delete('/:id', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.student.update({ where: { id: s(req.params.id) }, data: { status: 'INACTIVE' } })
    res.json({ message: 'Đã chuyển học viên sang trạng thái không hoạt động' })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/students/:id/hard — xoá hoàn toàn HV và toàn bộ dữ liệu liên quan
router.delete('/:id/hard', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.id)

    await prisma.$transaction(async tx => {
      const active = await tx.classEnrollment.findMany({ where: { studentId, status: 'ACTIVE' }, select: { classId: true } })
      // Học phí và thanh toán được bảo vệ bằng khoá ngoại RESTRICT → xoá trước, có chủ đích.
      await tx.payment.deleteMany({ where: { studentId } })
      await tx.tuitionRecord.deleteMany({ where: { studentId } })
      // Phụ huynh, ghi danh, lịch riêng, điểm danh, khuyến mãi, điểm, nhận xét: xoá theo học viên (ON DELETE CASCADE).
      await tx.student.delete({ where: { id: studentId } })
      // Recount activeStudentCount cho các lớp bị ảnh hưởng
      for (const classId of new Set(active.map(e => e.classId))) await recountClassActiveStudents(classId, tx)
    })

    res.json({ message: 'Đã xoá hoàn toàn dữ liệu học viên' })
  } catch (err) {
    next(err)
  }
})

// POST /api/students/bulk-delete — HARD DELETE xoá vĩnh viễn tất cả học viên (xác nhận MK)
router.post('/bulk-delete', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { password } = req.body
    if (password !== 'cqt263' && password !== 'Cqt@263') {
      res.status(400).json({ message: 'Mật khẩu xác nhận không chính xác' })
      return
    }

    const count = await prisma.student.count()
    if (!count) {
      res.json({ message: 'Không có học viên nào trong cơ sở dữ liệu', count: 0 })
      return
    }

    await prisma.$transaction([
      prisma.payment.deleteMany(),
      prisma.tuitionRecord.deleteMany(),
      // Mọi dữ liệu gắn với học viên xoá theo (ON DELETE CASCADE)
      prisma.student.deleteMany(),
      // Đặt số học viên của tất cả các lớp về 0
      prisma.class.updateMany({ data: { activeStudentCount: 0 } }),
    ])

    res.json({ message: `Đã xóa vĩnh viễn toàn bộ ${count} học viên cùng tất cả dữ liệu liên quan`, count })
  } catch (err) {
    next(err)
  }
})

// POST /api/students/:id/enroll — Đăng ký lớp
router.post('/:id/enroll', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.id)
    const { classId, enrollmentDate, customTuitionRate, notes } = req.body as { classId: string; enrollmentDate?: string; customTuitionRate?: number; notes?: string }

    const [student, cls] = await Promise.all([
      prisma.student.findUnique({ where: { id: studentId }, select: { id: true } }),
      prisma.class.findUnique({ where: { id: classId }, select: { id: true } }),
    ])

    if (!student || !cls) {
      res.status(404).json({ message: 'Không tìm thấy học viên hoặc lớp học' }); return
    }

    const enrollment = await prisma.$transaction(async tx => {
      const created = await tx.classEnrollment.create({
        data: {
          id: newId(), classId, studentId,
          enrollmentDate: toDay(enrollmentDate || today())!,
          status: 'ACTIVE',
          customTuitionRate: customTuitionRate ? Number(customTuitionRate) : null,
          notes: notes || null,
        },
        include: enrollmentInclude,
      })
      await recountClassActiveStudents(classId, tx)
      return created
    })
    res.status(201).json(enrollmentDoc(enrollment))
  } catch (err) {
    next(err)
  }
})

// PUT /api/students/:id/enroll/:enrollmentId/drop
router.put('/:id/enroll/:enrollmentId/drop', requireRole('ADMIN', 'STAFF'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { dropDate } = req.body
    await prisma.$transaction(async tx => {
      const enrollment = await tx.classEnrollment.update({
        where: { id: s(req.params.enrollmentId) },
        data: { status: 'DROPPED', dropDate: toDay(dropDate || today())! },
      })
      await recountClassActiveStudents(enrollment.classId, tx)
    })
    res.json({ message: 'Đã nghỉ lớp' })
  } catch (err) {
    next(err)
  }
})

// GET /api/students/:id/attendance
router.get('/:id/attendance', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { month, year, classId } = req.query as Record<string, string>
    const studentId = s(req.params.id)

    const where: Prisma.StudentAttendanceWhereInput = { studentId, ...(classId ? { classId } : {}) }
    if (month && year) {
      where.session = { sessionDate: { gte: new Date(Date.UTC(Number(year), Number(month) - 1, 1)), lte: new Date(Date.UTC(Number(year), Number(month), 0)) } }
    }
    const attendances = await prisma.studentAttendance.findMany({
      where, include: studentAttendanceInclude, orderBy: { session: { sessionDate: 'desc' } },
    })
    res.json(attendances.map(studentAttendanceDoc))
  } catch (err) {
    next(err)
  }
})

// GET /api/students/:id/schedule?month=X&year=Y
// Trả về lịch học cá nhân của học viên trong tháng: sessions của tất cả lớp đang học
router.get('/:id/schedule', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.id)
    const now = new Date()
    const month = Number((req.query.month as string) || now.getMonth() + 1)
    const year  = Number((req.query.year  as string) || now.getFullYear())

    // 1. Lấy tất cả enrollments của học viên (kể cả dropped để xem lịch cũ)
    const enrollments: ClassEnrollment[] = (await prisma.classEnrollment.findMany({ where: { studentId }, include: enrollmentInclude })).map(enrollmentDoc)

    // Lấy thông tin lớp (tuitionRate, teacher) và các buổi trong tháng của các lớp đó
    const classIds = [...new Set(enrollments.map(e => e.classId))]
    const [classes, monthSessions] = await Promise.all([
      prisma.class.findMany({ where: { id: { in: classIds } }, include: classInclude }),
      prisma.session.findMany({
        where: { classId: { in: classIds }, sessionDate: { gte: new Date(Date.UTC(year, month - 1, 1)), lte: new Date(Date.UTC(year, month, 0)) } },
        include: sessionInclude,
      }),
    ])
    const classMap: Record<string, Record<string, unknown>> = {}
    classes.forEach(c => { classMap[c.id] = classDoc(c) })

    const allSessions: Record<string, unknown>[] = []
    for (const s of monthSessions.map(sessionDoc) as any[]) {
      const cls = classMap[s.classId] || {}
      // A student can leave and rejoin the same class. Match each session to
      // an enrollment covering its date, rather than the first stored record.
      const classEnrollments = enrollments.filter(e => e.classId === s.classId)
        .sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE')
          || (b.enrollmentDate || '').localeCompare(a.enrollmentDate || '')
          || a.id.localeCompare(b.id))
      const enroll = classEnrollments.find(e =>
        (!e.enrollmentDate || s.sessionDate >= e.enrollmentDate)
        && (e.status !== 'DROPPED' || !e.dropDate || s.sessionDate <= e.dropDate)
      )
      if (!enroll) continue
      // Học phí buổi: ưu tiên customTuitionRate của enrollment, fallback về class tuitionRate
      const rate = (enroll?.customTuitionRate as number) || classRateForMonth(cls, month, year)
      allSessions.push({
        ...s,
        className: (cls.name as string) || s.className,
        teacherName: (cls.teacherName as string) || s.teacherName,
        ratePerSession: rate,
      })
    }

    // Sắp xếp theo ngày rồi giờ
    allSessions.sort((a: any, b: any) => {
      if (a.sessionDate !== b.sessionDate) return b.sessionDate.localeCompare(a.sessionDate)
      return (b.startTime || '').localeCompare(a.startTime || '')
    })

    res.json(allSessions)
  } catch (err) {
    next(err)
  }
})

// GET /api/students/:id/tuition-summary
// Tính học phí từ sessions thực tế + đính kèm tuitionRecord (nếu có) để admin biết phiếu đã tạo chưa.
router.get('/:id/tuition-summary', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.id)
    const [summary, records, paid] = await Promise.all([
      computeTuitionSummary(studentId),
      prisma.tuitionRecord.findMany({ where: { studentId }, include: tuitionRecordInclude }).then(rows => rows.map(tuitionRecordDoc)),
      prisma.payment.groupBy({ by: ['tuitionRecordId'], where: { studentId }, _sum: { amount: true } }),
    ])
    const recordsByKey = new Map<string, any>()
    records.forEach((d: any) => recordsByKey.set(`${d.billingYear}-${d.billingMonth}-${d.classId}`, d))
    const paidByRecord = new Map(paid.map(p => [p.tuitionRecordId, p._sum.amount ?? 0]))

    const enriched = summary.map((row: any) => {
      const rec = recordsByKey.get(`${row.year}-${row.month}-${row.classId}`)
      if (!rec) return { ...row, tuitionRecord: null }
      const paidAmount = paidByRecord.get(rec.id) || 0
      return {
        ...row,
        tuitionRecord: {
          id: rec.id,
          finalAmount: rec.finalAmount,
          status: rec.status,
          paidAmount,
          remainingAmount: Math.max(0, rec.finalAmount - paidAmount),
        },
      }
    })

    res.json(enriched)
  } catch (err) {
    next(err)
  }
})

// ─── PRIVATE SCHEDULES ────────────────────────────────────────

// GET /api/students/:id/private-schedule?month=X&year=Y
router.get('/:id/private-schedule', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.id)
    const { month, year } = req.query as Record<string, string>

    const where: Prisma.PrivateSessionWhereInput = { studentId }
    if (month && year) {
      where.sessionDate = { gte: new Date(Date.UTC(Number(year), Number(month) - 1, 1)), lte: new Date(Date.UTC(Number(year), Number(month), 0)) }
    }

    const sessions = (await prisma.privateSession.findMany({ where, include: privateSessionInclude })).map(privateSessionDoc)
    sessions.sort((a: any, b: any) =>
      a.sessionDate !== b.sessionDate
        ? b.sessionDate.localeCompare(a.sessionDate)
        : (b.startTime ?? '').localeCompare(a.startTime ?? '')
    )

    res.json(sessions)
  } catch (err) { next(err) }
})

// POST /api/students/:id/private-schedule — tạo nhiều buổi
router.post('/:id/private-schedule', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.id)
    const { sessions } = req.body as {
      sessions: Array<{ sessionDate: string; startTime?: string; endTime?: string; ratePerSession: number; notes?: string }>
    }

    if (!sessions?.length) { res.status(400).json({ message: 'Cần ít nhất 1 buổi học' }); return }

    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true } })
    if (!student) { res.status(404).json({ message: 'Không tìm thấy học viên' }); return }

    const created = await prisma.$transaction(sessions.map(sess => prisma.privateSession.create({
      data: {
        id: newId(), studentId,
        sessionDate: toDay(sess.sessionDate)!,
        startTime: sess.startTime || null,
        endTime: sess.endTime || null,
        ratePerSession: Number(sess.ratePerSession) || 0,
        status: 'SCHEDULED',
        notes: sess.notes,
      },
      include: privateSessionInclude,
    })))

    res.status(201).json({ message: `Đã tạo ${created.length} buổi học riêng`, sessions: created.map(privateSessionDoc) })
  } catch (err) { next(err) }
})

// PUT /api/students/:id/private-schedule/:sessionId
router.put('/:id/private-schedule/:sessionId', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { startTime, endTime, teacherName } = req.body
    await prisma.privateSession.update({
      where: { id: s(req.params.sessionId) },
      data: {
        startTime: startTime === undefined ? undefined : startTime || null,
        endTime: endTime === undefined ? undefined : endTime || null,
        teacherName: teacherName === undefined ? undefined : teacherName || null,
      },
    })
    res.json({ message: 'Đã cập nhật buổi học' })
  } catch (err) { next(err) }
})

// DELETE /api/students/:id/private-schedule/:sessionId
router.delete('/:id/private-schedule/:sessionId', requireRole('ADMIN', 'STAFF', 'TEACHER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.privateSession.delete({ where: { id: s(req.params.sessionId) } })
    res.json({ message: 'Đã xoá buổi học' })
  } catch (err) { next(err) }
})

export default router
