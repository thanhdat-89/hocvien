// =============================================================
// SePay matching helpers
// Parse webhook content → find target student & tuition record.
// =============================================================

import { prisma } from '../lib/db'
import { tuitionRecordDoc, tuitionRecordInclude } from '../lib/docs'
import type { TuitionRecord } from '../types/models'

export interface ParsedNote {
  /** Ứng viên ưu tiên nhất (candidates[0]). */
  shortId: string
  /** Mọi từ 5–6 ký tự A–Z0–9, theo thứ tự ưu tiên: ngay sau T<tháng>, rồi từ cuối chuỗi lên. */
  candidates: string[]
  month: number
  rawName: string
}

/**
 * Parse nội dung CK. Format kỳ vọng: "HP <tên không dấu> T<tháng> <SHORTID>".
 * Cũng chấp nhận các biến thể: thiếu phần tên, hoặc thiếu chữ HP đầu.
 * Trả về null nếu không tìm thấy cả month + shortId.
 *
 * Tên không dấu cũng có thể là từ 5–6 chữ cái (NGUYEN, PHUONG, THANH...), nên không lấy từ đầu tiên
 * làm mã: trả về mọi ứng viên để findStudentByCandidates chọn ứng viên khớp đúng mã học viên.
 */
export function parseTransferNote(raw: string): ParsedNote | null {
  if (!raw) return null
  const text = raw.toUpperCase().replace(/\s+/g, ' ').trim()

  // Bắt T<tháng>: 1-2 chữ số sau ký tự T.
  const monthMatch = text.match(/T(\d{1,2})(?:\s|$)/)
  const month = monthMatch ? Number(monthMatch[1]) : 0
  if (!month || month < 1 || month > 12) return null

  // Ứng viên SHORTID: 5–6 ký tự A–Z0–9 (ngân hàng có thể chèn dấu chấm, gạch... quanh nội dung).
  const tokens = text.split(/[^A-Z0-9]+/).filter(Boolean)
  const isCandidate = (token: string) => /^[A-Z0-9]{5,6}$/.test(token)
  const monthIndex = tokens.indexOf(`T${monthMatch![1]}`)
  const afterMonth = monthIndex >= 0 && isCandidate(tokens[monthIndex + 1] ?? '') ? [tokens[monthIndex + 1]] : []
  const candidates = [...new Set([...afterMonth, ...tokens.filter(isCandidate).reverse()])]
  if (!candidates.length) return null

  // Tên (best-effort): phần giữa "HP" và "T<m>"
  const nameMatch = text.match(/HP\s+(.+?)\s+T\d{1,2}\s/)
  const rawName = nameMatch ? nameMatch[1].trim() : ''

  return { shortId: candidates[0], candidates, month, rawName }
}

/**
 * Sinh shortId từ studentId. Phải khớp với hàm studentShortId ở routes/public.ts.
 */
export function studentShortId(studentId: string): string {
  return (studentId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 5).toUpperCase()
}

/** Quét tối đa LIMIT học viên — đủ cho quy mô trung tâm < vài nghìn HV. */
const STUDENT_SCAN_LIMIT = 5000

/**
 * Chọn ứng viên đầu tiên (theo thứ tự ưu tiên) khớp mã của ít nhất một học viên — đọc danh sách học viên một lần.
 * Trả về shortId đã chọn (hoặc ứng viên ưu tiên nhất nếu không khớp ai) và các học viên khớp.
 */
export async function findStudentByCandidates(candidates: string[]): Promise<{ shortId: string; students: { id: string; fullName: string }[] }> {
  if (!candidates.length) return { shortId: '', students: [] }
  const all = await prisma.student.findMany({ select: { id: true, fullName: true }, take: STUDENT_SCAN_LIMIT })
  for (const candidate of candidates) {
    const students = all.filter(s => studentShortId(s.id) === candidate.toUpperCase())
    if (students.length) return { shortId: candidate, students }
  }
  return { shortId: candidates[0], students: [] }
}

/**
 * Tìm tuitionRecords của 1 student trong tháng cho trước (theo billingMonth).
 * Không filter theo year để tránh sai lệch khi CK đầu tháng sau cho học phí tháng trước —
 * caller dùng transactionDate để chọn year hợp lý.
 */
export async function findTuitionRecords(
  studentId: string,
  month: number,
  year: number,
): Promise<TuitionRecord[]> {
  const records = await prisma.tuitionRecord.findMany({ where: { studentId, billingMonth: month, billingYear: year }, include: tuitionRecordInclude })
  return records.map(tuitionRecordDoc)
}
