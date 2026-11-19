import * as XLSX from 'xlsx'

/**
 * Đọc file Excel lịch học riêng — mỗi dòng là một mẫu lặp theo thứ trong tuần.
 * Chuẩn hoá giá trị (thứ, tháng, giờ, học phí) để server kiểm tra lại; giá trị không đọc được giữ nguyên chuỗi
 * để server báo lỗi đúng dòng.
 */

export interface PrivateImportRow {
  row: number // số dòng trong Excel (dòng tiêu đề = 1)
  studentName: string
  gradeLevel: string
  weekdays: number[] // JS getDay(): 0 = CN … 6 = T7
  weekdaysRaw: string
  fromMonth: string // YYYY-MM hoặc chuỗi gốc nếu không đọc được
  toMonth: string
  startTime: string // HH:MM hoặc chuỗi gốc
  endTime: string
  teacherName: string
  ratePerSession: number | string
  notes: string
}

export const TEMPLATE_HEADERS = [
  'Họ tên học viên *', 'Khối lớp *', 'Thứ học *', 'Từ tháng *', 'Đến tháng',
  'Giờ bắt đầu', 'Giờ kết thúc', 'Giáo viên', 'Học phí/buổi *', 'Ghi chú',
]

type Field = Exclude<keyof PrivateImportRow, 'row' | 'weekdays' | 'weekdaysRaw'> | 'weekdays'

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
const headerKey = (h: string) => stripAccents(h).toLowerCase().replace(/\(.*?\)|\*/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

const HEADER_MAP: Record<string, Field> = {
  'ho ten hoc vien': 'studentName', 'ho ten': 'studentName', 'hoc vien': 'studentName', 'ten hoc vien': 'studentName', 'ho va ten': 'studentName',
  'khoi lop': 'gradeLevel', 'khoi': 'gradeLevel', 'lop': 'gradeLevel',
  'thu hoc': 'weekdays', 'thu': 'weekdays', 'cac thu': 'weekdays', 'ngay hoc': 'weekdays',
  'tu thang': 'fromMonth', 'thang bat dau': 'fromMonth', 'thang': 'fromMonth',
  'den thang': 'toMonth', 'thang ket thuc': 'toMonth',
  'gio bat dau': 'startTime', 'bat dau': 'startTime', 'gio vao': 'startTime',
  'gio ket thuc': 'endTime', 'ket thuc': 'endTime', 'gio ra': 'endTime',
  'giao vien': 'teacherName', 'gv': 'teacherName',
  'hoc phi buoi': 'ratePerSession', 'hoc phi moi buoi': 'ratePerSession', 'hoc phi': 'ratePerSession', 'don gia': 'ratePerSession',
  'ghi chu': 'notes',
}

/** "T2, T5", "2,5", "Thứ 2 + Thứ 6", "CN" → [1, 4] … (JS getDay) */
export function parseWeekdays(value: unknown): number[] {
  if (typeof value === 'number') return value >= 2 && value <= 7 ? [value - 1] : value === 8 ? [0] : []
  const s = stripAccents(String(value ?? '')).toUpperCase()
  const out = new Set<number>()
  if (/\bCN\b|CHU ?NHAT/.test(s)) out.add(0)
  for (const m of s.replace(/CHU ?NHAT|\bCN\b/g, ' ').matchAll(/(?:THU|T)?\s*([2-8])/g)) {
    const n = Number(m[1])
    out.add(n === 8 ? 0 : n - 1)
  }
  return [...out].sort((a, b) => (a || 7) - (b || 7))
}

/** 11/2026, 11-2026, 2026-11, "Tháng 11/2026", 1/11/2026, ô ngày Excel → "2026-11" */
export function parseMonth(value: unknown): string {
  if (value === '' || value == null) return ''
  if (typeof value === 'number') {
    if (value > 59) { const d = XLSX.SSF.parse_date_code(value); if (d) return `${d.y}-${String(d.m).padStart(2, '0')}` }
    return String(value)
  }
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`
  const s = stripAccents(String(value)).toLowerCase().replace(/thang|t(?=\d)/g, ' ').trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})$/)
  if (m) return fmtMonth(Number(m[1]), Number(m[2]), String(value))
  m = s.match(/^(\d{1,2})[-/.\s]+(\d{4})$/)
  if (m) return fmtMonth(Number(m[2]), Number(m[1]), String(value))
  m = s.match(/^\d{1,2}[-/.](\d{1,2})[-/.](\d{4})$/) // dd/mm/yyyy
  if (m) return fmtMonth(Number(m[2]), Number(m[1]), String(value))
  return String(value).trim()
}
const fmtMonth = (y: number, m: number, raw: string) => (m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, '0')}` : raw.trim())

/** 0.75, "18:00", "18h", "18h30", "6:30 PM", "18:00:00" → "18:00" */
export function parseTime(value: unknown): string {
  if (value === '' || value == null) return ''
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const mins = Math.round(value * 24 * 60)
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
  }
  const s = String(value).trim().toLowerCase()
  const m = s.match(/^(\d{1,2})\s*(?:[:h]\s*(\d{1,2})?)?(?::\d{1,2})?\s*(am|pm|sa|ch)?$/)
  if (!m) return String(value).trim()
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if ((m[3] === 'pm' || m[3] === 'ch') && h < 12) h += 12
  if ((m[3] === 'am' || m[3] === 'sa') && h === 12) h = 0
  if (h > 23 || min > 59) return String(value).trim()
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** 200000, "200.000", "200,000đ", "200k" → 200000 */
export function parseMoney(value: unknown): number | string {
  if (typeof value === 'number') return Math.round(value)
  const s = String(value ?? '').trim().toLowerCase()
  if (!s) return ''
  const k = s.match(/^(\d+(?:[.,]\d+)?)\s*k$/)
  if (k) return Math.round(Number(k[1].replace(',', '.')) * 1000)
  const digits = s.replace(/[^\d]/g, '')
  return digits ? Number(digits) : s
}

export function parsePrivateScheduleSheet(ws: XLSX.WorkSheet): PrivateImportRow[] {
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
  // Dòng tiêu đề: dòng đầu tiên có cột "Họ tên"
  const headerIdx = aoa.findIndex(r => r.some(c => HEADER_MAP[headerKey(String(c))] === 'studentName'))
  if (headerIdx < 0) return []
  const fields = aoa[headerIdx].map(c => HEADER_MAP[headerKey(String(c))])
  const rows: PrivateImportRow[] = []
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const cells = aoa[i]
    const get = (f: Field) => { const idx = fields.indexOf(f); return idx < 0 ? '' : cells[idx] }
    if (cells.every(c => String(c ?? '').trim() === '')) continue
    const weekdaysRaw = get('weekdays')
    const fromMonth = parseMonth(get('fromMonth'))
    rows.push({
      row: i + 1,
      studentName: String(get('studentName') ?? '').trim(),
      gradeLevel: String(get('gradeLevel') ?? '').trim(),
      weekdays: parseWeekdays(weekdaysRaw),
      weekdaysRaw: String(weekdaysRaw ?? '').trim(),
      fromMonth,
      toMonth: parseMonth(get('toMonth')) || fromMonth,
      startTime: parseTime(get('startTime')),
      endTime: parseTime(get('endTime')),
      teacherName: String(get('teacherName') ?? '').trim(),
      ratePerSession: parseMoney(get('ratePerSession')),
      notes: String(get('notes') ?? '').trim(),
    })
  }
  return rows
}

