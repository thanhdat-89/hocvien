import { prisma, newId } from '../lib/db'
import { holidayDates } from './sessionGenerator'

/**
 * Import lịch học riêng từ Excel — mỗi dòng là một mẫu lặp:
 * học viên + khối, các thứ trong tuần, từ tháng → đến tháng, giờ, giáo viên, học phí/buổi.
 * Frontend đọc file và chuẩn hoá giá trị; ở đây kiểm tra lại, sinh ngày và (khi commit) ghi trong một transaction.
 */

export interface ImportRowInput {
  row: number
  studentName?: string
  gradeLevel?: number | string | null
  /** Đã chọn khi tên trùng nhiều học viên. */
  studentId?: string
  /** JS getDay(): 0 = CN … 6 = T7 */
  weekdays?: number[]
  fromMonth?: string // YYYY-MM
  toMonth?: string   // YYYY-MM
  startTime?: string // HH:MM
  endTime?: string
  teacherName?: string
  ratePerSession?: number | string
  notes?: string
}

export interface ImportOptions {
  dryRun: boolean
  /** Xoá các buổi học riêng đã xếp trong các tháng import của học viên trước khi tạo (thay cho báo lỗi trùng). */
  replaceExisting?: boolean
  skipHolidays?: boolean
  /** Học viên đang học lớp thường mà người dùng đã xác nhận vẫn xếp lịch riêng. */
  confirmedStudentIds?: string[]
}

type Level = 'error' | 'warning'
export interface RowIssue { level: Level; code: string; message: string }

export interface RowResult {
  row: number
  status: 'ok' | 'warning' | 'error'
  studentId: string | null
  studentName: string
  gradeLevel: number | null
  candidates?: { id: string; fullName: string; gradeLevel: number | null; activeClasses: string[] }[]
  /** Lớp thường đang học — cần xác nhận lại trước khi xếp lịch riêng. */
  activeClasses?: string[]
  dates: string[]
  holidayDates: string[]
  duplicateDates: string[]
  issues: RowIssue[]
}

const MAX_ROWS = 500
const MAX_MONTHS = 12
const WD_LABEL = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

const norm = (v: unknown) => String(v ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi')
const monthRe = /^(\d{4})-(0[1-9]|1[0-2])$/
const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const monthKey = (date: string) => date.slice(0, 7)

function datesFor(weekdays: number[], fromMonth: string, toMonth: string): string[] {
  const [fy, fm] = fromMonth.split('-').map(Number)
  const [ty, tm] = toMonth.split('-').map(Number)
  const wd = new Set(weekdays)
  const out: string[] = []
  for (const cur = new Date(Date.UTC(fy, fm - 1, 1)), end = new Date(Date.UTC(ty, tm, 0)); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
    if (wd.has(cur.getUTCDay())) out.push(ymd(cur))
  }
  return out
}

const monthsBetween = (from: string, to: string) => {
  const [fy, fm] = from.split('-').map(Number), [ty, tm] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm) + 1
}

