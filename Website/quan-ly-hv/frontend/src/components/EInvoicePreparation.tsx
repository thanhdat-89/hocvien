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

// Any saved fee can have a draft, regardless of payment status.
export function isReadyForInvoice(row: Row) {
  const record = row.tuitionRecord
  return !!record && Number.isFinite(record.finalAmount) && record.finalAmount >= 0
}

function isFullyPaid(row: Row) {
  const record = row.tuitionRecord
  return !!record && Number.isFinite(record.finalAmount) && record.finalAmount > 0
    && Number.isFinite(record.paidAmount) && record.paidAmount >= record.finalAmount
    && Number.isFinite(record.remainingAmount) && record.remainingAmount <= 0
}

export default function EInvoicePreparation({ rows, loading, error, month, year, retry }: {
  rows: Row[]; loading: boolean; error: string | null; month: number; year: number; retry: () => void
}) {
  const [filter, setFilter] = useState<'ready' | 'all' | 'unpaid'>('ready')
  const [draftRecordId, setDraftRecordId] = useState<string | null>(null)
  const [connection, setConnection] = useState<{ products: { product: string; missing: string[] }[]; selectedCertificate: { keyAlias: string; serialNumber: string; name: string } | null } | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [connectionMessage, setConnectionMessage] = useState('')
  const [otpRequired, setOtpRequired] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpType, setOtpType] = useState<0 | 1>(1)
  const [certificates, setCertificates] = useState<CertificateSummary[]>([])
  useEffect(() => {
    let active = true
    api.get('/tuition/misa/connection').then(({ data }) => { if (active) setConnection(data) })
      .catch(() => { if (active) setConnectionMessage('Chỉ quản trị viên có thể kiểm tra kết nối MISA.') })
    return () => { active = false }
  }, [])
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
  const money = (value: number) => value.toLocaleString('vi-VN') + 'đ'
  // A recalculated schedule can differ from the saved fee. Export only matching amounts.
  const paid = rows.filter(isFullyPaid)
  const exportable = paid.filter(row => row.finalAmount === row.tuitionRecord!.finalAmount)

  if (loading) return <div role="status" className="py-16 text-center text-outline">Đang tải phiếu học phí...</div>
  if (error) return <div role="alert" className="p-6 bg-red-50 text-red-700 rounded-2xl">{error} <button onClick={retry} className="underline font-semibold">Thử lại</button></div>

  return <section className="space-y-6">
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex gap-3">
      <span className="material-symbols-outlined text-amber-700">info</span>
      <div><h3 className="font-bold text-on-surface">Thiết lập kết nối MISA — thử nghiệm</h3>
        <p className="text-sm text-outline mt-1">Kiểm tra đăng nhập, mẫu hóa đơn và chứng thư số. Chức năng ký và phát hành hóa đơn đang tắt. Hóa đơn đã lập bên MISA chưa được đồng bộ.</p>
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
      {[['Phiếu có thể lập hóa đơn', ready.length], ['Khoản chưa có phiếu / cần kiểm tra', rows.length - ready.length], ['Tổng tiền phiếu học phí', money(ready.reduce((sum, row) => sum + row.tuitionRecord!.finalAmount, 0))]].map(([label, value]) =>
        <div key={label} className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/10"><p className="text-sm text-outline">{label}</p><p className="text-3xl font-black text-primary mt-2">{value}</p></div>
      )}
    </div>
    <div className="flex flex-wrap justify-between gap-3 items-center">
      <div className="flex flex-wrap gap-2" aria-label="Lọc điều kiện lập hóa đơn">
        {([['ready', 'Đã có phiếu'], ['unpaid', 'Chưa có phiếu / cần kiểm tra'], ['all', 'Tất cả']] as const).map(([value, label]) =>
          <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={`px-4 py-2 rounded-xl text-sm font-semibold ${filter === value ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-outline'}`}>{label}</button>
        )}
      </div>
      <button disabled={!exportable.length} onClick={() => XLSX.writeFile(buildInvoiceWorkbook(exportable), `misa-phieu-da-thanh-toan-${month}-${year}.xlsx`)} className="px-4 py-2 rounded-xl bg-secondary/10 text-secondary font-semibold text-sm disabled:opacity-40">Xuất Excel phiếu đã thanh toán</button>
    </div>
    {exportable.length < paid.length && <p className="text-sm text-amber-700">Có {paid.length - exportable.length} phiếu chênh lệch với lịch học hiện tại. Các phiếu này được bỏ qua khi xuất Excel; hãy kiểm tra lại số tiền.</p>}
    <p className="text-sm text-outline">Mỗi dòng là một khoản học phí theo lớp. Bản nháp hóa đơn được tạo tự động cùng phiếu học phí; mở “Bản nháp / xem trước” để chọn mẫu và kiểm tra người mua. Bản nháp lưu trên website, chưa đồng bộ vào danh sách hóa đơn MISA.</p>
    <div className="bg-surface-container-lowest rounded-2xl overflow-x-auto border border-outline-variant/10">
      <table className="w-full"><thead><tr>{['STT', 'Học viên', 'Lớp học', 'Số tiền phiếu', 'Thanh toán', 'Kết nối hóa đơn', 'Thao tác'].map(label => <th key={label} className="table-header">{label}</th>)}</tr></thead>
        <tbody>{visible.map((row, index) => <tr key={`${row.studentId}:${row.classId}`} className="border-t border-outline-variant/10">
          <td className="table-cell">{index + 1}</td><td className="table-cell font-semibold">{row.studentName}</td><td className="table-cell">{row.className}</td>
          <td className="table-cell whitespace-nowrap">{row.tuitionRecord ? money(row.tuitionRecord.finalAmount) : 'Chưa có phiếu'}</td>
          <td className={`table-cell ${isFullyPaid(row) ? 'text-secondary' : 'text-amber-700'}`}>{isFullyPaid(row) ? 'Đã thanh toán đủ' : row.tuitionRecord ? 'Chưa thanh toán đủ' : 'Chưa có phiếu'}</td>
          <td className="table-cell text-outline">{row.tuitionRecord ? 'Bản nháp nội bộ' : 'Chưa có phiếu'}</td>
          <td className="table-cell"><div className="flex flex-col items-start gap-2"><Link to={`/students/${encodeURIComponent(row.studentId)}`} className="text-primary font-semibold whitespace-nowrap">Xem học viên</Link>
            {row.tuitionRecord && connection && <button type="button" onClick={() => setDraftRecordId(row.tuitionRecord!.id)} className="text-primary font-semibold whitespace-nowrap">Bản nháp / xem trước</button>}
          </div></td>
        </tr>)}</tbody>
      </table>
      {!visible.length && <p className="py-12 text-center text-outline">Không có khoản học phí phù hợp trong tháng {month}/{year}.</p>}
    </div>
    {draftRecordId && <InvoiceDraftDialog recordId={draftRecordId} onClose={() => setDraftRecordId(null)} />}
  </section>
}
