import { Router, Request, Response, NextFunction } from 'express'
import { prisma, api, newId } from '../lib/db'
import {
  classDoc, classInclude, enrollmentDoc, enrollmentInclude, paymentDoc, paymentInclude,
  privateSessionDoc, privateSessionInclude, scheduleDoc, scheduleInclude, tuitionRecordDoc, tuitionRecordInclude,
} from '../lib/docs'
import { s } from '../lib/params'
import { computeTuitionSummary, loadStudentPromotions } from '../lib/tuition'
import { listMaterialsForStudent } from './materials'
import { studentShortId } from '../services/sepayMatcher'
import { sendTelegramMessage } from '../services/telegramService'
import {
  normalizePhone, studentPhones, signParentToken, verifyParentToken, tokenGrants, isAdminPassword,
  nameMatches, hitLimit, isLimited, clearLimit,
} from '../lib/parentAccess'
import type { Student, ClassEnrollment, Class, Schedule, TuitionRecord, Payment, PrivateSession } from '../types/models'

const router = Router()

// Public endpoint — KHÔNG yêu cầu xác thực.
// Bất kỳ ai có doc ID học viên là xem được. Chỉ trả về dữ liệu cần thiết cho phụ huynh,
// loại các field nội bộ/nhạy cảm (notes, address, primary parent contact...).

interface PublicStudent {
  id: string
  shortId: string
  fullName: string
  dateOfBirth?: string
  gender?: string
  school?: string
  gradeLevel?: number
  enrollmentDate: string
  status: string
  avatarUrl?: string
}


interface PublicClass {
  id: string
  name: string
  subjectName?: string
  teacherName?: string
  room?: string
  startDate?: string
  endDate?: string
  enrollmentDate: string
  enrollmentStatus: string
  schedules: Array<{
    dayOfWeek: string
    startTime: string
    endTime: string
    effectiveFrom: string
    effectiveTo?: string
  }>
}

interface PublicTuition {
  id: string
  billingMonth: number
  billingYear: number
  baseAmount: number
  discountAmount: number
  /** Điều chỉnh học phí tháng (+ thu thêm, − giảm), đã gồm trong baseAmount / discountAmount */
  adjustmentAmount: number
  adjustmentNote?: string | null
  finalAmount: number
  paidAmount: number
  remainingAmount: number
  totalSessions: number
  chargedSessions: number
  status: string
  dueDate?: string
  className: string
  payments: Array<{
    id: string
    amount: number
    paymentDate: string
    method?: string
    notes?: string
  }>
}

// In-memory response cache when parents refresh repeatedly.
// 60-second TTL is acceptable: admin updates show up within a minute.
const publicCache = new Map<string, { at: number; payload: any }>()
const PUBLIC_TTL_MS = 60_000

// ─── Khoá trang chia sẻ bằng SĐT Zalo phụ huynh ────────────────
// Giai đoạn chuyển tiếp: false = vẫn trả dữ liệu khi thiếu token (link cũ chưa hỏng);
// bật true sau khi trang cqt.vn/hoc-vien đã có màn hình nhập SĐT.
export const ENFORCE_PARENT_TOKEN = false

const MAX_FAILS_PER_STUDENT = 5
const FAIL_WINDOW_MS = 15 * 60_000

const ipOf = (req: Request) => req.ip || 'unknown'
function tooMany(res: Response, message = 'Bạn thao tác quá nhiều lần. Vui lòng thử lại sau ít phút.') {
  res.setHeader('Retry-After', '60')
  res.status(429).json({ message })
}

/** Học viên ACTIVE kèm SĐT phụ huynh; không có / đã nghỉ → null */
async function loadGateStudent(studentId: string) {
  const row = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, fullName: true, status: true, parents: { select: { phone: true, zalo: true } } },
  })
  if (!row || row.status !== 'ACTIVE') return null
  return { id: row.id, fullName: row.fullName, phones: studentPhones(row.parents) }
}