export async function importPrivateSchedule(rows: ImportRowInput[], opts: ImportOptions) {
  if (!Array.isArray(rows) || rows.length === 0) throw Object.assign(new Error('File không có dòng dữ liệu nào.'), { status: 400 })
  if (rows.length > MAX_ROWS) throw Object.assign(new Error(`Tối đa ${MAX_ROWS} dòng mỗi lần import.`), { status: 400 })

  // Nạp học viên một lần (prisma đã giới hạn theo cơ sở đang chọn).
  const students = await prisma.student.findMany({
    select: {
      id: true, fullName: true, gradeLevel: true, branchId: true,
      enrollments: { where: { status: 'ACTIVE' }, select: { class: { select: { name: true } } } },
    },
  })
  const byName = new Map<string, typeof students>()
  for (const st of students) {
    const k = norm(st.fullName)
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k)!.push(st)
  }
  const byId = new Map(students.map(st => [st.id, st]))
  const brief = (st: typeof students[number]) => ({
    id: st.id, fullName: st.fullName, gradeLevel: st.gradeLevel, activeClasses: st.enrollments.map(e => e.class.name),
  })
  const confirmed = new Set(opts.confirmedStudentIds ?? [])
  const holidayCache = new Map<string, Set<string>>()

  const results: RowResult[] = []
  for (const input of rows) {
    const issues: RowIssue[] = []
    const err = (code: string, message: string) => issues.push({ level: 'error', code, message })
    const warn = (code: string, message: string) => issues.push({ level: 'warning', code, message })
    const name = String(input.studentName ?? '').trim()
    const gradeRaw = input.gradeLevel == null || input.gradeLevel === '' ? null : Number(String(input.gradeLevel).replace(/\D/g, ''))
    const grade = gradeRaw != null && Number.isInteger(gradeRaw) && gradeRaw >= 1 && gradeRaw <= 12 ? gradeRaw : null
    const result: RowResult = {
      row: input.row, status: 'ok', studentId: null, studentName: name, gradeLevel: grade,
      dates: [], holidayDates: [], duplicateDates: [], issues,
    }
    results.push(result)

    // ── Học viên ──
    let student: typeof students[number] | undefined
    if (!name) err('NO_NAME', 'Chưa có tên học viên.')
    else if (input.gradeLevel != null && input.gradeLevel !== '' && grade == null) err('BAD_GRADE', `Khối lớp "${input.gradeLevel}" không hợp lệ.`)
    if (name && !issues.length) {
      const sameName = byName.get(norm(name)) ?? []
      const matches = grade == null ? sameName : sameName.filter(st => st.gradeLevel === grade)
      if (input.studentId) {
        student = byId.get(input.studentId)
        if (!student || !sameName.some(st => st.id === student!.id)) { student = undefined; err('BAD_PICK', 'Học viên đã chọn không khớp tên trong file.') }
      } else if (matches.length === 1) {
        student = matches[0]
      } else if (matches.length > 1) {
        result.candidates = matches.map(brief)
        err('AMBIGUOUS', `Trùng tên: có ${matches.length} học viên "${name}"${grade ? ` khối ${grade}` : ''}. Chọn đúng học viên.`)
      } else if (sameName.length) {
        result.candidates = sameName.map(brief)
        err('GRADE_MISMATCH', `Không có "${name}" ở khối ${grade}. Có ${sameName.length} học viên cùng tên ở khối khác — chọn đúng học viên.`)
      } else {
        err('NOT_FOUND', `Không tìm thấy học viên "${name}"${grade ? ` khối ${grade}` : ''}.`)
      }
      if (!grade && student) warn('NO_GRADE', 'Thiếu khối lớp — đã nhận diện theo tên, kiểm tra lại.')
    }
    if (student) {
      result.studentId = student.id
      result.studentName = student.fullName
      result.gradeLevel = student.gradeLevel
      const active = student.enrollments.map(e => e.class.name)
      if (active.length) {
        result.activeClasses = active
        if (!confirmed.has(student.id)) err('NOT_PRIVATE', `Học viên đang học lớp ${active.join(', ')} — cần xác nhận vẫn xếp lịch học riêng.`)
      }
    }

    // ── Lịch ──
    const weekdays = [...new Set((input.weekdays ?? []).map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
    if (!weekdays.length) err('NO_WEEKDAY', 'Chưa có thứ học (VD: T2, T5).')
    const from = String(input.fromMonth ?? ''), to = String(input.toMonth ?? from)
    if (!monthRe.test(from)) err('BAD_FROM', 'Từ tháng không hợp lệ (VD: 11/2026).')
    else if (!monthRe.test(to)) err('BAD_TO', 'Đến tháng không hợp lệ (VD: 12/2026).')
    else if (to < from) err('BAD_RANGE', 'Đến tháng phải sau hoặc bằng từ tháng.')
    else if (monthsBetween(from, to) > MAX_MONTHS) err('RANGE_TOO_LONG', `Tối đa ${MAX_MONTHS} tháng mỗi dòng.`)
    const startTime = String(input.startTime ?? '').trim(), endTime = String(input.endTime ?? '').trim()
    if (startTime && !timeRe.test(startTime)) err('BAD_START', `Giờ bắt đầu "${startTime}" không hợp lệ.`)
    if (endTime && !timeRe.test(endTime)) err('BAD_END', `Giờ kết thúc "${endTime}" không hợp lệ.`)
    if (timeRe.test(startTime) && timeRe.test(endTime) && endTime <= startTime) err('BAD_TIME_RANGE', 'Giờ kết thúc phải sau giờ bắt đầu.')
    const rate = Number(String(input.ratePerSession ?? '').replace(/[^\d]/g, ''))
    if (!rate) err('NO_RATE', 'Chưa có học phí mỗi buổi.')

    if (weekdays.length && monthRe.test(from) && monthRe.test(to) && to >= from && monthsBetween(from, to) <= MAX_MONTHS) {
      let dates = datesFor(weekdays, from, to)
      if (student) {
        if (!holidayCache.has(student.branchId)) holidayCache.set(student.branchId, await holidayDates(student.branchId))
        const hol = holidayCache.get(student.branchId)!
        result.holidayDates = dates.filter(d => hol.has(d))
        if (result.holidayDates.length) {
          warn('HOLIDAY', `${result.holidayDates.length} buổi rơi vào ngày nghỉ lễ${opts.skipHolidays ? ' — sẽ bỏ qua' : ''}: ${result.holidayDates.map(d => d.slice(8) + '/' + d.slice(5, 7)).join(', ')}.`)
          if (opts.skipHolidays) dates = dates.filter(d => !hol.has(d))
        }
      }
      result.dates = dates
      if (!dates.length) err('NO_DATES', `Không có ngày ${weekdays.map(d => WD_LABEL[d]).join(', ')} nào trong khoảng đã chọn.`)
    }
    // Giữ lại để sinh buổi
    ;(result as any)._sess = { from, to, startTime: startTime || null, endTime: endTime || null, rate,
      teacherName: String(input.teacherName ?? '').trim() || null, notes: String(input.notes ?? '').trim() || null }
  }

  // ── Kiểm tra theo học viên: trùng trong file, trùng buổi đã có, tháng đã có phiếu thu ──
  const withStudent = results.filter(r => r.studentId && r.dates.length)
  const studentIds = [...new Set(withStudent.map(r => r.studentId!))]
  if (studentIds.length) {
    const allDates = withStudent.flatMap(r => r.dates).sort()
    const minDate = new Date(allDates[0] + 'T00:00:00Z'), maxDate = new Date(allDates[allDates.length - 1] + 'T00:00:00Z')
    const existing = await prisma.privateSession.findMany({
      where: { studentId: { in: studentIds }, sessionDate: { gte: minDate, lte: maxDate } },
      select: { studentId: true, sessionDate: true },
    })
    const existingKeys = new Set(existing.map(e => `${e.studentId}|${ymd(e.sessionDate)}`))
    const months = [...new Set(allDates.map(monthKey))]
    const paid = await prisma.tuitionRecord.findMany({
      where: {
        studentId: { in: studentIds }, classId: null,
        OR: months.map(m => ({ billingYear: Number(m.slice(0, 4)), billingMonth: Number(m.slice(5)) })),
        AND: [{ OR: [{ paidAmount: { gt: 0 } }, { payments: { some: {} } }] }],
      },
      select: { studentId: true, billingYear: true, billingMonth: true },
    })
    const paidKeys = new Set(paid.map(p => `${p.studentId}|${p.billingYear}-${String(p.billingMonth).padStart(2, '0')}`))

    const seenInFile = new Map<string, number>() // studentId|date → row
    for (const r of withStudent) {
      const blocked = [...new Set(r.dates.map(monthKey))].filter(m => paidKeys.has(`${r.studentId}|${m}`))
      if (blocked.length) {
        r.issues.push({ level: 'error', code: 'PAID_MONTH', message: `Tháng ${blocked.map(m => `${m.slice(5)}/${m.slice(0, 4)}`).join(', ')} đã có phiếu thu học phí học riêng — không thể thêm lịch.` })
      }
      r.duplicateDates = r.dates.filter(d => existingKeys.has(`${r.studentId}|${d}`))
      if (r.duplicateDates.length && !opts.replaceExisting) {
        r.issues.push({ level: 'error', code: 'DUPLICATE', message: `Trùng ${r.duplicateDates.length} buổi đã xếp lịch riêng trước đó. Chọn "Xoá lịch riêng đã xếp" để thay thế.` })
      } else if (r.duplicateDates.length) {
        r.issues.push({ level: 'warning', code: 'REPLACE', message: `Sẽ xoá các buổi học riêng đã xếp trong tháng ${[...new Set(r.dates.map(monthKey))].map(m => `${m.slice(5)}/${m.slice(0, 4)}`).join(', ')} rồi xếp lại.` })
      }
      const clash = r.dates.filter(d => seenInFile.has(`${r.studentId}|${d}`))
      if (clash.length) {
        r.issues.push({ level: 'error', code: 'DUPLICATE_IN_FILE', message: `Trùng ${clash.length} buổi với dòng ${seenInFile.get(`${r.studentId}|${clash[0]}`)} trong file.` })
      }
      r.dates.forEach(d => { if (!seenInFile.has(`${r.studentId}|${d}`)) seenInFile.set(`${r.studentId}|${d}`, r.row) })
    }
  }

  for (const r of results) r.status = r.issues.some(i => i.level === 'error') ? 'error' : r.issues.length ? 'warning' : 'ok'
  const valid = results.filter(r => r.status !== 'error')
  const summary = {
    total: results.length, valid: valid.length, errors: results.length - valid.length,
    sessions: valid.reduce((n, r) => n + r.dates.length, 0),
  }
  const strip = (r: RowResult) => { const { _sess, ...rest } = r as any; return rest as RowResult }

  if (opts.dryRun || !valid.length) return { dryRun: true, summary, rows: results.map(strip), created: 0, deleted: 0 }

  // ── Ghi: xoá lịch cũ (nếu chọn thay thế) rồi tạo buổi mới, tất cả trong một transaction ──
  const deleteWhere = opts.replaceExisting
    ? valid.filter(r => r.duplicateDates.length).map(r => {
        const { from, to } = (r as any)._sess
        const [ty, tm] = to.split('-').map(Number)
        return { studentId: r.studentId!, sessionDate: { gte: new Date(from + '-01T00:00:00Z'), lte: new Date(Date.UTC(ty, tm, 0)) } }
      })
    : []
  const data = valid.flatMap(r => {
    const sess = (r as any)._sess
    return r.dates.map(d => ({
      id: newId(), studentId: r.studentId!, sessionDate: new Date(d + 'T00:00:00Z'),
      startTime: sess.startTime, endTime: sess.endTime, teacherName: sess.teacherName,
      ratePerSession: sess.rate, status: 'SCHEDULED' as const, notes: sess.notes,
    }))
  })
  const [deleted, created] = await prisma.$transaction([
    prisma.privateSession.deleteMany({ where: deleteWhere.length ? { OR: deleteWhere } : { id: { in: [] } } }),
    prisma.privateSession.createMany({ data }),
  ])
  return { dryRun: false, summary, rows: results.map(strip), created: created.count, deleted: deleted.count }
}