export async function readPrivateScheduleFile(file: File): Promise<PrivateImportRow[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  // Ưu tiên sheet có tiêu đề hợp lệ (file mẫu có thêm sheet hướng dẫn / danh sách)
  for (const name of wb.SheetNames) {
    const rows = parsePrivateScheduleSheet(wb.Sheets[name])
    if (rows.length) return rows
  }
  return []
}

export function downloadPrivateScheduleTemplate(
  students: { fullName: string; gradeLevel?: number | null }[],
  teachers: string[],
  month: string, // YYYY-MM
) {
  const mm = `${month.slice(5)}/${month.slice(0, 4)}`
  const body = students.length
    ? students.map(s => [s.fullName, s.gradeLevel ?? '', '', mm, mm, '', '', '', '', ''])
    : [['Nguyễn Văn A', 6, 'T2, T5', mm, mm, '18:00', '19:30', teachers[0] ?? '', 200000, '']]
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...body])
  ws['!cols'] = [{ wch: 26 }, { wch: 9 }, { wch: 14 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 20 }]
  const guide = XLSX.utils.aoa_to_sheet([
    ['Hướng dẫn nhập lịch học riêng'],
    [],
    ['Cột', 'Cách nhập', 'Ví dụ'],
    ['Họ tên học viên *', 'Đúng họ tên trong hệ thống', 'Song Lam'],
    ['Khối lớp *', 'Số khối 1–12, dùng để phân biệt học viên trùng tên', '6'],
    ['Thứ học *', 'Các thứ trong tuần, cách nhau dấu phẩy. Chủ nhật ghi CN', 'T2, T5 hoặc 2,5 hoặc T7, CN'],
    ['Từ tháng *', 'Tháng/năm bắt đầu', mm],
    ['Đến tháng', 'Bỏ trống = chỉ xếp trong "Từ tháng". Tối đa 12 tháng', mm],
    ['Giờ bắt đầu / kết thúc', 'Giờ:phút', '18:00 — 19:30'],
    ['Giáo viên', 'Tên giáo viên (tuỳ chọn)', teachers[0] ?? ''],
    ['Học phí/buổi *', 'Số tiền mỗi buổi', '200000'],
    [],
    ['Lưu ý', 'Hệ thống sinh 1 buổi cho mỗi thứ đã chọn trong khoảng tháng. Ngày trùng lịch riêng đã có sẽ báo lỗi; tháng đã có phiếu thu học phí học riêng không thể import.'],
  ])
  guide['!cols'] = [{ wch: 22 }, { wch: 60 }, { wch: 28 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Lịch học riêng')
  XLSX.utils.book_append_sheet(wb, guide, 'Hướng dẫn')
  if (teachers.length) {
    const ts = XLSX.utils.aoa_to_sheet([['Giáo viên'], ...teachers.map(t => [t])])
    ts['!cols'] = [{ wch: 28 }]
    XLSX.utils.book_append_sheet(wb, ts, 'Giáo viên')
  }
  XLSX.writeFile(wb, `mau-lich-hoc-rieng-${month}.xlsx`)
}
