import { useEffect, useState } from 'react'
import api from '../services/api'
import { isAxiosError } from 'axios'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { buildInvoiceWorkbook } from '../lib/invoiceExport'
import InvoiceDraftDialog from './InvoiceDraftDialog'

interface Row {
  studentId: string
  studentName: string
  gradeLevel: number | null
  classId: string
  className: string
  totalSessions: number
  ratePerSession: number
  discountAmount: number
  finalAmount: number
  tuitionRecord: { id: string; finalAmount: number; paidAmount: number; remainingAmount: number; status: string } | null
}

interface CertificateSummary {
  keyAlias: string; status: string; subject: string; issuer: string
  serialNumber: string; validFrom: string; validTo: string
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
  const [gradeFilter, setGradeFilter] = useState<number | null>(null)
  const [draftRecordId, setDraftRecordId] = useState<string | null>(null)
  const [groupRecordIds, setGroupRecordIds] = useState<string[] | null>(null)
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([])
  const [invoiceStatuses, setInvoiceStatuses] = useState<Record<string, { status: string; invoiceNumber?: string; invoiceUrl?: string }>>({})
  const [refreshingStatusId, setRefreshingStatusId] = useState<string | null>(null)
  const [connection, setConnection] = useState<{ products: { product: string; missing: string[] }[]; selectedCertificate: { keyAlias: string; serialNumber: string; name: string } | null } | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [connectionMessage, setConnectionMessage] = useState('')
  const [otpRequired, setOtpRequired] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpType, setOtpType] = useState<0 | 1>(1)
  const [certificates, setCertificates] = useState<CertificateSummary[]>([])
  useEffect(() => { setSelectedRecordIds([]) }, [month, year])
  useEffect(() => {
    let active = true
    api.get('/tuition/misa/connection').then(({ data }) => { if (active) setConnection(data) })
      .catch(() => { if (active) setConnectionMessage('Chỉ quản trị viên có thể kiểm tra kết nối MISA.') })
    return () => { active = false }
  }, [])
  const loadInvoiceStatuses = () => api.get('/tuition/misa/invoices/statuses').then(({ data }) => {
    setInvoiceStatuses(Object.fromEntries((data.invoices || []).map((item: any) => [item.id, item])))
  }).catch(() => {})
  useEffect(() => { loadInvoiceStatuses() }, [])
  const refreshInvoiceStatus = async (id: string) => {
    setRefreshingStatusId(id)
    try {
      const { data } = await api.post(`/tuition/misa/invoices/${encodeURIComponent(id)}/refresh-status`)
      const invoices = data.invoices?.length ? data.invoices : [data.invoice]
      setInvoiceStatuses(previous => ({ ...previous, ...Object.fromEntries(invoices.flatMap((invoice: any) =>
        (invoice.recordIds?.length ? invoice.recordIds : [invoice.id || id]).map((recordId: string) => [recordId, invoice]))) }))
    } catch (error) {
      const message = isAxiosError(error) && typeof error.response?.data?.message === 'string'
        ? error.response.data.message : 'Chưa đọc được trạng thái từ MISA. Hãy thử lại sau.'
      setConnectionMessage(message)
    }
    finally { setRefreshingStatusId(null) }
  }
  const checkConnection = async (product: string, verifyOtp = false) => {
    setChecking(product)
    try {
      const { data } = await api.post('/tuition/misa/connection/check', { product, ...(verifyOtp ? { otp: { code: otpCode, otpType } } : {}) })
      if (product === 'esign' && ['CONNECTED', 'OTP_REQUIRED', 'OTP_FAILED'].includes(data.state)) {
        setOtpRequired(data.state !== 'CONNECTED')
      }
      if (product === 'esign') setCertificates(data.state === 'CONNECTED' ? data.certificates ?? [] : [])
      const name = product === 'meinvoice' ? 'meInvoice' : 'eSign'
      setConnectionMessage(data.state === 'CONNECTED'
        ? `${name}: kết nối thành công, tìm thấy ${data.count} ${product === 'meinvoice' ? 'mẫu hóa đơn' : 'chứng thư số'} (${data.activeCount} đang hoạt động).`
        : data.state === 'MISSING_CONFIG' ? `${name}: cần bổ sung ${data.missing.join(', ')} trên backend.`
        : data.state === 'OTP_REQUIRED' ? `${name}: cần nhập mã xác thực hai lớp.`
        : data.state === 'OTP_FAILED' ? `${name}: mã xác thực chưa hợp lệ hoặc đã hết hạn.`
        : `${name}: chưa xác minh được kết nối. Kiểm tra tài khoản và quyền API.`)
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined
      setConnectionMessage(status === 429
        ? `Bạn đang kiểm tra quá nhanh. Chờ ${isAxiosError(error) ? error.response?.data?.retryAfter ?? 30 : 30} giây rồi thử lại.`
        : status === 400 ? 'Mã OTP phải gồm 6 chữ số và chọn đúng nguồn mã.'
        : status === 403 ? 'Chỉ quản trị viên có quyền kiểm tra kết nối MISA.'
        : status ? `Backend trả lỗi HTTP ${status}. Chưa xác minh được kết nối MISA.`
        : 'Không liên lạc được với backend. Kiểm tra mạng rồi thử lại.')
    }
    finally { if (verifyOtp) setOtpCode(''); setChecking(null) }
  }
  const ready = rows.filter(isReadyForInvoice)
  const visible = rows.filter(row => filter === 'all' || (filter === 'ready' ? isReadyForInvoice(row) : !isReadyForInvoice(row)))
  const gradeFiltered = visible.filter(row => gradeFilter == null || row.gradeLevel === gradeFilter)
  const selectable = (row: Row) => isReadyForInvoice(row) && !!row.tuitionRecord
    && !['CREATING', 'DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX'].includes(invoiceStatuses[row.tuitionRecord.id]?.status || '')
  const selectedRows = selectedRecordIds.map(id => rows.find(row => row.tuitionRecord?.id === id)).filter((row): row is Row => !!row)
  const selectedStudentId = selectedRows[0]?.studentId
  const toggleSelection = (row: Row) => {
    const id = row.tuitionRecord!.id
    setSelectedRecordIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
  }
  const money = (value: number) => value.toLocaleString('vi-VN') + 'đ'
  // A recalculated schedule can differ from the saved paid invoice. Export only matching amounts.
  const exportable = ready.filter(row => row.finalAmount === row.tuitionRecord!.finalAmount)

  if (loading) return <div role="status" className="py-16 text-center text-outline">Đang tải phiếu học phí...</div>
  if (error) return <div role="alert" className="p-6 bg-red-50 text-red-700 rounded-2xl">{error} <button onClick={retry} className="underline font-semibold">Thử lại</button></div>

  return <section className="space-y-6">
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex gap-3">
      <span className="material-symbols-outlined text-amber-700">info</span>
      <div><h3 className="font-bold text-on-surface">Thiết lập kết nối MISA — thử nghiệm</h3>
        <p className="text-sm text-outline mt-1">Kiểm tra kết nối và chứng thư số. Website chỉ tạo hóa đơn nháp trên MISA; ký, phát hành và gửi CQT chưa tự động.</p>
        {connection?.products.map(product => <div key={product.product} className="mt-3">
          <p className="text-sm">{product.product === 'meinvoice' ? 'meInvoice' : 'eSign'}: {product.missing.length ? `Cần bổ sung ${product.missing.join(', ')}` : 'Đủ cấu hình, cần kiểm tra kết nối'}</p>
          <button disabled={!!checking || !!product.missing.length} onClick={() => checkConnection(product.product)} className="mt-2 px-3 py-2 rounded-lg bg-primary text-on-primary text-sm disabled:opacity-40">{checking === product.product ? 'Đang kiểm tra...' : `Kiểm tra ${product.product === 'meinvoice' ? 'meInvoice' : 'eSign'}`}</button>
        </div>)}
        {connectionMessage && <p role="status" className="text-sm mt-3">{connectionMessage}</p>}
        {connection?.selectedCertificate && <div className="mt-4 rounded-xl bg-white border border-primary/20 p-4 text-sm space-y-1">
          <p className="font-semibold text-primary">Chứng thư đã chọn: {connection.selectedCertificate.name || connection.selectedCertificate.keyAlias}</p>
          <p className="break-all">Mã chứng thư: {connection.selectedCertificate.keyAlias}</p>
          <p className="break-all">Số sê-ri: {connection.selectedCertificate.serialNumber}</p>
          <p className="text-xs text-outline">Đã lưu cấu hình. Kiểm tra eSign để đối chiếu chứng thư hiện tại. Chức năng ký và phát hành vẫn tắt.</p>
        </div>}
        {certificates.length > 0 && <div className="mt-4 space-y-3">
          <h4 className="font-semibold text-on-surface">Danh sách chứng thư số eSign</h4>
          {certificates.map((cert, index) => <div key={`${cert.keyAlias}-${index}`} className="p-4 rounded-xl bg-white border border-amber-200 text-sm space-y-1">
            <p className="font-semibold">{index + 1}. {cert.subject.match(/(?:^|\n)CN=([^\n]+)/)?.[1] || cert.keyAlias || 'Chứng thư số'}</p>
            {cert.keyAlias === connection?.selectedCertificate?.keyAlias && cert.serialNumber.toUpperCase() === connection.selectedCertificate.serialNumber.toUpperCase() && <p className="font-semibold text-primary">Đã chọn cho đơn vị xuất hóa đơn</p>}
            <p>Trạng thái eSign: {cert.status === 'ACTIVE' ? 'Đang hoạt động' : cert.status}</p>
            <p className="break-all">Mã chứng thư: {cert.keyAlias || 'Chưa có thông tin'}</p>
            <p className="break-all">Số sê-ri: {cert.serialNumber || 'Chưa đọc được'}</p>
            <p className="whitespace-pre-line break-words">Chủ thể: {cert.subject || 'Chưa đọc được'}</p>
            <p className="whitespace-pre-line break-words">Đơn vị cấp: {cert.issuer || 'Chưa đọc được'}</p>
            <p>Hiệu lực từ: {cert.validFrom ? new Date(cert.validFrom).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'Chưa đọc được'} — đến: {cert.validTo ? new Date(cert.validTo).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'Chưa đọc được'}</p>
          </div>)}
          <p className="text-xs text-outline">Danh sách này chỉ để đối chiếu với chứng thư đã chọn. Chức năng ký và phát hành vẫn tắt.</p>
        </div>}
        {otpRequired && <form className="flex flex-wrap items-end gap-3 mt-3" onSubmit={event => { event.preventDefault(); checkConnection('esign', true) }}>
          <label className="text-sm">Mã xác thực eSign<input type="password" inputMode="numeric" autoComplete="one-time-code" value={otpCode} onChange={event => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} className="block mt-1 p-2 rounded-lg border border-outline-variant bg-white" /></label>
          <label className="text-sm">Nguồn mã<select value={otpType} onChange={event => setOtpType(Number(event.target.value) as 0 | 1)} className="block mt-1 p-2 rounded-lg border border-outline-variant bg-white"><option value={1}>Ứng dụng xác thực</option><option value={0}>Email / SMS</option></select></label>
          <button type="submit" disabled={!!checking || otpCode.length !== 6} className="px-3 py-2 rounded-lg bg-primary text-on-primary text-sm disabled:opacity-40">Xác thực và đọc chứng thư</button>
          <p className="w-full text-xs text-outline">Có thể nhập OTP ngay sau bước đăng nhập. Chờ 30 giây nếu thử lại cùng bước; không gửi mã vào chat.</p>
        </form>}
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
    <div className="rounded-2xl bg-surface-container-lowest p-4 border border-outline-variant/10">
      <p className="text-sm font-semibold text-outline mb-3">Lọc theo khối lớp</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc hóa đơn theo khối lớp">
        <button type="button" aria-pressed={gradeFilter === null} onClick={() => { setGradeFilter(null); setSelectedRecordIds([]) }} className={`px-4 py-2 rounded-full text-sm font-semibold ${gradeFilter === null ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-outline'}`}>Tất cả</button>
        {[6, 7, 8, 9, 10, 11, 12].map(grade =>
          <button key={grade} type="button" aria-pressed={gradeFilter === grade} onClick={() => { setGradeFilter(grade); setSelectedRecordIds([]) }} className={`px-4 py-2 rounded-full text-sm font-semibold ${gradeFilter === grade ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-outline'}`}>Lớp {grade}</button>
        )}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-container-low p-4">
      <p className="text-sm text-outline flex-1">Chọn ít nhất 2 phiếu đã thanh toán đủ của cùng một học viên để gộp thành một hóa đơn với từng lớp là một dòng.</p>
      <button type="button" disabled={selectedRecordIds.length < 2 || !connection} onClick={() => setGroupRecordIds(selectedRecordIds)} className="px-4 py-2 rounded-xl bg-primary text-on-primary font-semibold text-sm disabled:opacity-40">Tạo hóa đơn gộp ({selectedRecordIds.length})</button>
      {selectedRecordIds.length > 0 && <button type="button" onClick={() => setSelectedRecordIds([])} className="px-3 py-2 rounded-xl text-primary font-semibold text-sm">Bỏ chọn</button>}
    </div>
    {exportable.length < ready.length && <p className="text-sm text-amber-700">Có {ready.length - exportable.length} phiếu chênh lệch với lịch học hiện tại. Các phiếu này được bỏ qua khi xuất Excel; hãy kiểm tra lại số tiền.</p>}
    <p className="text-sm text-outline">Mỗi dòng là một khoản học phí theo lớp. Phiếu đã thanh toán đủ có thể tạo hóa đơn nháp trực tiếp trên MISA; website hiển thị phần xem trước trước khi gửi.</p>
    <div className="bg-surface-container-lowest rounded-2xl overflow-x-auto border border-outline-variant/10">
      <table className="w-full"><thead><tr>{['Gộp', 'STT', 'Học viên', 'Lớp học', 'Số tiền phiếu', 'Thanh toán', 'Trạng thái hóa đơn', 'Thao tác'].map(label => <th key={label} className="table-header">{label}</th>)}</tr></thead>
        <tbody>{gradeFiltered.map((row, index) => <tr key={row.tuitionRecord?.id || `${row.studentId}:${row.classId}:${index}`} className="border-t border-outline-variant/10">
          <td className="table-cell"><input type="checkbox" aria-label={`Chọn phiếu ${row.className} của ${row.studentName} để gộp`} checked={!!row.tuitionRecord && selectedRecordIds.includes(row.tuitionRecord.id)} disabled={!selectable(row) || (!!selectedStudentId && selectedStudentId !== row.studentId)} onChange={() => toggleSelection(row)} /></td>
          <td className="table-cell">{index + 1}</td><td className="table-cell font-semibold">{row.studentName}</td><td className="table-cell">{row.className}</td>
          <td className="table-cell whitespace-nowrap">{row.tuitionRecord ? money(row.tuitionRecord.finalAmount) : 'Chưa có phiếu'}</td>
          <td className={`table-cell ${isReadyForInvoice(row) ? 'text-secondary' : 'text-amber-700'}`}>{isReadyForInvoice(row) ? 'Đã thanh toán đủ' : row.tuitionRecord ? 'Chưa thanh toán đủ' : 'Chưa có phiếu'}</td>
          <td className={`table-cell ${invoiceStatuses[row.tuitionRecord?.id || '']?.status === 'REMOVED_FROM_MISA' ? 'text-red-600 font-semibold' : invoiceStatuses[row.tuitionRecord?.id || '']?.status === 'NOT_CREATED' || !invoiceStatuses[row.tuitionRecord?.id || ''] ? 'text-outline' : 'text-secondary'}`}>{({ NOT_CREATED: 'Chưa tạo HĐ', CREATING: 'Đang tạo trên MISA…', DRAFT_CREATED: 'Đã tạo HĐ nháp', ISSUED: 'Đã phát hành', SENT_TO_TAX: 'Đã gửi CQT', REMOVED_FROM_MISA: 'Đã xóa trên MISA' } as Record<string, string>)[invoiceStatuses[row.tuitionRecord?.id || '']?.status || 'NOT_CREATED']}</td>
          <td className="table-cell"><div className="flex flex-col items-start gap-2"><Link to={`/students/${encodeURIComponent(row.studentId)}`} className="text-primary font-semibold whitespace-nowrap">Xem học viên</Link>
            {row.tuitionRecord && ['DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX'].includes(invoiceStatuses[row.tuitionRecord.id]?.status || '') && <button type="button" disabled={refreshingStatusId === row.tuitionRecord.id} onClick={() => refreshInvoiceStatus(row.tuitionRecord!.id)} className="text-primary font-semibold whitespace-nowrap disabled:opacity-40">{refreshingStatusId === row.tuitionRecord.id ? 'Đang kiểm tra…' : 'Cập nhật trạng thái'}</button>}
            {row.tuitionRecord && invoiceStatuses[row.tuitionRecord.id]?.invoiceUrl && <a href={invoiceStatuses[row.tuitionRecord.id].invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-primary font-semibold whitespace-nowrap">Xem hóa đơn MISA</a>}
            {isReadyForInvoice(row) && connection && !['CREATING', 'DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX'].includes(invoiceStatuses[row.tuitionRecord?.id || '']?.status || '') && <button type="button" onClick={() => setDraftRecordId(row.tuitionRecord!.id)} className="text-primary font-semibold whitespace-nowrap">{invoiceStatuses[row.tuitionRecord?.id || '']?.status === 'REMOVED_FROM_MISA' ? 'Tạo lại HĐ nháp MISA' : 'Tạo HĐ nháp MISA'}</button>}
          </div></td>
        </tr>)}</tbody>
      </table>
      {!gradeFiltered.length && <p className="py-12 text-center text-outline">Không có khoản học phí phù hợp với bộ lọc trong tháng {month}/{year}.</p>}
    </div>
    {draftRecordId && <InvoiceDraftDialog recordId={draftRecordId} onClose={() => setDraftRecordId(null)} onCreated={invoice => { setInvoiceStatuses(previous => ({ ...previous, [draftRecordId]: invoice })); }} />}
    {groupRecordIds && <InvoiceDraftDialog recordIds={groupRecordIds} onClose={() => setGroupRecordIds(null)} onCreated={invoice => {
      const ids = invoice.recordIds?.length ? invoice.recordIds : groupRecordIds
      setInvoiceStatuses(previous => ({ ...previous, ...Object.fromEntries(ids.map(id => [id, invoice])) }))
      setSelectedRecordIds(previous => previous.filter(id => !ids.includes(id)))
    }} />}
  </section>
}
