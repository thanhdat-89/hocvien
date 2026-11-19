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
  month: number | string // 1–12, hoặc chuỗi gốc nếu không đọc được để server báo lỗi
  year: number | string
  /** Ngày học viên nghỉ trong tháng (số ngày); chuỗi gốc giữ ở absentRaw */
  absentDays: (number | string)[]
  absentRaw: string
  ratePerSession: number | string
  notes: string
}

export const TEMPLATE_HEADERS = [
  'Họ tên học viên *', 'Khối lớp *', 'Thứ học *', 'Tháng *', 'Năm *', 'Ngày nghỉ', 'Học phí/buổi *', 'Ghi chú',
]

type Field = 'studentName' | 'gradeLevel' | 'weekdays' | 'month' | 'year' | 'absentDays' | 'ratePerSession' | 'notes' | 'legacy'

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
const headerKey = (h: string) => stripAccents(h).toLowerCase().replace(/\(.*?\)|\*/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

const HEADER_MAP: Record<string, Field> = {
  'ho ten hoc vien': 'studentName', 'ho ten': 'studentName', 'hoc vien': 'studentName', 'ten hoc vien': 'studentName', 'ho va ten': 'studentName',
  'khoi lop': 'gradeLevel', 'khoi': 'gradeLevel', 'lop': 'gradeLevel',
  'thu hoc': 'weekdays', 'thu': 'weekdays', 'cac thu': 'weekdays',
  'thang': 'month', 'nam': 'year',
  'ngay nghi': 'absentDays', 'nghi': 'absentDays', 'ngay hv nghi': 'absentDays',
  'hoc phi buoi': 'ratePerSession', 'hoc phi moi buoi': 'ratePerSession', 'hoc phi': 'ratePerSession', 'don gia': 'ratePerSession',
  'ghi chu': 'notes',
  // Cột của mẫu cũ — gặp thì yêu cầu tải mẫu mới
  'tu thang': 'legacy', 'den thang': 'legacy', 'gio bat dau': 'legacy', 'gio ket thuc': 'legacy', 'giao vien': 'legacy',
}

export class LegacyTemplateError extends Error {
  constructor() { super('File theo mẫu cũ (có cột Từ tháng / Giờ / Giáo viên). Vui lòng tải file mẫu mới.') }
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

/** Ô chỉ chứa đúng một số nguyên (11, "11", " 2026 "); ngược lại giữ chuỗi gốc để server báo lỗi */
export function parseWhole(value: unknown): number | string {
  if (typeof value === 'number') return Number.isInteger(value) ? value : String(value)
  const s = String(value ?? '').trim()
  return /^\d+$/.test(s) ? Number(s) : s
}

/** "23, 27", "23;27", "23 27", 23 → [23, 27]; phần không phải số giữ nguyên để server báo lỗi */
export function parseAbsentDays(value: unknown): (number | string)[] {
  if (typeof value === 'number') return [Number.isInteger(value) ? value : String(value)]
  return String(value ?? '').split(/[,;\s]+/).map(t => t.trim()).filter(Boolean).map(t => (/^\d+$/.test(t) ? Number(t) : t))
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
  if (fields.includes('legacy')) throw new LegacyTemplateError()
  const rows: PrivateImportRow[] = []
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const cells = aoa[i]
    const get = (f: Field) => { const idx = fields.indexOf(f); return idx < 0 ? '' : cells[idx] }
    if (cells.every(c => String(c ?? '').trim() === '')) continue
    const weekdaysRaw = get('weekdays')
    const absent = get('absentDays')
    rows.push({
      row: i + 1,
      studentName: String(get('studentName') ?? '').trim(),
      gradeLevel: String(get('gradeLevel') ?? '').trim(),
      weekdays: parseWeekdays(weekdaysRaw),
      weekdaysRaw: String(weekdaysRaw ?? '').trim(),
      month: parseWhole(get('month')),
      year: parseWhole(get('year')),
      absentDays: parseAbsentDays(absent),
      absentRaw: String(absent ?? '').trim(),
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
  month: string, // YYYY-MM
) {
  const m = Number(month.slice(5)), y = Number(month.slice(0, 4))
  const body = students.length
    ? students.map(s => [s.fullName, s.gradeLevel ?? '', '', m, y, '', '', ''])
    : [['Nguyễn Văn A', 6, 'T2, T5', m, y, '23, 27', 200000, '']]
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...body])
  ws['!cols'] = [{ wch: 26 }, { wch: 9 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 20 }]
  const guide = XLSX.utils.aoa_to_sheet([
    ['Hướng dẫn nhập lịch học riêng'],
    [],
    ['Cột', 'Cách nhập', 'Ví dụ'],
    ['Họ tên học viên *', 'Đúng họ tên trong hệ thống', 'Song Lam'],
    ['Khối lớp *', 'Số khối 1–12, dùng để phân biệt học viên trùng tên', '6'],
    ['Thứ học *', 'Các thứ trong tuần, cách nhau dấu phẩy. Chủ nhật ghi CN', 'T2, T5 hoặc 2,5 hoặc T7, CN'],
    ['Tháng *', 'Một tháng duy nhất (1–12). Muốn xếp 2 tháng thì nhập 2 dòng', String(m)],
    ['Năm *', 'Một năm duy nhất', String(y)],
    ['Ngày nghỉ', 'Các ngày trong tháng học viên nghỉ, cách nhau dấu phẩy', '23, 27'],
    ['Học phí/buổi *', 'Số tiền mỗi buổi', '200000'],
    [],
    ['Cách tính', 'Hệ thống tạo 1 buổi cho mỗi ngày trong tháng rơi vào thứ học, trừ ngày nghỉ của học viên và ngày nghỉ lễ của trung tâm.'],
    ['Lưu ý', 'Ngày trùng lịch riêng đã có sẽ báo lỗi; tháng đã có phiếu thu học phí học riêng không thể import.'],
  ])
  guide['!cols'] = [{ wch: 22 }, { wch: 60 }, { wch: 28 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Lịch học riêng')
  XLSX.utils.book_append_sheet(wb, guide, 'Hướng dẫn')
  XLSX.writeFile(wb, `mau-lich-hoc-rieng-${month}.xlsx`)
}
