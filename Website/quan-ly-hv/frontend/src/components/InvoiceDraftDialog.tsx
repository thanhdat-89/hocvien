import { useEffect, useState } from 'react'
import { isAxiosError } from 'axios'
import api from '../services/api'

interface Buyer { fullName: string; legalName: string; citizenIdNumber: string; address: string; email: string; phone: string }
interface Template { id: string; name: string; series: string; templateNo: string }
interface Source { studentName: string; className: string; month: number; year: number; baseAmount: number; discountAmount: number; finalAmount: number; paidAmount: number }
interface Invoice { refId: string; status: string; invoiceNumber?: string }
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
const money = (value: number) => value.toLocaleString('vi-VN') + 'đ'
const failure = (error: unknown) => isAxiosError(error) && typeof error.response?.data?.message === 'string'
  ? error.response.data.message : 'Không liên lạc được với backend. Vui lòng thử lại.'

export default function InvoiceDraftDialog({ recordId, onClose, onCreated }: { recordId: string; onClose: () => void; onCreated: (invoice: Invoice) => void }) {
  const [source, setSource] = useState<Source | null>(null)
  const [buyer, setBuyer] = useState<Buyer>({ fullName: '', legalName: '', citizenIdNumber: '', address: '', email: '', phone: '' })
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateId, setTemplateId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [templatesError, setTemplatesError] = useState('')
  useEffect(() => {
    let active = true
    api.get(`/tuition/misa/invoices/${encodeURIComponent(recordId)}`).then(({ data }) => {
      if (!active) return
      setSource(data.source); setBuyer(data.suggestedBuyer)
      if (['CREATING', 'DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX'].includes(data.invoice?.status)) {
        setInvoice(data.invoice)
      }
    }).catch(error => { if (active) setError(failure(error)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [recordId])
  useEffect(() => {
    let active = true
    api.get('/tuition/misa/templates', { params: { year: Number(invoiceDate.slice(0, 4)) } }).then(({ data }) => {
      if (!active) return
      const available: Template[] = data.templates.filter((template: Template) => template.templateNo === '2')
      setTemplates(available); setTemplateId(available.length === 1 ? available[0].id : '')
      if (!available.length) setTemplatesError('Không có mẫu hóa đơn bán hàng đang hoạt động cho năm đã chọn.')
    }).catch(error => { if (active) setTemplatesError(failure(error)) })
    return () => { active = false }
  }, [invoiceDate])
  const create = async () => {
    setBusy(true); setError('')
    try {
      const { data } = await api.post(`/tuition/misa/invoices/${encodeURIComponent(recordId)}`, { buyer, invoiceDate, templateId, revision: 0 })
      setInvoice(data.invoice); onCreated(data.invoice)
    } catch (error) { setError(failure(error)) } finally { setBusy(false) }
  }
  const fields = [['fullName', 'Người mua (phụ huynh / học viên)'], ['legalName', 'Tên đơn vị (nếu lấy hóa đơn cho đơn vị)'], ['citizenIdNumber', 'CCCD'], ['address', 'Địa chỉ người mua'], ['email', 'Email người mua'], ['phone', 'Số điện thoại']] as const
  return <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="invoice-draft-title" className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
      <div className="flex justify-between gap-4 items-start"><div><h2 id="invoice-draft-title" className="text-xl font-bold text-on-surface">Tạo hóa đơn nháp trên MISA</h2>
        <p className="text-sm text-outline mt-1">Website gửi hóa đơn trực tiếp sang MISA. Thao tác này chỉ tạo bản nháp, chưa ký hoặc phát hành.</p></div>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Đóng" className="p-2 rounded-lg hover:bg-surface-container-low">✕</button></div>
      {loading ? <p role="status">Đang tải phiếu học phí...</p> : source && <>
        {invoice ? <div role="status" className="rounded-xl bg-green-50 border border-green-200 p-4 space-y-1"><p className="font-semibold text-green-800">{invoice.status === 'CREATING' ? 'Đang xác minh yêu cầu tạo hóa đơn trên MISA' : 'Đã tạo hóa đơn nháp trên MISA'}</p><p>Mã tham chiếu: {invoice.refId}</p><p>Số hóa đơn: {invoice.invoiceNumber || 'Chưa cấp số'}</p><p>Chưa ký hoặc phát hành.</p></div> : <>
          <div className="bg-surface-container-low rounded-xl p-4 text-sm space-y-1"><p className="font-semibold">{source.studentName} · {source.className} · tháng {source.month}/{source.year}</p><p>Phiếu: <strong>{money(source.finalAmount)}</strong> · Đã thanh toán: {money(source.paidAmount)}</p></div>
          <label className="text-sm block">Mẫu hóa đơn bán hàng<select required value={templateId} onChange={event => setTemplateId(event.target.value)} className="block w-full mt-1 border border-outline-variant rounded-lg p-3"><option value="">Chọn mẫu hóa đơn</option>{templates.map(template => <option key={template.id} value={template.id}>{template.series} — {template.name}</option>)}</select></label>
          {templatesError && <p role="alert" className="text-red-700">{templatesError}</p>}
          <label className="text-sm block">Ngày hóa đơn<input type="date" value={invoiceDate} onChange={event => setInvoiceDate(event.target.value)} className="block mt-1 border border-outline-variant rounded-lg p-3" /></label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{fields.map(([key, label]) => <label key={key} className="text-sm">{label}<input type={key === 'email' ? 'email' : 'text'} inputMode={key === 'citizenIdNumber' ? 'numeric' : undefined} value={buyer[key]} onChange={event => setBuyer(previous => ({ ...previous, [key]: event.target.value }))} className="block w-full mt-1 border border-outline-variant rounded-lg p-3" /></label>)}</div>
          <div className="rounded-xl border border-outline-variant/20 p-4 text-sm"><p className="font-semibold mb-2">Xem trước trên website</p><p>Học phí {source.className}</p><p>Đơn vị tính: Tháng · Số lượng: 1 · Khuyến mãi: {money(source.discountAmount)}</p><p>Thành tiền: <strong>{money(source.finalAmount)}</strong> · Thanh toán: TM/Chuyển khoản</p></div>
          <button type="button" disabled={busy || !templateId || !buyer.fullName && !buyer.legalName} onClick={create} className="bg-primary text-on-primary px-4 py-2 rounded-lg font-semibold disabled:opacity-40">{busy ? 'Đang tạo trên MISA...' : 'Tạo hóa đơn nháp trên MISA'}</button>
        </>}
      </>}
      {error && <p role="alert" className="text-red-700 bg-red-50 rounded-lg p-3 text-sm">{error}</p>}
    </div>
  </div>
}