const bearer = (req: Request) => {
  const h = req.headers.authorization
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined
}

// Danh sách tên học viên ACTIVE để tìm kiếm — cache 60s (vài nghìn dòng, lọc trong bộ nhớ, không phân biệt dấu)
let lookupCache: { at: number; rows: Array<{ id: string; fullName: string; gradeLevel: number | null }> } | null = null

// GET /api/public/lookup?q= — trang cqt.vn/hoctap: tìm học viên theo tên → họ tên, khối, lớp, id (link chia sẻ)
router.get('/lookup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (hitLimit(`lookup:${ipOf(req)}`, 30, 60_000)) return tooMany(res)
    const q = String(req.query.q ?? '').trim().slice(0, 60)
    if (q.replace(/\s/g, '').length < 2) { res.json({ results: [] }); return }

    if (!lookupCache || Date.now() - lookupCache.at > PUBLIC_TTL_MS) {
      const rows = await prisma.student.findMany({
        where: { status: 'ACTIVE' }, select: { id: true, fullName: true, gradeLevel: true }, orderBy: { fullName: 'asc' },
      })
      lookupCache = { at: Date.now(), rows }
    }
    const hits = lookupCache.rows.filter(r => nameMatches(r.fullName, q)).slice(0, 10)
    const enrollments = hits.length ? await prisma.classEnrollment.findMany({
      where: { studentId: { in: hits.map(h => h.id) }, status: 'ACTIVE' },
      select: { studentId: true, class: { select: { name: true, gradeLevel: true } } },
    }) : []

    res.json({
      results: hits.map(h => {
        const own = enrollments.filter(e => e.studentId === h.id)
        return {
          id: h.id,
          fullName: h.fullName,
          gradeLevel: h.gradeLevel ?? own.find(e => e.class.gradeLevel)?.class.gradeLevel ?? null,
          classes: own.map(e => ({ name: e.class.name })),
        }
      }),
    })
  } catch (err) { next(err) }
})

// GET /api/public/student/:id/gate — tên học viên + đã có SĐT phụ huynh chưa (chọn form xác minh hay đăng ký)
router.get('/student/:id/gate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (hitLimit(`gate:${ipOf(req)}`, 60, 60_000)) return tooMany(res)
    const st = await loadGateStudent(s(req.params.id))
    if (!st) { res.status(404).json({ message: 'Liên kết không đúng hoặc đã hết hiệu lực.' }); return }
    res.json({ fullName: st.fullName, needsSetup: st.phones.size === 0 })
  } catch (err) { next(err) }
})

// POST /api/public/student/:id/verify — { phone } hoặc { adminPassword } → { token, role }
router.post('/student/:id/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.id)
    const failKey = `fail:${studentId}`
    if (hitLimit(`verify:${ipOf(req)}`, 10, 60_000)) return tooMany(res)
    if (isLimited(failKey, MAX_FAILS_PER_STUDENT)) {
      return tooMany(res, 'Nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút hoặc liên hệ trung tâm.')
    }
    const st = await loadGateStudent(studentId)
    if (!st) { res.status(404).json({ message: 'Liên kết không đúng hoặc đã hết hiệu lực.' }); return }

    const { phone, adminPassword } = req.body ?? {}
    if (adminPassword !== undefined) {
      if (isAdminPassword(adminPassword)) { clearLimit(failKey); res.json({ token: signParentToken(studentId, 'admin'), role: 'admin' }); return }
    } else {
      if (st.phones.size === 0) { res.status(409).json({ message: 'Học viên chưa có SĐT phụ huynh.', needsSetup: true }); return }
      const n = normalizePhone(phone)
      if (!n) { res.status(400).json({ message: 'SĐT phải gồm 10 chữ số, bắt đầu bằng 0.' }); return }
      if (st.phones.has(n)) { clearLimit(failKey); res.json({ token: signParentToken(studentId, 'parent', n), role: 'parent' }); return }
    }
    hitLimit(failKey, MAX_FAILS_PER_STUDENT, FAIL_WINDOW_MS)
    res.status(401).json({
      message: adminPassword !== undefined ? 'Mật khẩu quản trị không đúng.' : 'SĐT không khớp với SĐT phụ huynh trung tâm đang lưu.',
    })
  } catch (err) { next(err) }
})

