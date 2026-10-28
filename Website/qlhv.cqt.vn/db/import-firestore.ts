// Nhập bản export Firestore (db/export-firestore.cjs) vào PostgreSQL theo db/schema.prisma.
//   DATABASE_URL=... npx tsx db/import-firestore.ts /duong-dan/qlhv-backup-YYYY-MM-DD
// - Kiểm SHA-256 + số dòng với manifest trước khi ghi.
// - Chỉ nhập vào database trống; toàn bộ chạy trong một transaction.
// - In báo cáo: số dòng mỗi bảng, bất thường đã xử lý, trường không được ánh xạ (để không mất dữ liệu âm thầm).
// Báo cáo chỉ in ID tài liệu, không in dữ liệu cá nhân.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma, PrismaClient } from '@prisma/client'

type Doc = { path: string; collection_path: string; document_id: string; data: Record<string, any> }

const dir = process.argv[2]
if (!dir) throw new Error('Usage: npx tsx db/import-firestore.ts /path/to/backup-dir')

// ─── Đọc và kiểm tra bản export ──────────────────────────────

const raw = readFileSync(join(dir, 'firestore.ndjson'), 'utf8')
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
if (createHash('sha256').update(raw).digest('hex') !== manifest.sha256) throw new Error('SHA-256 không khớp manifest')
const docs: Doc[] = raw.split('\n').filter(Boolean).map(l => JSON.parse(l))
if (docs.length !== manifest.total) throw new Error(`Số dòng ${docs.length} ≠ manifest ${manifest.total}`)

const byCollection = new Map<string, Doc[]>()
for (const d of docs) {
  const key = d.collection_path.includes('/') ? '*/' + d.collection_path.split('/').at(-1) : d.collection_path
  byCollection.set(key, [...(byCollection.get(key) ?? []), d])
}
const coll = (name: string) => byCollection.get(name) ?? []

// ─── Báo cáo ─────────────────────────────────────────────────

const issues: Record<string, string[]> = {}
const issue = (kind: string, id: string) => (issues[kind] ??= []).push(id)
const unmapped: Record<string, Set<string>> = {}

/** Lấy các field đã biết; field lạ được ghi vào báo cáo unmapped. */
function pick(collection: string, doc: Doc, known: string[]) {
  for (const k of Object.keys(doc.data)) if (!known.includes(k)) (unmapped[collection] ??= new Set()).add(k)
  return doc.data
}

// ─── Chuyển kiểu ─────────────────────────────────────────────

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
// Chỉ nhận chuỗi ISO — new Date() của JS tự đoán năm cho chuỗi như "15-Jul" (→ 2001).
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

function ts(v: any): Date | undefined {
  if (v == null || v === '') return undefined
  if (typeof v === 'object' && v.$firestoreType === 'timestamp') return new Date(v.seconds * 1000 + Math.floor(v.nanoseconds / 1e6))
  if (typeof v === 'number') return new Date(v)
  if (typeof v !== 'string' || !ISO_DATETIME.test(v)) return undefined
  const d = new Date(v)
  return isNaN(d.getTime()) ? undefined : d
}

