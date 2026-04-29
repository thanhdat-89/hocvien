// =============================================================
// SePay matching helpers
// Parse webhook content → find target student & tuition record.
// =============================================================

import { db, C } from '../lib/firebase'
import type { Student, TuitionRecord } from '../types/models'

export interface ParsedNote {
  shortId: string
  month: number
  rawName: string
}

/**
 * Parse nội dung CK. Format kỳ vọng: "HP <tên không dấu> T<tháng> <SHORTID>".
 * Cũng chấp nhận các biến thể: thiếu phần tên, hoặc thiếu chữ HP đầu.
 * Trả về null nếu không tìm thấy cả month + shortId.
 */
export function parseTransferNote(raw: string): ParsedNote | null {
  if (!raw) return null
  const text = raw.toUpperCase().replace(/\s+/g, ' ').trim()

  // Bắt SHORTID: 5–6 ký tự A–Z0–9 đứng riêng, ưu tiên ở cuối chuỗi.
  const shortMatch = text.match(/(?:^|\s)([A-Z0-9]{5,6})(?:\s|$)/)
  if (!shortMatch) return null
  const shortId = shortMatch[1]

  // Bắt T<tháng>: 1-2 chữ số sau ký tự T.
  const monthMatch = text.match(/T(\d{1,2})(?:\s|$)/)
  const month = monthMatch ? Number(monthMatch[1]) : 0
  if (!month || month < 1 || month > 12) return null

  // Tên (best-effort): phần giữa "HP" và "T<m>"
  const nameMatch = text.match(/HP\s+(.+?)\s+T\d{1,2}\s/)
  const rawName = nameMatch ? nameMatch[1].trim() : ''

  return { shortId, month, rawName }
}

/**
 * Sinh shortId từ studentId. Phải khớp với hàm studentShortId ở routes/public.ts.
 */
export function studentShortId(studentId: string): string {
  return (studentId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 5).toUpperCase()
}

/**
 * Tìm student có shortId khớp. Quét tối đa LIMIT doc — đủ cho quy mô trung tâm < vài nghìn HV.
 * Nếu trùng nhiều → trả về danh sách để gọi quyết định.
 */
const STUDENT_SCAN_LIMIT = 5000
export async function findStudentsByShortId(shortId: string): Promise<Student[]> {
  if (!shortId) return []
  const target = shortId.toUpperCase()
  const snap = await db.collection(C.STUDENTS).limit(STUDENT_SCAN_LIMIT).get()
  const matches: Student[] = []
  snap.forEach(doc => {
    if (studentShortId(doc.id) === target) {
      matches.push({ id: doc.id, ...(doc.data() as any) } as Student)
    }
  })
  return matches
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
  const snap = await db.collection(C.TUITION_RECORDS)
    .where('studentId', '==', studentId)
    .where('billingMonth', '==', month)
    .where('billingYear', '==', year)
    .get()
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as TuitionRecord))
}
