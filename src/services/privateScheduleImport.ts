import { prisma, newId } from '../lib/db'
import { holidayDates } from './sessionGenerator'

/**
 * Import lịch học riêng từ Excel — mỗi dòng là một tháng của một học viên:
 * học viên + khối, các thứ học, tháng, năm, ngày học viên nghỉ, học phí/buổi.
 * Buổi = mọi ngày trong tháng rơi vào thứ học, trừ ngày học viên nghỉ và ngày nghỉ lễ của trung tâm.
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
  month?: number | string
  year?: number | string
  /** Ngày trong tháng học viên nghỉ */
  absentDays?: (number | string)[]
  ratePerSession?: number | string
  notes?: string
}

export interface ImportOptions {
  dryRun: boolean
  /** Xoá các buổi học riêng đã xếp trong các tháng import của học viên trước khi tạo (thay cho báo lỗi trùng). */
  replaceExisting?: boolean
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
  /** Ngày học viên nghỉ đã bỏ khỏi lịch */
  absentDates: string[]
  duplicateDates: string[]
  issues: RowIssue[]
}

const MAX_ROWS = 500
const WD_LABEL = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

const norm = (v: unknown) => String(v ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi')
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const monthKey = (date: string) => date.slice(0, 7)

/** Các ngày trong tháng rơi vào thứ học */
function datesFor(weekdays: number[], year: number, month: number): string[] {
  const wd = new Set(weekdays)
  const out: string[] = []
  for (const cur = new Date(Date.UTC(year, month - 1, 1)); cur.getUTCMonth() === month - 1; cur.setUTCDate(cur.getUTCDate() + 1)) {
    if (wd.has(cur.getUTCDay())) out.push(ymd(cur))
  }
  return out
}

const isWhole = (v: unknown) => /^\d+$/.test(String(v ?? '').trim())

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
      dates: [], holidayDates: [], absentDates: [], duplicateDates: [], issues,
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
    const month = isWhole(input.month) ? Number(input.month) : NaN
    const year = isWhole(input.year) ? Number(input.year) : NaN
    const periodOk = month >= 1 && month <= 12 && year >= 2000 && year <= 2100
    if (!(month >= 1 && month <= 12)) err('BAD_MONTH', `Tháng "${input.month ?? ''}" không hợp lệ — nhập một số từ 1 đến 12.`)
    if (!(year >= 2000 && year <= 2100)) err('BAD_YEAR', `Năm "${input.year ?? ''}" không hợp lệ — nhập 4 chữ số, VD 2026.`)
    const rate = Number(String(input.ratePerSession ?? '').replace(/[^\d]/g, ''))
    if (!rate) err('NO_RATE', 'Chưa có học phí mỗi buổi.')

    // Ngày học viên nghỉ
    const absent = new Set<string>()
    if (periodOk) {
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
      const bad = (input.absentDays ?? []).filter(d => !isWhole(d) || Number(d) < 1 || Number(d) > daysInMonth)
      if (bad.length) err('BAD_ABSENT', `Ngày nghỉ "${bad.join(', ')}" không có trong tháng ${month}/${year}.`)
      for (const d of input.absentDays ?? []) {
        if (isWhole(d) && Number(d) >= 1 && Number(d) <= daysInMonth) absent.add(`${year}-${String(month).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`)
      }
    }

    if (weekdays.length && periodOk) {
      let dates = datesFor(weekdays, year, month)
      const notStudyDays = [...absent].filter(d => !dates.includes(d)).sort()
      if (notStudyDays.length) warn('ABSENT_NOT_STUDY_DAY', `Ngày nghỉ ${notStudyDays.map(d => Number(d.slice(8))).join(', ')} không rơi vào thứ học (${weekdays.map(d => WD_LABEL[d]).join(', ')}) — kiểm tra lại.`)
      result.absentDates = dates.filter(d => absent.has(d))
      dates = dates.filter(d => !absent.has(d))
      if (student) {
        if (!holidayCache.has(student.branchId)) holidayCache.set(student.branchId, await holidayDates(student.branchId))
        const hol = holidayCache.get(student.branchId)!
        result.holidayDates = dates.filter(d => hol.has(d))
        dates = dates.filter(d => !hol.has(d))
      }
      result.dates = dates
      if (!dates.length) err('NO_DATES', 'Không còn buổi nào sau khi bỏ ngày nghỉ của học viên và ngày nghỉ lễ.')
    }
    ;(result as any)._sess = { month, year, rate, notes: String(input.notes ?? '').trim() || null }
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

    const seenInFile = new Map<string, number>() // studentId|YYYY-MM → row
    for (const r of withStudent) {
      const blocked = [...new Set(r.dates.map(monthKey))].filter(m => paidKeys.has(`${r.studentId}|${m}`))
      if (blocked.length) {
        r.issues.push({ level: 'error', code: 'PAID_MONTH', message: `Tháng ${blocked.map(m => `${m.slice(5)}/${m.slice(0, 4)}`).join(', ')} đã có phiếu thu học phí học riêng — không thể thêm lịch.` })
      }
      r.duplicateDates = r.dates.filter(d => existingKeys.has(`${r.studentId}|${d}`))
      if (r.duplicateDates.length && !opts.replaceExisting) {
        r.issues.push({ level: 'error', code: 'DUPLICATE', message: `Trùng ${r.duplicateDates.length} buổi đã xếp lịch riêng trước đó. Chọn "Xoá lịch riêng đã xếp" để thay thế.` })
      } else if (r.duplicateDates.length) {
        r.issues.push({ level: 'warning', code: 'REPLACE', message: `Sẽ xoá các buổi học riêng đã xếp trong tháng ${Number(r.dates[0].slice(5, 7))}/${r.dates[0].slice(0, 4)} rồi xếp lại.` })
      }
      const key = `${r.studentId}|${monthKey(r.dates[0])}`
      if (seenInFile.has(key)) {
        r.issues.push({ level: 'error', code: 'DUPLICATE_IN_FILE', message: `Học viên đã có ở dòng ${seenInFile.get(key)} cùng tháng — mỗi học viên một dòng mỗi tháng.` })
      } else seenInFile.set(key, r.row)
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
        const { month, year } = (r as any)._sess
        return { studentId: r.studentId!, sessionDate: { gte: new Date(Date.UTC(year, month - 1, 1)), lte: new Date(Date.UTC(year, month, 0)) } }
      })
    : []
  const data = valid.flatMap(r => {
    const sess = (r as any)._sess
    return r.dates.map(d => ({
      id: newId(), studentId: r.studentId!, sessionDate: new Date(d + 'T00:00:00Z'),
      ratePerSession: sess.rate, status: 'SCHEDULED' as const, notes: sess.notes,
    }))
  })
  const [deleted, created] = await prisma.$transaction([
    prisma.privateSession.deleteMany({ where: deleteWhere.length ? { OR: deleteWhere } : { id: { in: [] } } }),
    prisma.privateSession.createMany({ data }),
  ])
  return { dryRun: false, summary, rows: results.map(strip), created: created.count, deleted: deleted.count }
}

