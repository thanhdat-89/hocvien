import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { buildInvoiceWorkbook } from '../lib/invoiceExport'

interface Row {
  studentId: string
  studentName: string
  classId: string
  className: string
  totalSessions: number
  ratePerSession: number
  discountAmount: number
  finalAmount: number
  tuitionRecord: { id: string; finalAmount: number; paidAmount: number; remainingAmount: number; status: string } | null
}

// Eligibility is based only on saved payments, never the unsaved checkbox state.
export function isReadyForInvoice(row: Row) {
  const record = row.tuitionRecord
  return !!record && Number.isFinite(record.finalAmount) && record.finalAmount > 0
    && Number.isFinite(record.paidAmount) && record.paidAmount >= record.finalAmount
    && Number.isFinite(record.remainingAmount) && record.remainingAmount <= 0
}

export default function EInvoicePreparation({ rows, loading, error, month, year, retry }: {
  rows: Row[]; loading: boolean; error: string | null; month: number; year: number; retry: () => void
}) {
  const [filter, setFilter] = useState<'ready' | 'all' | 'unpaid'>('ready')
  const ready = rows.filter(isReadyForInvoice)
  const visible = rows.filter(row => filter === 'all' || (filter === 'ready' ? isReadyForInvoice(row) : !isReadyForInvoice(row)))
  const money = (value: number) => value.toLocaleString('vi-VN') + 'đ'
  // A recalculated schedule can differ from the saved paid invoice. Export only matching amounts.
  const exportable = ready.filter(row => row.finalAmount === row.tuitionRecord!.finalAmount)

  if (loading) return <div role="status" className="py-16 text-center text-outline">Đang tải phiếu học phí...</div>
  if (error) return <div role="alert" className="p-6 bg-red-50 text-red-700 rounded-2xl">{error} <button onClick={retry} className="underline font-semibold">Thử lại</button></div>

  return <section className="space-y-6">
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex gap-3">
      <span className="material-symbols-outlined text-amber-700">info</span>
      <div><h3 className="font-bold text-on-surface">Chưa kết nối MISA meInvoice</h3>
        <p className="text-sm text-outline mt-1">Danh sách dưới đây giúp rà soát thanh toán trước khi lập hóa đơn. Chưa gửi dữ liệu, ký số hoặc phát hành hóa đơn. Hóa đơn đã lập bên MISA chưa được đồng bộ.</p>
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[['Phiếu đã thanh toán đủ', ready.length], ['Khoản chưa thanh toán đủ / chưa có phiếu', rows.length - ready.length], ['Tổng tiền phiếu đã thanh toán đủ', money(ready.reduce((sum, row) => sum + row.tuitionRecord!.finalAmount, 0))]].map(([label, value]) =>
        <div key={label} className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/10"><p className="text-sm text-outline">{label}</p><p className="text-3xl font-black text-primary mt-2">{value}</p></div>
      )}
    </div>
    <div className="flex flex-wrap justify-between gap-3 items-center">
      <div className="flex flex-wrap gap-2" aria-label="Lọc điều kiện lập hóa đơn">
        {([['ready', 'Đã thanh toán đủ'], ['unpaid', 'Chưa đủ điều kiện'], ['all', 'Tất cả']] as const).map(([value, label]) =>
          <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={`px-4 py-2 rounded-xl text-sm font-semibold ${filter === value ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-outline'}`}>{label}</button>
        )}
      </div>
      <button disabled={!exportable.length} onClick={() => XLSX.writeFile(buildInvoiceWorkbook(exportable), `misa-phieu-da-thanh-toan-${month}-${year}.xlsx`)} className="px-4 py-2 rounded-xl bg-secondary/10 text-secondary font-semibold text-sm disabled:opacity-40">Xuất Excel phiếu đã thanh toán</button>
    </div>
    {exportable.length < ready.length && <p className="text-sm text-amber-700">Có {ready.length - exportable.length} phiếu chênh lệch với lịch học hiện tại. Các phiếu này được bỏ qua khi xuất Excel; hãy kiểm tra lại số tiền.</p>}
    <p className="text-sm text-outline">Mỗi dòng là một khoản học phí theo lớp. Thông tin người đứng tên hóa đơn và cách gộp các lớp sẽ được thiết lập trước khi bật kết nối.</p>
    <div className="bg-surface-container-lowest rounded-2xl overflow-x-auto border border-outline-variant/10">
      <table className="w-full"><thead><tr>{['STT', 'Học viên', 'Lớp học', 'Số tiền phiếu', 'Thanh toán', 'Kết nối hóa đơn', 'Thao tác'].map(label => <th key={label} className="table-header">{label}</th>)}</tr></thead>
        <tbody>{visible.map((row, index) => <tr key={`${row.studentId}:${row.classId}`} className="border-t border-outline-variant/10">
          <td className="table-cell">{index + 1}</td><td className="table-cell font-semibold">{row.studentName}</td><td className="table-cell">{row.className}</td>
          <td className="table-cell whitespace-nowrap">{row.tuitionRecord ? money(row.tuitionRecord.finalAmount) : 'Chưa có phiếu'}</td>
          <td className={`table-cell ${isReadyForInvoice(row) ? 'text-secondary' : 'text-amber-700'}`}>{isReadyForInvoice(row) ? 'Đã thanh toán đủ' : row.tuitionRecord ? 'Chưa thanh toán đủ' : 'Chưa có phiếu'}</td>
          <td className="table-cell text-outline">Chưa đồng bộ MISA</td>
          <td className="table-cell"><Link to={`/students/${encodeURIComponent(row.studentId)}`} className="text-primary font-semibold whitespace-nowrap">Xem học viên</Link></td>
        </tr>)}</tbody>
      </table>
      {!visible.length && <p className="py-12 text-center text-outline">Không có khoản học phí phù hợp trong tháng {month}/{year}.</p>}
    </div>
  </section>
}