/** "YYYY-MM-DD" (hoặc datetime ISO) → Date cho cột @db.Date. */
function day(v: any): Date | undefined {
  if (v == null || v === '') return undefined
  if (typeof v === 'string' && ISO_DAY.test(v)) return new Date(v + 'T00:00:00Z')
  const d = ts(v)
  if (!d) return undefined
  // Lấy ngày theo giờ Việt Nam để không lệch ngày khi giá trị là thời điểm UTC.
  return new Date(new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00Z')
}

/**
 * Ngày sinh nhập từ Excel dạng m/d/yy (kiểu Mỹ). Đo trên dữ liệu 28/10/2026: không giá trị nào có phần đầu > 12,
 * 47/81 có phần thứ hai > 12 — nên phần đầu là tháng.
 */
function dob(v: any, id: string): Date | undefined {
  if (v == null || v === '') return undefined
  if (typeof v === 'string' && ISO_DAY.test(v)) return day(v)
  const m = typeof v === 'string' && v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (!m) { issue('students.dateOfBirth không đọc được → bỏ trống', id); return undefined }
  const yy = Number(m[3])
  const year = m[3].length === 4 ? yy : yy + (yy <= 30 ? 2000 : 1900)
  const iso = `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  const d = new Date(iso + 'T00:00:00Z')
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) { issue('students.dateOfBirth không hợp lệ → bỏ trống', id); return undefined }
  return d
}

// Giữ nguyên chuỗi rỗng như Firestore (API cũ trả ""); ID rỗng được optFk/classRef xử lý riêng.
const str = (v: any) => (v == null ? undefined : String(v))
const int = (v: any, fallback = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : fallback)
const classRef = (v: any) => (v == null || v === '' || v === 'private' ? null : String(v))
const json = (v: any) => (v === undefined ? Prisma.JsonNull : (v as Prisma.InputJsonValue))

// ─── Nhập ────────────────────────────────────────────────────

const prisma = new PrismaClient()

async function main() {
  const existing = await prisma.student.count()
  if (existing) throw new Error('Database đã có dữ liệu — chỉ nhập vào database trống')

  const ids = (name: string) => new Set(coll(name).map(d => d.document_id))
  const users = ids('users'), teachers = ids('teachers'), students = ids('students'), classes = ids('classes')
  const schedules = ids('schedules'), sessions = ids('sessions'), promotions = ids('promotions'), tuition = ids('tuitionRecords')
  const subjects = ids('subjects')

  /** FK tuỳ chọn trỏ tới bản ghi đã xoá → NULL (có báo cáo). */
  const optFk = (set: Set<string>, v: any, kind: string, id: string) => {
    const ref = str(v) || undefined
    if (ref && !set.has(ref)) { issue(kind + ' trỏ tới bản ghi đã xoá → NULL', id); return null }
    return ref ?? null
  }

  const counts: Record<string, number> = {}
  const insert = async (table: string, rows: any[], fn: (rows: any[]) => Promise<{ count: number }>) => {
    counts[table] = rows.length ? (await fn(rows)).count : 0
  }

  await prisma.$transaction(async tx => {
    await insert('users', coll('users').map(d => {
      const x = pick('users', d, ['username', 'passwordHash', 'role', 'fullName', 'email', 'isActive', 'teacherId', 'createdAt', 'updatedAt'])
      return { id: d.document_id, username: x.username, passwordHash: x.passwordHash, role: x.role, fullName: x.fullName,
        email: str(x.email), isActive: x.isActive !== false, createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) ?? ts(x.createdAt) }
    }), rows => tx.user.createMany({ data: rows }))

    await insert('teachers', coll('teachers').map(d => {
      const x = pick('teachers', d, ['userId', 'fullName', 'phone', 'email', 'address', 'dateOfBirth', 'idCard', 'bankAccount', 'bankName',
        'salaryRatePerSession', 'status', 'notes', 'createdAt', 'updatedAt'])
      return { id: d.document_id, userId: optFk(users, x.userId, 'teachers.userId', d.document_id), fullName: x.fullName, phone: str(x.phone),
        email: str(x.email), address: str(x.address), dateOfBirth: day(x.dateOfBirth), idCard: str(x.idCard), bankAccount: str(x.bankAccount),
        bankName: str(x.bankName), salaryRatePerSession: int(x.salaryRatePerSession), status: x.status ?? 'ACTIVE', notes: str(x.notes),
        createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) ?? ts(x.createdAt) }
    }), rows => tx.teacher.createMany({ data: rows }))

    await insert('subjects', coll('subjects').map(d => {
      const x = pick('subjects', d, ['name', 'gradeLevel', 'tuitionRatePerSession', 'description', 'isActive', 'createdAt'])
      return { id: d.document_id, name: x.name, gradeLevel: x.gradeLevel ?? null, tuitionRatePerSession: int(x.tuitionRatePerSession),
        description: str(x.description), isActive: x.isActive !== false, createdAt: ts(x.createdAt) }
    }), rows => tx.subject.createMany({ data: rows }))

    await insert('students', coll('students').map(d => {
      const x = pick('students', d, ['fullName', 'dateOfBirth', 'gender', 'school', 'gradeLevel', 'address', 'enrollmentDate', 'status',
        'avatarUrl', 'notes', 'primaryParentName', 'primaryParentPhone', 'primaryParentZalo', 'createdAt', 'updatedAt'])
      // Năm học 2026–2027: lớp 12 sinh 2009 → năm sinh ≈ 2021 − lớp. Lệch > 1 năm là lỗi gõ ở dữ liệu gốc; giữ nguyên và báo.
      const born = dob(x.dateOfBirth, d.document_id)
      if (born && x.gradeLevel && Math.abs(born.getUTCFullYear() - (2021 - x.gradeLevel)) > 1)
        issue('students.dateOfBirth không khớp khối lớp (giữ nguyên, cần sửa tay)', d.document_id)
      let enrollmentDate = day(x.enrollmentDate)
      if (!enrollmentDate) { issue('students.enrollmentDate thiếu năm → tạm dùng ngày createdAt, cần sửa tay', d.document_id); enrollmentDate = day(x.createdAt) }
      return { id: d.document_id, fullName: x.fullName, dateOfBirth: born, gender: x.gender ?? null,
        school: str(x.school), gradeLevel: x.gradeLevel ?? null, address: str(x.address), enrollmentDate, status: x.status ?? 'ACTIVE',
        avatarUrl: str(x.avatarUrl), notes: str(x.notes), createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) ?? ts(x.createdAt) }
    }), rows => tx.student.createMany({ data: rows }))

    // Phụ huynh: subcollection; học viên chỉ có primaryParent* (denorm) mà không có subcollection → tạo phụ huynh chính.
    const parentRows = coll('*/parents').map(d => {
      const x = pick('*/parents', d, ['studentId', 'fullName', 'relationship', 'phone', 'zalo', 'email', 'isPrimaryContact', 'createdAt'])
      return { id: d.document_id, studentId: d.path.split('/')[1], fullName: x.fullName, relationship: x.relationship ?? null,
        phone: str(x.phone), zalo: str(x.zalo), email: str(x.email), isPrimaryContact: !!x.isPrimaryContact, createdAt: ts(x.createdAt) }
    })
    const withParent = new Set(parentRows.map(p => p.studentId))
    for (const d of coll('students')) {
      const x = d.data
      if (!withParent.has(d.document_id) && (x.primaryParentName || x.primaryParentPhone)) {
        issue('students.primaryParent* không có subcollection → tạo phụ huynh chính', d.document_id)
        parentRows.push({ id: d.document_id + '_primary', studentId: d.document_id, fullName: x.primaryParentName || '', relationship: null,
          phone: str(x.primaryParentPhone), zalo: str(x.primaryParentZalo), email: undefined, isPrimaryContact: true, createdAt: ts(x.createdAt) })
      }
    }
    await insert('parents', parentRows, rows => tx.parent.createMany({ data: rows }))

    await insert('student_reviews', coll('*/reviews').map(d => {
      const x = pick('*/reviews', d, ['teacherId', 'teacherName', 'month', 'content', 'createdAt', 'updatedAt'])
      const studentId = d.path.split('/')[1]
      return { id: `${studentId}_${x.month ?? d.document_id}`, studentId, month: x.month ?? d.document_id, content: x.content ?? '',
        teacherId: str(x.teacherId), teacherName: str(x.teacherName), createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) ?? ts(x.createdAt) }
    }), rows => tx.studentReview.createMany({ data: rows }))

    await insert('promotions', coll('promotions').map(d => {
      const x = pick('promotions', d, ['name', 'type', 'value', 'conditions', 'validFrom', 'validTo', 'isActive', 'createdAt'])
      return { id: d.document_id, name: x.name, type: x.type, value: int(x.value), conditions: str(x.conditions), validFrom: day(x.validFrom),
        validTo: day(x.validTo), isActive: x.isActive !== false, createdAt: ts(x.createdAt) }
    }), rows => tx.promotion.createMany({ data: rows }))

    const rateRows: any[] = []
    await insert('classes', coll('classes').map(d => {
      const x = pick('classes', d, ['name', 'subjectId', 'subjectName', 'teacherId', 'teacherName', 'room', 'maxStudents', 'tuitionRate',
        'tuitionRateHistory', 'tuitionRateEffectiveMonth', 'sessionsPerMonth', 'gradeLevel', 'startDate', 'endDate', 'status', 'notes',
        'activeStudentCount', 'createdAt', 'updatedAt'])
      for (const h of Array.isArray(x.tuitionRateHistory) ? x.tuitionRateHistory : [])
        rateRows.push({ classId: d.document_id, effectiveMonth: h.effectiveMonth, rate: int(h.rate) })
      if (x.tuitionRateEffectiveMonth && !rateRows.some(r => r.classId === d.document_id && r.effectiveMonth === x.tuitionRateEffectiveMonth))
        rateRows.push({ classId: d.document_id, effectiveMonth: x.tuitionRateEffectiveMonth, rate: int(x.tuitionRate) })
      return { id: d.document_id, name: x.name, subjectId: optFk(subjects, x.subjectId, 'classes.subjectId', d.document_id),
        teacherId: optFk(teachers, x.teacherId, 'classes.teacherId', d.document_id), room: str(x.room), maxStudents: x.maxStudents ?? null,
        tuitionRate: x.tuitionRate ?? null, sessionsPerMonth: x.sessionsPerMonth ?? null, gradeLevel: x.gradeLevel ?? null,
        startDate: day(x.startDate), endDate: day(x.endDate), status: x.status ?? 'ACTIVE', notes: str(x.notes),
        activeStudentCount: int(x.activeStudentCount), createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) ?? ts(x.createdAt) }
    }), rows => tx.class.createMany({ data: rows }))
    await insert('class_tuition_rates', rateRows, rows => tx.classTuitionRate.createMany({ data: rows }))

    await insert('class_enrollments', coll('classEnrollments').map(d => {
      const x = pick('classEnrollments', d, ['classId', 'className', 'studentId', 'studentName', 'enrollmentDate', 'dropDate', 'status',
        'customTuitionRate', 'notes', 'createdAt', 'updatedAt'])
      return { id: d.document_id, classId: x.classId, studentId: x.studentId, enrollmentDate: day(x.enrollmentDate) ?? day(x.createdAt),
        dropDate: day(x.dropDate), status: x.status ?? 'ACTIVE', customTuitionRate: x.customTuitionRate ?? null, notes: str(x.notes),
        createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) ?? null }
    }), rows => tx.classEnrollment.createMany({ data: rows }))

    await insert('schedules', coll('schedules').map(d => {
      const x = pick('schedules', d, ['classId', 'className', 'dayOfWeek', 'startTime', 'endTime', 'effectiveFrom', 'effectiveTo', 'createdAt'])
      return { id: d.document_id, classId: x.classId, dayOfWeek: x.dayOfWeek, startTime: x.startTime, endTime: x.endTime,
        effectiveFrom: day(x.effectiveFrom), effectiveTo: day(x.effectiveTo), createdAt: ts(x.createdAt) }
    }), rows => tx.schedule.createMany({ data: rows }))

    await insert('sessions', coll('sessions').map(d => {
      const x = pick('sessions', d, ['classId', 'className', 'teacherId', 'teacherName', 'scheduleId', 'sessionDate', 'startTime', 'endTime',
        'status', 'cancelReason', 'notes', 'createdAt', 'updatedAt'])
      return { id: d.document_id, classId: x.classId, teacherId: optFk(teachers, x.teacherId, 'sessions.teacherId', d.document_id),
        scheduleId: optFk(schedules, x.scheduleId, 'sessions.scheduleId', d.document_id), sessionDate: day(x.sessionDate),
        startTime: x.startTime, endTime: x.endTime, status: x.status ?? 'SCHEDULED', cancelReason: str(x.cancelReason), notes: str(x.notes),
        createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) ?? ts(x.createdAt) }
    }), rows => tx.session.createMany({ data: rows }))

    await insert('private_sessions', coll('privateSchedules').map(d => {
      const x = pick('privateSchedules', d, ['studentId', 'studentName', 'sessionDate', 'startTime', 'endTime', 'teacherName', 'ratePerSession',
        'status', 'cancelReason', 'notes', 'createdAt', 'updatedAt'])
      return { id: d.document_id, studentId: x.studentId, sessionDate: day(x.sessionDate), startTime: str(x.startTime), endTime: str(x.endTime),
        teacherName: str(x.teacherName), ratePerSession: int(x.ratePerSession), status: x.status ?? 'SCHEDULED', cancelReason: str(x.cancelReason), notes: str(x.notes),
        createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) ?? ts(x.createdAt) }
    }), rows => tx.privateSession.createMany({ data: rows }))

    await insert('holidays', coll('holidays').map(d => {
      const x = pick('holidays', d, ['date', 'startDate', 'endDate', 'dates', 'name', 'description', 'createdAt'])
      const start = day(x.startDate) ?? day(x.date)
      return { id: d.document_id, name: x.name, description: str(x.description), startDate: start, endDate: day(x.endDate) ?? start,
        dates: (Array.isArray(x.dates) ? x.dates : []).map(day).filter(Boolean), createdAt: ts(x.createdAt) }
    }), rows => tx.holiday.createMany({ data: rows }))

    await insert('student_attendances', coll('studentAttendances').filter(d => sessions.has(d.data.sessionId) || (issue('studentAttendances.sessionId không tồn tại → bỏ qua', d.document_id), false)).map(d => {
      const x = pick('studentAttendances', d, ['sessionId', 'sessionDate', 'classId', 'className', 'studentId', 'studentName', 'status', 'notes', 'createdAt', 'updatedAt'])
      return { id: d.document_id, sessionId: x.sessionId, classId: x.classId, studentId: x.studentId, status: x.status, notes: str(x.notes),
        createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) ?? ts(x.createdAt) }
    }), rows => tx.studentAttendance.createMany({ data: rows }))

    await insert('teacher_attendances', coll('teacherAttendances').filter(d => sessions.has(d.data.sessionId) || (issue('teacherAttendances.sessionId không tồn tại → bỏ qua', d.document_id), false)).map(d => {
      const x = pick('teacherAttendances', d, ['sessionId', 'sessionDate', 'classId', 'className', 'teacherId', 'teacherName', 'status',
        'substituteTeacherId', 'substituteTeacherName', 'checkInTime', 'checkOutTime', 'notes', 'createdAt'])
      return { id: d.document_id, sessionId: x.sessionId, classId: x.classId, teacherId: x.teacherId, status: x.status,
        substituteTeacherId: optFk(teachers, x.substituteTeacherId, 'teacherAttendances.substituteTeacherId', d.document_id),
        checkInTime: str(x.checkInTime), checkOutTime: str(x.checkOutTime), notes: str(x.notes), createdAt: ts(x.createdAt) }
    }), rows => tx.teacherAttendance.createMany({ data: rows }))

    await insert('student_promotions', coll('studentPromotions').map(d => {
      const x = pick('studentPromotions', d, ['studentId', 'studentName', 'classId', 'className', 'promotionId', 'promotionName', 'promotionType',
        'promotionValue', 'appliedFrom', 'appliedTo', 'approvedById', 'notes', 'createdAt'])
      return { id: d.document_id, studentId: x.studentId, classId: classRef(x.classId), className: str(x.className) ?? null, promotionId: x.promotionId, promotionName: x.promotionName,
        promotionType: x.promotionType, promotionValue: int(x.promotionValue), appliedFrom: day(x.appliedFrom), appliedTo: day(x.appliedTo),
        approvedById: optFk(users, x.approvedById, 'studentPromotions.approvedById', d.document_id), notes: str(x.notes), createdAt: ts(x.createdAt) }
    }), rows => tx.studentPromotion.createMany({ data: rows }))

    await insert('tuition_records', coll('tuitionRecords').map(d => {
      const x = pick('tuitionRecords', d, ['studentId', 'studentName', 'classId', 'className', 'billingMonth', 'billingYear', 'totalSessions',
        'chargedSessions', 'baseAmount', 'discountAmount', 'finalAmount', 'paidAmount', 'remainingAmount', 'status', 'dueDate', 'notes', 'createdAt', 'updatedAt'])
      const final = int(x.finalAmount), paid = int(x.paidAmount)
      return { id: d.document_id, studentId: x.studentId, classId: classRef(x.classId), className: str(x.className) ?? null, billingMonth: int(x.billingMonth), billingYear: int(x.billingYear),
        totalSessions: int(x.totalSessions), chargedSessions: int(x.chargedSessions), baseAmount: int(x.baseAmount), discountAmount: int(x.discountAmount),
        finalAmount: final, paidAmount: paid, remainingAmount: x.remainingAmount == null ? final - paid : int(x.remainingAmount),
        status: x.status ?? 'PENDING', dueDate: day(x.dueDate), notes: str(x.notes), createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) ?? ts(x.createdAt) }
    }), rows => tx.tuitionRecord.createMany({ data: rows }))

    const paidByRecord: Record<string, number> = {}
    await insert('payments', coll('payments').map(d => {
      const x = pick('payments', d, ['tuitionRecordId', 'studentId', 'studentName', 'classId', 'amount', 'paymentDate', 'method', 'receivedById',
        'receivedByName', 'notes', 'createdAt'])
      paidByRecord[x.tuitionRecordId] = (paidByRecord[x.tuitionRecordId] ?? 0) + int(x.amount)
      return { id: d.document_id, tuitionRecordId: x.tuitionRecordId, studentId: x.studentId, amount: int(x.amount), paymentDate: day(x.paymentDate),
        method: x.method ?? 'CASH', receivedById: optFk(users, x.receivedById, 'payments.receivedById', d.document_id),
        receivedByName: str(x.receivedByName), notes: str(x.notes), createdAt: ts(x.createdAt) }
    }), rows => tx.payment.createMany({ data: rows }))
    for (const d of coll('tuitionRecords')) {
      const x = d.data
      if (int(x.paidAmount) !== (paidByRecord[d.document_id] ?? 0)) issue('tuitionRecords.paidAmount ≠ tổng payments (nhập nguyên giá trị, cần kiểm tra)', d.document_id)
      if (int(x.paidAmount) + int(x.remainingAmount) !== int(x.finalAmount)) issue('tuitionRecords paid + remaining ≠ final (nhập nguyên giá trị, cần kiểm tra)', d.document_id)
    }

    await insert('bank_transactions', coll('bankTransactions').map(d => {
      const x = pick('bankTransactions', d, ['id', 'sepayId', 'gateway', 'accountNumber', 'transferType', 'transferAmount', 'accumulated', 'content',
        'referenceCode', 'description', 'transactionDate', 'receivedAt', 'status', 'matchedStudentId', 'matchedTuitionRecordId', 'matchedPaymentId', 'matchReason'])
      return { id: d.document_id, sepayId: BigInt(x.sepayId), gateway: x.gateway ?? '', accountNumber: x.accountNumber ?? '', transferType: x.transferType,
        transferAmount: int(x.transferAmount), accumulated: BigInt(int(x.accumulated)), content: x.content ?? '', referenceCode: x.referenceCode ?? '',
        description: x.description ?? '', transactionDate: new Date(String(x.transactionDate).replace(' ', 'T') + 'Z'), receivedAt: ts(x.receivedAt),
        status: x.status, matchedStudentId: str(x.matchedStudentId), matchedTuitionRecordId: str(x.matchedTuitionRecordId),
        matchedPaymentId: str(x.matchedPaymentId), matchReason: str(x.matchReason) }
    }), rows => tx.bankTransaction.createMany({ data: rows }))

    // Điểm của học viên đã xoá: không còn chủ → bỏ qua (có báo cáo). Phiếu học phí/thanh toán mồ côi thì để FK báo lỗi và dừng.
    await insert('monthly_scores', coll('monthlyScores').filter(d => students.has(d.data.studentId) || (issue('monthlyScores của học viên đã xoá → bỏ qua', d.document_id), false)).map(d => {
      const x = pick('monthlyScores', d, ['studentId', 'studentName', 'classId', 'className', 'year', 'month', 'expectedCount', 'scores', 'maxScore',
        'notes', 'updatedAt', 'updatedBy'])
      return { id: d.document_id, studentId: x.studentId, classId: classRef(x.classId), className: x.className ?? '', year: int(x.year), month: int(x.month),
        expectedCount: int(x.expectedCount), scores: x.scores ?? [], maxScore: int(x.maxScore, 10), notes: str(x.notes), updatedAt: ts(x.updatedAt),
        updatedBy: x.updatedBy ?? '' }
    }), rows => tx.monthlyScore.createMany({ data: rows }))

    await insert('materials', coll('materials').map(d => {
      const x = pick('materials', d, ['title', 'description', 'type', 'url', 'cloudinaryPublicId', 'cloudinaryResourceType', 'fileName', 'fileSize',
        'mimeType', 'audienceType', 'audienceIds', 'uploaderId', 'uploaderName', 'createdAt', 'updatedAt'])
      return { id: d.document_id, title: x.title, description: str(x.description), type: x.type, url: str(x.url), cloudinaryPublicId: str(x.cloudinaryPublicId),
        cloudinaryResourceType: str(x.cloudinaryResourceType), fileName: str(x.fileName), fileSize: x.fileSize ?? null, mimeType: str(x.mimeType),
        audienceType: x.audienceType, audienceIds: x.audienceIds ?? [], uploaderId: optFk(users, x.uploaderId, 'materials.uploaderId', d.document_id),
        createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) ?? ts(x.createdAt) }
    }), rows => tx.material.createMany({ data: rows }))

    await insert('misa_invoices', coll('misaInvoices').map(d => {
      const x = pick('misaInvoices', d, ['id', 'refId', 'status', 'revision', 'invoiceDate', 'invoiceNumber', 'invoiceCode', 'transactionId',
        'invoiceUrl', 'lastErrorMessage', 'recordIds', 'billingPeriods', 'source', 'sources', 'template', 'buyer', 'restoredAt', 'createdBy', 'createdAt', 'updatedAt'])
      return { id: d.document_id, refId: x.refId, status: x.status, revision: int(x.revision), invoiceDate: day(x.invoiceDate),
        invoiceNumber: str(x.invoiceNumber), invoiceCode: str(x.invoiceCode), transactionId: str(x.transactionId), invoiceUrl: str(x.invoiceUrl),
        lastErrorMessage: str(x.lastErrorMessage),
        recordIds: x.recordIds ?? [], billingPeriods: x.billingPeriods ?? [], source: json(x.source), sources: json(x.sources), template: json(x.template),
        buyer: json(x.buyer), restoredAt: ts(x.restoredAt), createdBy: x.createdBy ?? '', createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) ?? ts(x.createdAt) }
    }), rows => tx.misaInvoice.createMany({ data: rows }))

    await insert('misa_invoice_replacements', coll('misaInvoiceReplacements').map(d => {
      const x = pick('misaInvoiceReplacements', d, ['recordId', 'reason', 'requestedBy', 'replacedAt', 'originalInvoice', 'originalFee'])
      return { id: d.document_id, recordId: x.recordId, reason: x.reason ?? '', requestedBy: x.requestedBy ?? '', replacedAt: ts(x.replacedAt),
        originalInvoice: json(x.originalInvoice), originalFee: json(x.originalFee) }
    }), rows => tx.misaInvoiceReplacement.createMany({ data: rows }))

    await insert('invoice_drafts', coll('invoiceDrafts').map(d => {
      const x = pick('invoiceDrafts', d, ['id', 'refId', 'status', 'revision', 'invoiceDate', 'source', 'template', 'buyer', 'provider', 'syncAttempts',
        'lastErrorCode', 'lastErrorMessage', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt'])
      return { id: d.document_id, refId: x.refId, status: x.status, revision: int(x.revision), invoiceDate: day(x.invoiceDate), source: json(x.source),
        template: json(x.template), buyer: json(x.buyer), provider: str(x.provider), syncAttempts: x.syncAttempts ?? null, lastErrorCode: str(x.lastErrorCode),
        lastErrorMessage: str(x.lastErrorMessage), createdBy: x.createdBy ?? '', updatedBy: str(x.updatedBy), createdAt: ts(x.createdAt),
        updatedAt: ts(x.updatedAt) ?? ts(x.createdAt) }
    }), rows => tx.invoiceDraft.createMany({ data: rows }))

    await insert('invoice_outbox', coll('invoiceOutbox').map(d => {
      const x = pick('invoiceOutbox', d, ['draftId', 'tuitionRecordId', 'operation', 'status', 'revision', 'attempts', 'idempotencyKey', 'leaseToken',
        'leaseUntil', 'nextRetryAt', 'createdAt', 'updatedAt'])
      return { id: d.document_id, draftId: x.draftId, tuitionRecordId: x.tuitionRecordId, operation: x.operation, status: x.status, revision: int(x.revision),
        attempts: int(x.attempts), idempotencyKey: x.idempotencyKey, leaseToken: str(x.leaseToken), leaseUntil: ts(x.leaseUntil), nextRetryAt: ts(x.nextRetryAt),
        createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) ?? ts(x.createdAt) }
    }), rows => tx.invoiceOutbox.createMany({ data: rows }))

    const runItems: any[] = []
    await insert('monthly_invoice_runs', coll('monthlyInvoiceRuns').map(d => {
      const { status, leaseToken, leaseUntil, ...data } = d.data
      for (const item of coll('*/items').filter(i => i.path.startsWith(d.path + '/')))
        runItems.push({ runId: d.document_id, id: item.document_id, status: item.data.status ?? '', data: item.data })
      return { id: d.document_id, status: status ?? '', leaseToken: str(leaseToken) ?? '', leaseUntil: BigInt(int(leaseUntil)), data }
    }), rows => tx.monthlyInvoiceRun.createMany({ data: rows }))
    await insert('monthly_invoice_run_items', runItems, rows => tx.monthlyInvoiceRunItem.createMany({ data: rows }))

    await insert('zns_templates', coll('znsTemplates').map(d => {
      const x = pick('znsTemplates', d, ['name', 'useCase', 'paramKeys', 'cost', 'active', 'note', 'createdAt', 'updatedAt'])
      return { id: d.document_id, name: x.name, useCase: x.useCase, paramKeys: x.paramKeys ?? [], cost: int(x.cost), active: x.active !== false,
        note: str(x.note), createdAt: ts(x.createdAt), updatedAt: ts(x.updatedAt) }
    }), rows => tx.znsTemplate.createMany({ data: rows }))

    await insert('zns_logs', coll('znsLogs').map(d => {
      const x = pick('znsLogs', d, ['studentId', 'parentPhone', 'parentPhoneIntl', 'templateId', 'useCase', 'invoiceId', 'reminderCount', 'params',
        'trackingId', 'status', 'msgId', 'error', 'createdAt', 'sentAt', 'deliveredAt'])
      return { id: d.document_id, studentId: str(x.studentId), parentPhone: x.parentPhone ?? '', parentPhoneIntl: x.parentPhoneIntl ?? '',
        templateId: x.templateId, useCase: x.useCase, invoiceId: str(x.invoiceId), reminderCount: x.reminderCount ?? null, params: x.params ?? {},
        trackingId: str(x.trackingId), status: x.status, msgId: str(x.msgId), error: str(x.error), createdAt: ts(x.createdAt), sentAt: ts(x.sentAt),
        deliveredAt: ts(x.deliveredAt) }
    }), rows => tx.znsLog.createMany({ data: rows }))

    await insert('admin_alerts', coll('adminAlerts').map(d => {
      const { type, read, message, createdAt, ...data } = d.data
      return { id: d.document_id, type, read: !!read, message: message ?? '', data, createdAt: ts(createdAt) }
    }), rows => tx.adminAlert.createMany({ data: rows }))

    await insert('notifications', coll('notifications').map(d => {
      const x = pick('notifications', d, ['title', 'content', 'type', 'targetType', 'targetId', 'sendViaZalo', 'zaloQueued', 'zaloSentCount',
        'zaloTotalTargets', 'sentAt', 'createdById', 'createdAt'])
      return { id: d.document_id, title: x.title, content: x.content, type: x.type, targetType: x.targetType, targetId: str(x.targetId),
        sendViaZalo: !!x.sendViaZalo, zaloQueued: !!x.zaloQueued, zaloSentCount: x.zaloSentCount ?? null, zaloTotalTargets: x.zaloTotalTargets ?? null,
        sentAt: ts(x.sentAt), createdById: str(x.createdById), createdAt: ts(x.createdAt) }
    }), rows => tx.notification.createMany({ data: rows }))

    // Lead: chatbot Zalo (camelCase) và cổng CTV cũ (snake_case).
    await insert('leads', coll('leads').map(d => {
      const x = pick('leads', d, ['zaloUserId', 'parentName', 'studentName', 'gradeLevel', 'phone', 'status', 'chatStep', 'note', 'source', 'createdAt',
        'updatedAt', 'collaborator_id', 'parent_name', 'parent_phone', 'student_name', 'created_at', 'updated_at'])
      const ctv = 'collaborator_id' in x || 'parent_name' in x
      const created = ts(x.createdAt) ?? ts(x.created_at)
      return { id: d.document_id, source: str(x.source) ?? (ctv ? 'ctv' : 'zalo'), zaloUserId: str(x.zaloUserId) || null, collaboratorId: str(x.collaborator_id),
        parentName: str(x.parentName) ?? str(x.parent_name), phone: str(x.phone) ?? str(x.parent_phone),
        studentName: str(x.studentName) ?? str(x.student_name), gradeLevel: str(x.gradeLevel), status: x.status ?? 'NEW', chatStep: int(x.chatStep),
        note: str(x.note), createdAt: created, updatedAt: ts(x.updatedAt) ?? ts(x.updated_at) ?? created }
    }), rows => tx.lead.createMany({ data: rows }))

    await insert('activity_logs', coll('activityLogs').map(d => {
      const x = pick('activityLogs', d, ['userId', 'userName', 'userRole', 'action', 'resourceType', 'resourceId', 'description', 'method', 'path',
        'statusCode', 'ip', 'before', 'after', 'createdAt'])
      return { id: d.document_id, userId: x.userId ?? '', userName: x.userName ?? '', userRole: x.userRole ?? '', action: x.action,
        resourceType: x.resourceType ?? '', resourceId: str(x.resourceId), description: x.description ?? '', method: x.method ?? '', path: x.path ?? '',
        statusCode: int(x.statusCode), ip: str(x.ip) ?? null, before: json(x.before), after: json(x.after), createdAt: ts(x.createdAt) }
    }), rows => tx.activityLog.createMany({ data: rows }))

    await insert('class_integrity_audits', coll('classIntegrityAudits').map(d => {
      const x = pick('classIntegrityAudits', d, ['period', 'checkedClasses', 'checkedRows', 'anomalies', 'createdAt'])
      return { id: d.document_id, period: x.period, checkedClasses: int(x.checkedClasses), checkedRows: int(x.checkedRows),
        anomalies: x.anomalies ?? [], createdAt: ts(x.createdAt) }
    }), rows => tx.classIntegrityAudit.createMany({ data: rows }))
  }, { timeout: 120_000 })

  // ─── Báo cáo ───────────────────────────────────────────────
  const skipped = ['readViews', 'readViewRevisions', 'aggregates', '__supabaseSyncQueue', 'profiles', 'admin_activity_logs']
  const handled = new Set(['users', 'teachers', 'subjects', 'students', '*/parents', '*/reviews', 'promotions', 'classes', 'classEnrollments',
    'schedules', 'sessions', 'privateSchedules', 'holidays', 'studentAttendances', 'teacherAttendances', 'studentPromotions', 'tuitionRecords',
    'payments', 'bankTransactions', 'monthlyScores', 'materials', 'misaInvoices', 'misaInvoiceReplacements', 'invoiceDrafts', 'invoiceOutbox',
    'monthlyInvoiceRuns', '*/items', 'znsTemplates', 'znsLogs', 'adminAlerts', 'notifications', 'leads', 'activityLogs', 'classIntegrityAudits', ...skipped])
  const unknown = [...byCollection.keys()].filter(k => !handled.has(k))

  console.log('\n== Số dòng đã nhập')
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(28)} ${n}`)
  console.log('\n== Không nhập (cache / dữ liệu ứng dụng khác)')
  for (const s of skipped) console.log(`  ${s.padEnd(28)} ${coll(s).length}`)
  if (unknown.length) console.log('\n!! Collection chưa được xử lý:', unknown.map(k => `${k} (${coll(k).length})`).join(', '))
  console.log('\n== Bất thường đã xử lý')
  for (const [k, list] of Object.entries(issues)) console.log(`  ${list.length.toString().padStart(4)}  ${k}${list.length <= 5 ? '  [' + list.join(', ') + ']' : ''}`)
  console.log('\n== Trường không được ánh xạ (bỏ qua)')
  for (const [k, set] of Object.entries(unmapped)) console.log(`  ${k}: ${[...set].join(', ')}`)
  if (!Object.keys(unmapped).length) console.log('  (không có)')
}

main().finally(() => prisma.$disconnect())
