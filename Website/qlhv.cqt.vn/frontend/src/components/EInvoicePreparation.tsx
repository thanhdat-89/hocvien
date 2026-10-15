import { useEffect, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import api from '../services/api'

export interface InvoiceRow {
  id: string
  studentId: string
  studentName: string
  className: string
  finalAmount: number
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
const statusStyles: Record<string, { label: string; color: string; icon: string }> = {
  NOT_CREATED: { label: 'Chưa tạo hóa đơn', color: 'bg-slate-100 text-slate-600', icon: 'receipt_long' },
  CREATING: { label: 'Đang xử lý', color: 'bg-blue-50 text-blue-700', icon: 'schedule' },
  OUTCOME_UNKNOWN: { label: 'Cần đối chiếu', color: 'bg-amber-50 text-amber-800', icon: 'info' },
  FAILED: { label: 'Tạo thất bại', color: 'bg-rose-50 text-rose-700', icon: 'error' },
  DRAFT_CREATED: { label: 'Chưa phát hành', color: 'bg-emerald-50 text-emerald-700', icon: 'check_circle' },
  ISSUED: { label: 'Đã phát hành', color: 'bg-emerald-50 text-emerald-700', icon: 'verified' },
  SENT_TO_TAX: { label: 'Đã gửi CQT', color: 'bg-blue-50 text-blue-700', icon: 'verified' },
  REMOVED_FROM_MISA: { label: 'Đã xóa trên MISA', color: 'bg-rose-50 text-rose-700', icon: 'delete' },
}
const displayedInvoiceNumber = (value?: string) => {
  if (!value || /^<?chưa cấp số>?$/i.test(value.trim())) return null
  return value
}
const money = (value: number) => value.toLocaleString('vi-VN') + 'đ'
const invoiceDate = (invoice: InvoiceRow) => {
  const date = new Date(invoice.invoiceDate || invoice.createdAt || '')
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh',
  })
}