// POST /api/public/student/:id/setup — học viên CHƯA có SĐT phụ huynh: lưu số phụ huynh tự nhập → { token }
router.post('/student/:id/setup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.id)
    if (hitLimit(`setup:${ipOf(req)}`, 5, 60_000)) return tooMany(res)
    const phone = normalizePhone(req.body?.phone)
    if (!phone) { res.status(400).json({ message: 'SĐT phải gồm 10 chữ số, bắt đầu bằng 0.' }); return }
    const parentName = String(req.body?.parentName ?? '').trim().slice(0, 80) || 'Phụ huynh'
    const relationship = String(req.body?.relationship ?? '').trim().slice(0, 30) || 'PHỤ HUYNH'

    const result = await prisma.$transaction(async tx => {
      // Khoá dòng học viên: hai người đăng ký cùng lúc thì người sau thấy số đã có
      await tx.$queryRaw`SELECT id FROM students WHERE id = ${studentId} FOR UPDATE`
      const row = await tx.student.findUnique({
        where: { id: studentId },
        select: { fullName: true, status: true, parents: { select: { id: true, phone: true, zalo: true }, orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }] } },
      })
      if (!row || row.status !== 'ACTIVE') return { status: 404 as const }
      if (studentPhones(row.parents).size > 0) return { status: 409 as const }
      const now = new Date()
      const empty = row.parents[0]
      if (empty) {
        await tx.parent.update({ where: { id: empty.id }, data: { phone, zalo: empty.zalo || phone, selfRegisteredAt: now } })
      } else {
        await tx.parent.create({
          data: { id: newId(), studentId, fullName: parentName, relationship, phone, zalo: phone, isPrimaryContact: true, selfRegisteredAt: now },
        })
      }
      return { status: 200 as const, fullName: row.fullName }
    })

    if (result.status === 404) { res.status(404).json({ message: 'Liên kết không đúng hoặc đã hết hiệu lực.' }); return }
    if (result.status === 409) { res.status(409).json({ message: 'Học viên đã có SĐT phụ huynh. Vui lòng nhập đúng SĐT đó.', needsSetup: false }); return }

    publicCache.delete(studentId)
    void sendTelegramMessage([
      '📱 PHỤ HUYNH TỰ ĐĂNG KÝ SĐT (trang chia sẻ cqt.vn)',
      `Học viên: ${result.fullName}`,
      `SĐT: ${phone} — ${parentName} (${relationship})`,
      'Kiểm tra lại; nếu sai, sửa SĐT phụ huynh trong hồ sơ học viên:',
      `https://qlhv.cqt.vn/students/${studentId}`,
    ].join('\n')).catch(() => {})

    res.json({ token: signParentToken(studentId, 'parent', phone), role: 'parent' })
  } catch (err) { next(err) }
})

