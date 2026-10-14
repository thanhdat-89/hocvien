import { useEffect, useMemo, useState } from 'react'
import { isAxiosError } from 'axios'
import api from '../services/api'

interface Row {
  studentId: string
  studentName: string
  gradeLevel: number | null
  className: string
  tuitionRecord: { id: string; finalAmount: number; paidAmount: number; remainingAmount: number; status: string } | null
}
interface InvoiceStatus {
  id: string
  refId?: string
  status: string
  invoiceNumber?: string
  invoiceUrl?: string
  invoiceDate?: string
  createdAt?: string
  recordIds?: string[]
}

const labels: Record<string, string> = {
  NOT_CREATED: 'Chưa có hóa đơn từ hệ thống',
  CREATING: 'Đang xử lý trên MISA',
  OUTCOME_UNKNOWN: 'Cần đối chiếu MISA',
  FAILED: 'Tạo hóa đơn thất bại',
  DRAFT_CREATED: 'Đã tạo hóa đơn chưa phát hành',
  ISSUED: 'Đã phát hành',
  SENT_TO_TAX: 'Đã gửi CQT',
  REMOVED_FROM_MISA: 'Đã xóa trên MISA',
}
const statusClass: Record<string, string> = {
  CREATING: 'text-amber-700', OUTCOME_UNKNOWN: 'text-amber-700', FAILED: 'text-red-600',
  DRAFT_CREATED: 'text-secondary', ISSUED: 'text-secondary', SENT_TO_TAX: 'text-secondary',
  REMOVED_FROM_MISA: 'text-red-600',
}
const money = (value: number) => value.toLocaleString('vi-VN') + 'đ'
const createdTime = (invoice: InvoiceStatus) => Date.parse(invoice.createdAt || '') || 0
const invoiceDate = (invoice: InvoiceStatus) => {
  const date = new Date(invoice.invoiceDate || invoice.createdAt || '')
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh',
  })
}