export default function EInvoicePreparation({ rows, counts, total, loading, error, month, year, retry, loadMore, loadingMore }: {
  rows: InvoiceRow[]; counts: Record<string, number>; total: number; loading: boolean; error: string | null
  month: number; year: number; retry: () => void; loadMore?: () => void; loadingMore: boolean
}) {
  const [refreshingStatusId, setRefreshingStatusId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => { clearTimeout(copyTimer.current) }, [])
  const copyReference = async (row: InvoiceRow) => {
    if (!row.refId) return
    try {
      await navigator.clipboard.writeText(row.refId)
      clearTimeout(copyTimer.current)
      setCopiedId(row.id)
      copyTimer.current = setTimeout(() => setCopiedId(null), 2000)
    } catch { setMessage('Không sao chép được RefID. Vui lòng thử lại.') }
  }

  const refreshInvoiceStatus = async (id: string) => {
    setRefreshingStatusId(id); setMessage('')
    try {
      await api.post(`/tuition/misa/invoices/${encodeURIComponent(id)}/refresh-status`)
      retry()
    } catch (error) {
      setMessage(isAxiosError(error) && typeof error.response?.data?.message === 'string'
        ? error.response.data.message : 'Chưa đọc được trạng thái từ MISA. Hãy thử lại sau.')
    } finally { setRefreshingStatusId(null) }
  }

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
        ['Tổng hóa đơn đã tạo', total],
        ['Chưa phát hành', counts.DRAFT_CREATED || 0],
        ['Đã phát hành', counts.ISSUED || 0],
        ['Cần đối chiếu / lỗi', (counts.OUTCOME_UNKNOWN || 0) + (counts.FAILED || 0)],
      ].map(([label, value]) => <div key={label} className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/10">
        <p className="text-sm text-outline">{label}</p><p className="text-3xl font-black text-primary mt-2">{value}</p>
      </div>)}
    </div>

    <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-sm">
      <div className="px-5 sm:px-6 py-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100">
        <div>
          <h3 id="invoice-table-title" className="text-base font-semibold text-on-surface">Danh sách hóa đơn <span className="ml-2 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{total}</span></h3>
          <p className="mt-1 text-xs text-slate-500">Kỳ học phí {String(month).padStart(2, '0')}/{year} · Hóa đơn mới tạo hiển thị trước</p>
        </div>
        <button type="button" onClick={retry} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-primary hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">refresh</span>Tải lại trạng thái
        </button>
      </div>
      <div className="overflow-x-auto">
        <table aria-labelledby="invoice-table-title" className="w-full min-w-[960px] table-fixed text-sm text-slate-700">
          <colgroup><col style={{ width: '12%' }} /><col style={{ width: '21%' }} /><col style={{ width: '14%' }} /><col style={{ width: '20%' }} /><col style={{ width: '21%' }} /><col style={{ width: '12%' }} /></colgroup>
          <thead className="bg-slate-50/80 border-b border-slate-200/70">
            <tr>{['Ngày hóa đơn', 'Học viên / Lớp học', 'Số tiền', 'Trạng thái', 'Thông tin hóa đơn', 'Thao tác'].map((label, index) => <th key={label} scope="col" className={`px-5 py-3.5 text-xs font-semibold text-slate-500 whitespace-nowrap ${index === 2 || index === 5 ? 'text-right' : 'text-left'} ${index === 5 ? '!px-3' : ''}`}>{label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">{rows.map(row => {
            const status = statusStyles[row.status] || { label: labels[row.status] || row.status, color: 'bg-slate-100 text-slate-600', icon: 'info' }
            const number = displayedInvoiceNumber(row.invoiceNumber)
            const canRefresh = row.refId && ['CREATING', 'OUTCOME_UNKNOWN', 'DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX'].includes(row.status)
            return <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
              <td className="px-5 py-5 align-middle whitespace-nowrap tabular-nums text-slate-600">{invoiceDate(row)}</td>
              <td className="px-5 py-5 align-middle">
                <p className="font-semibold text-on-surface text-[15px] leading-5 break-words">{row.studentName}</p>
                <p className="mt-1.5 text-xs text-slate-500 leading-5 break-words">{row.className}</p>
              </td>
              <td className="px-5 py-5 align-middle text-right whitespace-nowrap tabular-nums font-semibold text-on-surface">{money(row.finalAmount)}</td>
              <td className="px-5 py-5 align-middle"><span title={labels[row.status] || row.status} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold leading-4 ${status.color}`}><span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[16px]">{status.icon}</span>{status.label}</span></td>
              <td className="px-5 py-5 align-middle">
                <p className={`text-sm ${number ? 'font-semibold text-on-surface' : 'text-slate-400'}`}>{number || 'Chưa cấp số'}</p>
                {row.refId ? <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
                  <span className="shrink-0 text-[11px] text-slate-400">RefID</span>
                  <span title={row.refId} className="min-w-0 truncate text-xs text-slate-500 select-all">{row.refId}</span>
                  <button type="button" onClick={() => { void copyReference(row) }} aria-label={`Sao chép RefID của ${row.studentName} (${row.className})`} title={copiedId === row.id ? 'Đã sao chép RefID' : 'Sao chép RefID'} className="shrink-0 rounded p-1 text-slate-400 hover:bg-blue-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <span aria-hidden="true" className={`material-symbols-outlined block text-[15px] ${copiedId === row.id ? 'text-emerald-600' : ''}`}>{copiedId === row.id ? 'check' : 'content_copy'}</span>
                  </button>
                </div> : <p className="mt-1.5 text-xs text-slate-400">Chưa có RefID</p>}
              </td>
              <td className="px-3 py-5 align-middle text-right">
                <div className="flex flex-col items-end gap-2">
                  {canRefresh && <button type="button" title="Cập nhật trạng thái hóa đơn" aria-label={`Cập nhật trạng thái hóa đơn của ${row.studentName} (${row.className})`} disabled={refreshingStatusId === row.id} onClick={() => refreshInvoiceStatus(row.id)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50/60 px-2.5 py-2 text-xs font-semibold text-primary hover:bg-blue-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary whitespace-nowrap">
                    <span aria-hidden="true" className={`material-symbols-outlined text-[16px] ${refreshingStatusId === row.id ? 'animate-spin motion-reduce:animate-none' : ''}`}>sync</span>{refreshingStatusId === row.id ? 'Đang tải' : 'Cập nhật'}
                  </button>}
                  {row.invoiceUrl && <a href={row.invoiceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-primary whitespace-nowrap">Xem MISA<span aria-hidden="true" className="material-symbols-outlined text-[15px]">open_in_new</span></a>}
                  {!canRefresh && !row.invoiceUrl && <span className="text-slate-300">—</span>}
                </div>
              </td>
            </tr>
          })}</tbody>
        </table>
      </div>
      {!rows.length ? <div className="py-12 px-6 text-center"><span aria-hidden="true" className="material-symbols-outlined text-[36px] text-slate-300">receipt_long</span><p className="mt-3 text-sm text-slate-500">Chưa có hóa đơn nào trong kỳ học phí này.</p></div>
        : <div className="border-t border-slate-100 px-5 sm:px-6 py-3 text-xs text-slate-400">Đang hiển thị {rows.length}/{total} hóa đơn</div>}
      <span role="status" className="sr-only">{copiedId ? 'Đã sao chép RefID' : ''}</span>
    </div>
    {loadMore && <div className="text-center"><button type="button" disabled={loadingMore} onClick={loadMore} className="px-4 py-2 rounded-xl bg-primary text-on-primary font-semibold disabled:opacity-40">{loadingMore ? 'Đang tải…' : `Xem thêm (${rows.length}/${total})`}</button></div>}
  </section>
}