// GET /api/public/student/:id — toàn bộ dữ liệu cần cho trang chia sẻ phụ huynh (cần token khi ENFORCE_PARENT_TOKEN)
router.get('/student/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.id)

    const token = bearer(req)
    if (ENFORCE_PARENT_TOKEN || token) {
      const gate = await loadGateStudent(studentId)
      if (!gate) { res.status(404).json({ message: 'Không tìm thấy học viên' }); return }
      if (!tokenGrants(verifyParentToken(token), studentId, gate.phones)) {
        res.status(401).json({ message: 'Cần xác minh SĐT phụ huynh.', needsSetup: gate.phones.size === 0 })
        return
      }
    }

    const cached = publicCache.get(studentId)
    if (cached && Date.now() - cached.at < PUBLIC_TTL_MS) {
      res.json(cached.payload)
      return
    }

    const studentRow = await prisma.student.findUnique({ where: { id: studentId } })
    if (!studentRow) {
      res.status(404).json({ message: 'Không tìm thấy học viên' })
      return
    }
    const student: Student = api(studentRow)

    // Chỉ trả về học viên ACTIVE (đã nghỉ thì không cho xem)
    if (student.status !== 'ACTIVE') {
      res.status(404).json({ message: 'Học viên không khả dụng' })
      return
    }

    const publicStudent: PublicStudent = {
      id: student.id,
      shortId: studentShortId(student.id),
      fullName: student.fullName,
      dateOfBirth: student.dateOfBirth,
      gender: student.gender,
      school: student.school,
      gradeLevel: student.gradeLevel,
      enrollmentDate: student.enrollmentDate,
      status: student.status,
      avatarUrl: student.avatarUrl,
    }

    // ─── Lấy lớp + lịch học ────────────────────────────────────
    const enrollments: ClassEnrollment[] = (await prisma.classEnrollment.findMany({
      where: { studentId, status: 'ACTIVE' }, include: enrollmentInclude,
    })).map(enrollmentDoc)
    const classIds = enrollments.map(e => e.classId)

    const classesById = new Map<string, Class>()
    const schedulesByClass = new Map<string, Schedule[]>()

    if (classIds.length > 0) {
      const [classes, schedules] = await Promise.all([
        prisma.class.findMany({ where: { id: { in: classIds } }, include: classInclude }),
        prisma.schedule.findMany({ where: { classId: { in: classIds } }, include: scheduleInclude }),
      ])
      classes.map(classDoc).forEach((c: Class) => classesById.set(c.id, c))
      schedules.map(scheduleDoc).forEach((sc: Schedule) => {
        const arr = schedulesByClass.get(sc.classId) ?? []
        arr.push(sc)
        schedulesByClass.set(sc.classId, arr)
      })
    }

    const classes: PublicClass[] = enrollments.map(e => {
      const cls = classesById.get(e.classId)
      // Học viên học một phần số buổi của lớp → chỉ hiện các thứ em học.
      const scheds = (schedulesByClass.get(e.classId) ?? []).filter(sc => !e.weekdays || e.weekdays.includes(sc.dayOfWeek)).map(sc => ({
        dayOfWeek: sc.dayOfWeek,
        startTime: sc.startTime,
        endTime: sc.endTime,
        effectiveFrom: sc.effectiveFrom,
        effectiveTo: sc.effectiveTo,
      }))
      return {
        id: e.classId,
        name: cls?.name ?? e.className,
        subjectName: cls?.subjectName,
        teacherName: cls?.teacherName,
        room: cls?.room,
        startDate: cls?.startDate,
        endDate: cls?.endDate,
        enrollmentDate: e.enrollmentDate,
        enrollmentStatus: e.status,
        schedules: scheds,
      }
    })

    // ─── Học phí + lịch sử thanh toán ──────────────────────────
    const [tuitionRows, paymentRows] = await Promise.all([
      prisma.tuitionRecord.findMany({ where: { studentId }, include: tuitionRecordInclude }),
      prisma.payment.findMany({ where: { tuitionRecord: { studentId } }, include: paymentInclude }),
    ])
    const tuitionRecords: TuitionRecord[] = tuitionRows.map(tuitionRecordDoc)

    const paymentsByTuition = new Map<string, Payment[]>()
    paymentRows.map(paymentDoc).forEach((p: Payment) => {
      const arr = paymentsByTuition.get(p.tuitionRecordId) ?? []
      arr.push(p)
      paymentsByTuition.set(p.tuitionRecordId, arr)
    })

    const tuition: PublicTuition[] = tuitionRecords
      .sort((a, b) => (b.billingYear - a.billingYear) || (b.billingMonth - a.billingMonth))
      .map(t => {
        const pays = (paymentsByTuition.get(t.id) ?? [])
          .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))
        const paidAmount = pays.reduce((sum, p) => sum + (p.amount || 0), 0)
        return {
          id: t.id,
          billingMonth: t.billingMonth,
          billingYear: t.billingYear,
          baseAmount: t.baseAmount,
          discountAmount: t.discountAmount,
          adjustmentAmount: t.adjustmentAmount ?? 0,
          adjustmentNote: t.adjustmentNote ?? null,
          finalAmount: t.finalAmount,
          paidAmount,
          remainingAmount: Math.max(0, t.finalAmount - paidAmount),
          totalSessions: t.totalSessions,
          chargedSessions: t.chargedSessions,
          status: t.status,
          dueDate: t.dueDate,
          className: t.className,
          payments: pays.map(p => ({
            id: p.id,
            amount: p.amount,
            paymentDate: p.paymentDate,
            method: p.method,
            notes: p.notes,
          })),
        }
      })

    // Nhận xét tháng và điểm kiểm tra đã chuyển sang theodoi.cqt.vn (trang phụ huynh lấy trực tiếp từ đó)

    const [tuitionSummary, promotions, privateSessionsRaw] = await Promise.all([
      computeTuitionSummary(studentId),
      loadStudentPromotions(studentId),
      prisma.privateSession.findMany({ where: { studentId }, include: privateSessionInclude }),
    ])

    const startOfMonth = new Date().toISOString().slice(0, 7) + '-01'
    const privateSchedules = (privateSessionsRaw.map(privateSessionDoc) as PrivateSession[])
      .filter(p => p.status !== 'CANCELLED' && p.sessionDate >= startOfMonth)
      .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))
      .slice(0, 60)
      .map(p => ({
        id: p.id,
        sessionDate: p.sessionDate,
        startTime: p.startTime,
        endTime: p.endTime,
        teacherName: p.teacherName,
      }))

    const materials = await listMaterialsForStudent(studentId)

    const payload = {
      student: publicStudent,
      classes,
      privateSchedules,
      tuition,
      tuitionSummary,
      promotions,
      materials,
    }
    publicCache.set(studentId, { at: Date.now(), payload })
    res.json(payload)
  } catch (err) { next(err) }
})

