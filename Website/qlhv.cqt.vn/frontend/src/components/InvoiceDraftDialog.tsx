import { useEffect, useState } from 'react'
import { isAxiosError } from 'axios'
import api from '../services/api'

interface Buyer { fullName: string; legalName: string; citizenIdNumber: string; address: string; email: string; phone: string }
interface Template { id: string; name: string; series: string; templateNo: string }
interface Source { recordId: string; studentId: string; studentName: string; className: string; month: number; year: number; baseAmount: number; discountAmount: number; finalAmount: number; paidAmount: number }
interface Invoice { lastErrorMessage?: string; refId: string; status: string; invoiceNumber?: string; recordIds?: string[] }
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
const money = (value: number) => value.toLocaleString('vi-VN') + 'đ'
const failure = (error: unknown) => isAxiosError(error) && typeof error.response?.data?.message === 'string'
  ? error.response.data.message : 'Không liên lạc được với backend. Vui lòng thử lại.'

export default function InvoiceDraftDialog({ recordId, recordIds, onClose, onCreated }: { recordId?: string; recordIds?: string[]; onClose: () => void; onCreated: (invoice: Invoice) => void }) {
  const grouped = !!recordIds?.length
  const [sources, setSources] = useState<Source[]>([])
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
    const path = grouped
      ? `/tuition/misa/invoices/group?recordIds=${recordIds!.map(encodeURIComponent).join(',')}`
      : `/tuition/misa/invoices/${encodeURIComponent(recordId!)}`
    api.get(path).then(({ data }) => {
      if (!active) return
      setSources(data.sources || [data.source]); setBuyer(data.suggestedBuyer)
      if (['CREATING', 'OUTCOME_UNKNOWN', 'DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX'].includes(data.invoice?.status)) {
        setInvoice(data.invoice)
      }
    }).catch(error => { if (active) setError(failure(error)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [recordId, grouped, recordIds?.join(',')])
  useEffect(() => {
    let active = true
    setTemplatesError(''); setTemplateId(''); setTemplates([])
    api.get('/tuition/misa/templates', { params: { year: Number(invoiceDate.slice(0, 4)) } }).then(({ data }) => {
      if (!active) return
      const available: Template[] = (data.templates ?? []).filter((template: Template) => template.templateNo === '2')
      setTemplates(available); setTemplateId(data.defaultTemplate?.id ?? (available.length === 1 ? available[0].id : ''))
      if (!available.length) setTemplatesError('Không có mẫu hóa đơn bán hàng đang hoạt động cho năm đã chọn.')
    }).catch(error => { if (active) setTemplatesError(failure(error)) })
    return () => { active = false }
  }, [invoiceDate])
  const create = async () => {
    setBusy(true); setError('')
    try {
      const path = grouped ? '/tuition/misa/invoices/group' : `/tuition/misa/invoices/${encodeURIComponent(recordId!)}`
      const { data } = await api.post(path, { ...(grouped ? { recordIds } : {}), buyer, invoiceDate, templateId, revision: 0 })
      onCreated(data.invoice); if (data.invoice.status === 'FAILED') setError(data.invoice.lastErrorMessage || 'MISA từ chối tạo nháp.'); else setInvoice(data.invoice)
    } catch (error) { setError(failure(error)) } finally { setBusy(false) }
  }
  const fields = [['fullName', 'Người mua (phụ huynh / học viên)'], ['legalName', 'Tên đơn vị (nếu lấy hóa đơn cho đơn vị)'], ['citizenIdNumber', 'CCCD'], ['address', 'Địa chỉ người mua'], ['email', 'Email người mua'], ['phone', 'Số điện thoại']] as const
  return <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="invoice-draft-title" className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
      <div className="flex justify-between gap-4 items-start"><div><h2 id="invoice-draft-title" className="text-xl font-bold text-on-surface">Tạo hóa đơn nháp trên MISA</h2>
        <p className="text-sm text-outline mt-1">Website gửi hóa đơn trực tiếp sang MISA. Thao tác này chỉ tạo bản nháp, chưa ký hoặc phát hành.</p></div>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Đóng" className="p-2 rounded-lg hover:bg-surface-container-low">✕</button></div>
      {loading ? <p role="status">Đang tải phiếu học phí...</p> : sources.length > 0 && <>
        {invoice ? <div role="status" className="rounded-xl bg-green-50 border border-green-200 p-4 space-y-1"><p className="font-semibold">{({ CREATING: 'Đang xác minh yêu cầu MISA', OUTCOME_UNKNOWN: 'Chưa rõ kết quả; cần cập nhật trạng thái MISA', DRAFT_CREATED: 'Đã tạo hóa đơn nháp trên MISA', ISSUED: 'Hóa đơn đã phát hành trên MISA', SENT_TO_TAX: 'Hóa đơn đã gửi CQT' } as Record<string, string>)[invoice.status] || invoice.status}</p><p>Mã tham chiếu: {invoice.refId}</p><p>Số hóa đơn: {invoice.invoiceNumber || 'Chưa cấp số'}</p>{invoice.status === 'DRAFT_CREATED' && <p>Chưa ký hoặc phát hành.</p>}{invoice.lastErrorMessage && <p>{invoice.lastErrorMessage}</p>}</div> : <>
          <div className="bg-surface-container-low rounded-xl p-4 text-sm space-y-1"><p className="font-semibold">{sources[0].studentName}{grouped ? ` · ${sources.length} phiếu được gộp` : ` · ${sources[0].className} · tháng ${sources[0].month}/${sources[0].year}`}</p>
            {sources.map(source => <p key={source.recordId || source.className}>{source.className}: phiếu {money(source.finalAmount)} · đã thanh toán {money(source.paidAmount)}</p>)}
            {grouped && <p className="pt-1">Tổng cộng: <strong>{money(sources.reduce((sum, source) => sum + source.finalAmount, 0))}</strong></p>}</div>
          <label className="text-sm block">Mẫu hóa đơn bán hàng<select required value={templateId} onChange={event => setTemplateId(event.target.value)} className="block w-full mt-1 border border-outline-variant rounded-lg p-3"><option value="">Chọn mẫu hóa đơn</option>{templates.map(template => <option key={template.id} value={template.id}>{template.series} — {template.name}</option>)}</select></label>
          {templatesError && <p role="alert" className="text-red-700">{templatesError}</p>}
          <label className="text-sm block">Ngày hóa đơn<input type="date" value={invoiceDate} onChange={event => setInvoiceDate(event.target.value)} className="block mt-1 border border-outline-variant rounded-lg p-3" /></label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{fields.map(([key, label]) => <label key={key} className="text-sm">{label}<input type={key === 'email' ? 'email' : 'text'} inputMode={key === 'citizenIdNumber' ? 'numeric' : undefined} value={buyer[key]} onChange={event => setBuyer(previous => ({ ...previous, [key]: event.target.value }))} className="block w-full mt-1 border border-outline-variant rounded-lg p-3" /></label>)}</div>
          <div className="rounded-xl border border-outline-variant/20 p-4 text-sm space-y-1"><p className="font-semibold mb-2">Xem trước trên website</p>{sources.map(source => <p key={source.recordId || source.className}>Học phí {source.className} · Khuyến mãi: {money(source.discountAmount)} · Thành tiền: <strong>{money(source.finalAmount)}</strong></p>)}<p>Đơn vị tính: Tháng · Số lượng: {sources.length}</p><p>Tổng thanh toán: <strong>{money(sources.reduce((sum, source) => sum + source.finalAmount, 0))}</strong> · Thanh toán: TM/Chuyển khoản</p></div>
          <button type="button" disabled={busy || !templateId || !buyer.fullName && !buyer.legalName} onClick={create} className="bg-primary text-on-primary px-4 py-2 rounded-lg font-semibold disabled:opacity-40">{busy ? 'Đang tạo trên MISA...' : 'Tạo hóa đơn nháp trên MISA'}</button>
        </>}
      </>}
      {error && <p role="alert" className="text-red-700 bg-red-50 rounded-lg p-3 text-sm">{error}</p>}
    </div>
  </div>
}
