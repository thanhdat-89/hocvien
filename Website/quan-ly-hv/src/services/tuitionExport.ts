import { C, rawDb } from '../lib/firebase'
import { getSupabasePool } from '../lib/supabase'
import { flushSupabaseSyncQueue } from '../lib/firestoreMirror'
import { getTuitionScheduleSummary } from './tuitionScheduleSummary'

/** Read-only Firestore-shaped store so exports use the exact website calculation. */
export function tuitionSnapshotStore(documents: { collection_path: string; document_id: string; data: Record<string, any> }[]) {
  const collections = new Map<string, typeof documents>()
  for (const row of documents) {
    const group = collections.get(row.collection_path) ?? []
    group.push(row); collections.set(row.collection_path, group)
  }
  const snapshot = (row?: typeof documents[number]) => ({ id: row?.document_id, exists: !!row, data: () => row?.data })
  function query(path: string, filters: ((data: Record<string, any>) => boolean)[] = []) {
    return {
      where(field: string, operator: string, value: any) {
        return query(path, [...filters, data => {
          if (operator === '==') return data[field] === value
          if (operator === '>=') return data[field] >= value
          if (operator === '<=') return data[field] <= value
          if (operator === 'in') return value.includes(data[field])
          throw new Error('Unsupported export query operator')
        }])
      },
      doc(id: string) { return { get: async () => snapshot((collections.get(path) ?? []).find(row => row.document_id === id)) } },
      async get() {
        const docs = (collections.get(path) ?? []).filter(row => filters.every(f => f(row.data))).map(snapshot)
        return { docs, size: docs.length, empty: docs.length === 0, forEach: (callback: (doc: any) => void) => docs.forEach(callback) }
      },
    }
  }
  return { collection: query } as unknown as Pick<FirebaseFirestore.Firestore, 'collection'>
}

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
      rows = await getTuitionScheduleSummary(month, year, tuitionSnapshotStore(result.rows))
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