// GET /api/public/payments/:studentId?month=&year=
// Trả về tóm tắt thanh toán tháng để public page polling realtime.
// Không cache — caller dùng để check trạng thái sau khi CK.
router.get('/payments/:studentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const studentId = s(req.params.studentId)
    const month = Number(req.query.month) || (new Date().getMonth() + 1)
    const year = Number(req.query.year) || new Date().getFullYear()

    const studentRow = await prisma.student.findUnique({ where: { id: studentId }, select: { status: true } })
    if (!studentRow || studentRow.status !== 'ACTIVE') {
      res.status(404).json({ message: 'Học viên không khả dụng' })
      return
    }

    const records: TuitionRecord[] = (await prisma.tuitionRecord.findMany({
      where: { studentId, billingMonth: month, billingYear: year }, include: tuitionRecordInclude,
    })).map(tuitionRecordDoc)
    if (records.length === 0) {
      res.json({ month, year, records: [], totalFinalAmount: 0, totalPaid: 0 })
      return
    }

    const payments = (await prisma.payment.findMany({
      where: { tuitionRecordId: { in: records.map(r => r.id).slice(0, 10) } }, include: paymentInclude,
    })).map(paymentDoc) as Payment[]

    const result = records.map(r => {
      const paid = payments.filter(p => p.tuitionRecordId === r.id)
        .reduce((sum, p) => sum + (p.amount || 0), 0)
      return {
        id: r.id,
        classId: r.classId,
        className: r.className,
        finalAmount: r.finalAmount,
        totalPaid: paid,
        status: r.status,
      }
    })

    const totalFinalAmount = result.reduce((s, r) => s + r.finalAmount, 0)
    const totalPaid = result.reduce((s, r) => s + r.totalPaid, 0)
    res.json({ month, year, records: result, totalFinalAmount, totalPaid })
  } catch (err) {
    next(err)
  }
})

export default router