/**
 * Gợi ý cho file mẫu: thứ học = các thứ có buổi học riêng (không tính buổi huỷ) trong tháng gần nhất có lịch,
 * học phí = học phí của buổi gần nhất có học phí. Học viên chưa có lịch sử học riêng → không có gợi ý.
 */
export async function privateScheduleSuggestions(studentIds: string[]) {
  const ids = [...new Set(studentIds)].slice(0, MAX_ROWS)
  const out: Record<string, { weekdays: number[]; ratePerSession: number | null }> = {}
  if (!ids.length) return out
  const sessions = await prisma.privateSession.findMany({
    where: { studentId: { in: ids }, status: { not: 'CANCELLED' } },
    select: { studentId: true, sessionDate: true, ratePerSession: true },
    orderBy: { sessionDate: 'desc' },
  })
  for (const s of sessions) {
    const date = ymd(s.sessionDate)
    let sug = out[s.studentId] as (typeof out)[string] & { month?: string }
    if (!sug) sug = out[s.studentId] = Object.assign({ weekdays: [], ratePerSession: null }, { month: monthKey(date) })
    if (monthKey(date) === sug.month && !sug.weekdays.includes(s.sessionDate.getUTCDay())) sug.weekdays.push(s.sessionDate.getUTCDay())
    if (sug.ratePerSession == null && s.ratePerSession > 0) sug.ratePerSession = s.ratePerSession
  }
  for (const sug of Object.values(out) as any[]) {
    delete sug.month
    sug.weekdays.sort((a: number, b: number) => (a || 7) - (b || 7))
  }
  return out
}
