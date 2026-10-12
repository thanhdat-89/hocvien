import { C, rawDb } from '../lib/firebase'
import { getSupabasePool } from '../lib/supabase'
import { flushSupabaseSyncQueue } from '../lib/firestoreMirror'
import { firestoreSnapshotStore } from '../lib/firestoreSnapshot'
import { getTuitionScheduleSummary } from './tuitionScheduleSummary'

export const invoiceHeaderRows = [
  ['File mẫu danh sách hóa đơn để nhập vào phần mềm '],
  ['Hướng dẫn:'],
  ['- Điền dữ liệu hóa đơn cần lập trên phần mềm vào các cột tương ứng trên file này'],
  ['- Các cột có dấu (*) là những cột bắt buộc'],
  ['- Nếu muốn nhập thêm thông tin khác, người dùng có thể tự thêm cột trên file này (VD: Mã khách hàng, Mã hàng, Tỷ lệ chiết khấu)'],
  ['- Các dòng dữ liệu phía dưới chỉ là ví dụ minh họa'],
  [''],
  ['Số thứ tự hóa đơn (*)', 'Người mua hàng', 'Hình thức thanh toán (*)', 'Tên hàng hóa/dịch vụ (*)', 'ĐVT', 'Số lượng', 'Đơn giá', 'Khuyến mãi', 'Thành tiền'],
].map(row => [...row, ...Array(9 - row.length).fill('')])

export async function buildTuitionExport(month: number, year: number) {
  let source = 'firebase'
  let rows: any[]
  if (process.env.REPORTS_READ_SOURCE !== 'firebase') {
    try {
      try { await flushSupabaseSyncQueue(rawDb) } catch (error: any) {
        console.warn('[Tuition export] mirror queue flush unavailable', error?.code ?? error?.name ?? 'unknown')
      }
      const paths = [C.STUDENTS, C.CLASSES, C.ENROLLMENTS, C.SESSIONS, C.PRIVATE_SCHEDULES, C.STUDENT_PROMOTIONS, C.TUITION_RECORDS, C.PAYMENTS]
      const result = await getSupabasePool().query(
        'SELECT collection_path, document_id, data FROM qlhv_migration.documents WHERE collection_path = ANY($1::text[])', [paths],
      )
      if (!result.rows.some(row => row.collection_path === C.STUDENTS)) throw new Error('Supabase student snapshot is empty')
      rows = await getTuitionScheduleSummary(month, year, firestoreSnapshotStore(result.rows))
      source = 'supabase'
    } catch (error) {
      if (process.env.REPORTS_FIREBASE_FALLBACK === 'false') throw error
      console.warn('[Tuition export] Supabase unavailable; using Firebase')
      rows = await getTuitionScheduleSummary(month, year)
    }
  } else rows = await getTuitionScheduleSummary(month, year)
  if (rows.some(row => ![row.totalSessions, row.ratePerSession, row.discountAmount, row.finalAmount].every(Number.isFinite))) {
    throw new Error('Invalid tuition export amounts')
  }
  return {
    month, year, source, generatedAt: new Date().toISOString(), sheetName: 'Hóa đơn bán hàng',
    studentCount: new Set(rows.map(row => row.studentId)).size, rowCount: rows.length,
    totalSessions: rows.reduce((sum, row) => sum + row.totalSessions, 0),
    tuitionDue: rows.reduce((sum, row) => sum + row.finalAmount, 0),
    values: [...invoiceHeaderRows, ...rows.map((row, index) => [String(index + 1), row.studentName, 'Chuyển khoản/ Tiền mặt', row.className, 'Buổi học', row.totalSessions, row.ratePerSession, row.discountAmount, row.finalAmount])],
  }
}