export default function EInvoicePreparation({ rows, loading, error, month, year, retry }: {
  rows: Row[]; loading: boolean; error: string | null; month: number; year: number; retry: () => void
}) {
  const [invoiceStatuses, setInvoiceStatuses] = useState<Record<string, InvoiceStatus>>({})
  const [refreshingStatusId, setRefreshingStatusId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const loadInvoiceStatuses = () => api.get('/tuition/misa/invoices/statuses').then(({ data }) => {
    setInvoiceStatuses(Object.fromEntries((data.invoices || []).map((item: InvoiceStatus) => [item.id, item])))
  }).catch(() => setMessage('Không tải được trạng thái hóa đơn đã tạo. Hãy thử tải lại trang.'))

  useEffect(() => { loadInvoiceStatuses() }, [rows])

  const refreshInvoiceStatus = async (id: string) => {
    setRefreshingStatusId(id); setMessage('')
    try {
      const { data } = await api.post(`/tuition/misa/invoices/${encodeURIComponent(id)}/refresh-status`)
      const invoices = data.invoices?.length ? data.invoices : [data.invoice]
      setInvoiceStatuses(previous => ({ ...previous, ...Object.fromEntries(invoices.flatMap((invoice: InvoiceStatus) =>
        (invoice.recordIds?.length ? invoice.recordIds : [invoice.id || id]).map(recordId => [recordId, invoice]))) }))
    } catch (error) {
      setMessage(isAxiosError(error) && typeof error.response?.data?.message === 'string'
        ? error.response.data.message : 'Chưa đọc được trạng thái từ MISA. Hãy thử lại sau.')
    } finally { setRefreshingStatusId(null) }
  }

  const invoiceRows = useMemo(() => rows.filter(row => row.tuitionRecord && invoiceStatuses[row.tuitionRecord.id]
    && invoiceStatuses[row.tuitionRecord.id].status !== 'NOT_CREATED')
    .sort((a, b) => createdTime(invoiceStatuses[b.tuitionRecord!.id]) - createdTime(invoiceStatuses[a.tuitionRecord!.id])), [rows, invoiceStatuses])
  const counts = invoiceRows.reduce((result, row) => {
    const status = invoiceStatuses[row.tuitionRecord!.id]?.status || 'NOT_CREATED'
    result[status] = (result[status] || 0) + 1
    return result
  }, {} as Record<string, number>)

  if (loading) return <div role="status" className="py-16 text-center text-outline">Đang tải trạng thái hóa đơn...</div>
  if (error) return <div role="alert" className="p-6 bg-red-50 text-red-700 rounded-2xl">{error} <button onClick={retry} className="underline font-semibold">Thử lại</button></div>

  return <section className="space-y-6">
    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 flex gap-3">
      <span className="material-symbols-outlined text-primary">info</span>
      <div>
        <h3 className="font-bold text-on-surface">Theo dõi hóa đơn đã tạo</h3>
        <p className="text-sm text-outline mt-1">Trang này chỉ hiển thị trạng thái các hóa đơn được tạo tự động từ trang Học phí. Việc tạo hóa đơn mới thực hiện khi tạo phiếu học phí.</p>
        {message && <p role="alert" className="text-sm text-red-700 mt-3">{message}</p>}
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {[
        ['Tổng hóa đơn đã tạo', invoiceRows.length],
        ['Chưa phát hành', counts.DRAFT_CREATED || 0],
        ['Đã phát hành', counts.ISSUED || 0],
        ['Cần đối chiếu / lỗi', (counts.OUTCOME_UNKNOWN || 0) + (counts.FAILED || 0)],
      ].map(([label, value]) => <div key={label} className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/10">
        <p className="text-sm text-outline">{label}</p><p className="text-3xl font-black text-primary mt-2">{value}</p>
      </div>)}
    </div>

    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-outline">Danh sách hóa đơn đã tạo trong dữ liệu hệ thống · kỳ {month}/{year}</p>
      <button type="button" onClick={loadInvoiceStatuses} className="px-4 py-2 rounded-xl bg-primary text-on-primary font-semibold text-sm">Tải lại trạng thái</button>
    </div>

    <div className="bg-surface-container-lowest rounded-2xl overflow-x-auto border border-outline-variant/10">
      <table className="w-full"><thead><tr>{['Ngày hóa đơn', 'Học viên', 'Lớp học', 'Số tiền', 'Trạng thái hóa đơn', 'RefID', 'Số hóa đơn', 'Thao tác'].map(label => <th key={label} className="table-header">{label}</th>)}</tr></thead>
        <tbody>{invoiceRows.map(row => {
          const invoice = invoiceStatuses[row.tuitionRecord!.id]
          return <tr key={row.tuitionRecord!.id} className="border-t border-outline-variant/10">
            <td className="table-cell whitespace-nowrap">{invoiceDate(invoice)}</td>
            <td className="table-cell font-semibold">{row.studentName}</td>
            <td className="table-cell">{row.className}</td>
            <td className="table-cell whitespace-nowrap">{money(row.tuitionRecord!.finalAmount)}</td>
            <td className={`table-cell font-semibold ${statusClass[invoice.status] || 'text-outline'}`}>{labels[invoice.status] || invoice.status}</td>
            <td className="table-cell text-xs text-outline break-all max-w-[220px]">{invoice.refId || '—'}</td>
            <td className="table-cell">{invoice.invoiceNumber || 'Chưa cấp số'}</td>
            <td className="table-cell"><div className="flex flex-col items-start gap-2">
              {invoice.refId && ['CREATING', 'OUTCOME_UNKNOWN', 'DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX'].includes(invoice.status) && <button type="button" disabled={refreshingStatusId === row.tuitionRecord!.id} onClick={() => refreshInvoiceStatus(row.tuitionRecord!.id)} className="text-primary font-semibold whitespace-nowrap disabled:opacity-40">{refreshingStatusId === row.tuitionRecord!.id ? 'Đang cập nhật…' : 'Cập nhật trạng thái'}</button>}
              {invoice.invoiceUrl && <a href={invoice.invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-primary font-semibold whitespace-nowrap">Xem trên MISA</a>}
            </div></td>
          </tr>
        })}</tbody>
      </table>
      {!invoiceRows.length && <p className="py-12 text-center text-outline">Chưa có hóa đơn nào được tạo từ hệ thống để hiển thị.</p>}
    </div>
  </section>
}
