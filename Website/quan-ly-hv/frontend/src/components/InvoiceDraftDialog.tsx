import { useEffect, useState } from 'react'
import { isAxiosError } from 'axios'
import api from '../services/api'

interface Buyer { fullName: string; legalName: string; taxCode: string; address: string; email: string; phone: string }
interface Template { id: string; name: string; series: string; templateNo: string }
interface Source {
  studentName: string; className: string; month: number; year: number
  baseAmount: number; discountAmount: number; finalAmount: number; paidAmount: number; fingerprint: string
}
interface Draft { providerInvoiceId?: string; status?: string; lastErrorMessage?: string; refId: string; revision: number; buyer: Buyer; template: Template; source: Source; invoiceDate: string }
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
const money = (value: number) => value.toLocaleString('vi-VN') + 'đ'
const failure = (error: unknown) => isAxiosError(error) && typeof error.response?.data?.message === 'string'
  ? error.response.data.message : 'Không liên lạc được với backend. Vui lòng thử lại.'

export default function InvoiceDraftDialog({ recordId, onClose }: { recordId: string; onClose: () => void }) {
  const [source, setSource] = useState<Source | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [buyer, setBuyer] = useState<Buyer>({ fullName: '', legalName: '', taxCode: '', address: '', email: '', phone: '' })
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateId, setTemplateId] = useState('')
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [templatesError, setTemplatesError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preparationEnabled, setPreparationEnabled] = useState(false)
  const locked = !!draft && ['CREATING_MISA', 'OUTCOME_UNKNOWN', 'MISA_XML_PREPARED', 'MISA_DRAFT_CREATED'].includes(draft.status || '')
  const statusLabels: Record<string, string> = { LOCAL_DRAFT: 'Đã lưu trên website', PENDING_MISA: 'Đang chờ chuẩn bị XML trên MISA', CREATING_MISA: 'Đang xử lý trên MISA', MISA_XML_PREPARED: 'MISA đã chuẩn bị XML chưa ký', OUTCOME_UNKNOWN: 'Kết quả chưa rõ; cần đối chiếu RefID trên MISA', SYNC_FAILED: 'Chưa gửi được; hàng đợi sẽ thử lại', NEEDS_REVIEW: 'Cần kiểm tra bản nháp', MISA_DRAFT_CREATED: 'Đã chuyển sang MISA' }
  const [preview, setPreview] = useState<{ url: string; expiresAt: string; contentVerified: boolean; message: string } | null>(null)
  const templateYear = Number(invoiceDate.slice(0, 4))
  const draftChanged = dirty || !!draft && (draft.template.id !== templateId || draft.invoiceDate !== invoiceDate)
  useEffect(() => {
    let active = true
    api.get(`/tuition/misa/drafts/${encodeURIComponent(recordId)}`).then(({ data }) => {
      if (!active) return
      setPreparationEnabled(data.preparationEnabled === true)
      setSource(data.source); setDraft(data.draft)
      setBuyer(data.draft?.buyer ?? data.suggestedBuyer)
      if (data.draft) {
        setInvoiceDate(data.draft.invoiceDate); setTemplateId(data.draft.template.id)
        setDirty(data.draft.source.fingerprint !== data.source.fingerprint)
      }
    }).catch(error => { if (active) setError(failure(error)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [recordId])
  useEffect(() => {
    if (locked && draft) { setTemplates([draft.template]); setTemplatesLoading(false); setTemplatesError(''); return }
    if (!Number.isInteger(templateYear) || templateYear < 2000 || templateYear > 2100) return
    let active = true
    setTemplatesLoading(true); setTemplatesError(''); setTemplates([])
    api.get('/tuition/misa/templates', { params: { year: templateYear } }).then(({ data }) => {
      if (!active) return
      const available: Template[] = data.templates.filter((template: Template) => template.templateNo === '2')
      setTemplates(available)
      setTemplateId(previous => available.some(template => template.id === previous) ? previous : data.defaultTemplate?.id ?? '')
      if (!available.length) setTemplatesError('Không có mẫu hóa đơn bán hàng đang hoạt động cho năm đã chọn.')
    }).catch(error => { if (active) setTemplatesError(failure(error)) })
      .finally(() => { if (active) setTemplatesLoading(false) })
    return () => { active = false }
  }, [templateYear, locked])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [busy, onClose])
  const changed = () => { setDirty(true); setPreview(null); setNotice('') }
  const save = async () => {
    setBusy(true); setError(''); setPreview(null); setNotice('')
    try {
      const { data } = await api.post(`/tuition/misa/drafts/${encodeURIComponent(recordId)}`, {
        buyer, invoiceDate, templateId, revision: draft?.revision ?? 0,
      })
      setDraft(data.draft); setSource(data.draft.source); setBuyer(data.draft.buyer)
      setDirty(false); setPreparationEnabled(data.preparationEnabled === true); setNotice('Đã lưu bản nháp và đưa vào hàng đợi xử lý.')
    } catch (error) { setError(failure(error)) }
    finally { setBusy(false) }
  }
  const view = async () => {
    if (!draft || draftChanged) return
    setBusy(true); setError(''); setPreview(null); setNotice('')
    try {
      const { data } = await api.post(`/tuition/misa/drafts/${encodeURIComponent(recordId)}/preview`, { revision: draft.revision })
      setPreview(data)
    } catch (error) { setError(failure(error)) }
    finally { setBusy(false) }
  }

  const sync = async () => {
    if (!draft || draftChanged || locked) return
    setBusy(true); setError(''); setNotice('')
    try {
      const { data } = await api.post(`/tuition/misa/drafts/${encodeURIComponent(recordId)}/sync`, { revision: draft.revision })
      setDraft(data.draft); setNotice(data.message)
    } catch (error) { setError(failure(error)) }
    finally { setBusy(false) }
  }

  return <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="invoice-draft-title" className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
      <div className="flex justify-between gap-4 items-start">
        <div><h2 id="invoice-draft-title" className="text-xl font-bold text-on-surface">Bản nháp hóa đơn học phí</h2>
          <p className="text-sm text-outline mt-1">Chưa ký, chưa phát hành. Một bản nháp tương ứng một phiếu học phí.</p></div>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Đóng bản nháp" className="p-2 rounded-lg hover:bg-surface-container-low disabled:opacity-40"><span className="material-symbols-outlined">close</span></button>
      </div>
      {loading ? <p role="status">Đang đọc phiếu học phí đã lưu...</p> : <>
        {source && <div className="bg-surface-container-low rounded-xl p-4 text-sm space-y-1">
          <p className="font-semibold">{source.studentName} · {source.className} · tháng {source.month}/{source.year}</p>
          <p>Số tiền phiếu đã lưu: <strong>{money(source.finalAmount)}</strong> · Đã thanh toán: {money(source.paidAmount)}</p>
          {draft && <p className="text-amber-800">{statusLabels[draft.status || 'LOCAL_DRAFT'] || draft.status}{draft.lastErrorMessage && ` — ${draft.lastErrorMessage}`}</p>}
          {draft?.providerInvoiceId && <p className="text-xs text-outline break-all">Mã xử lý MISA: {draft.providerInvoiceId}</p>}
          {draft && <p className="text-xs text-outline break-all">Mã tham chiếu: {draft.refId} · Bản nháp lần {draft.revision}</p>}
          {draft && draft.source.fingerprint !== source.fingerprint && <p className="text-amber-700">Dữ liệu phiếu hoặc thanh toán đã thay đổi. Lưu lại để cập nhật bản nháp.</p>}
        </div>}
        {source && <form onSubmit={event => { event.preventDefault(); save() }} className="space-y-5">
          <fieldset disabled={busy || locked} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm md:col-span-2">Mẫu hóa đơn bán hàng
              <select required disabled={templatesLoading} value={templateId} onChange={event => { setTemplateId(event.target.value); changed() }} className="block w-full mt-1 border border-outline-variant rounded-lg p-3">
                <option value="">{templatesLoading ? 'Đang lấy mẫu từ meInvoice...' : 'Chọn mẫu hóa đơn'}</option>
                {templates.map(template => <option key={template.id} value={template.id}>{template.series} — {template.name}</option>)}
              </select>
              {templatesError && <span role="alert" className="block text-red-700 mt-1">{templatesError}</span>}
            </label>
            <label className="text-sm">Ngày hóa đơn dự kiến<input required type="date" value={invoiceDate} onChange={event => { setInvoiceDate(event.target.value); changed() }} className="block w-full mt-1 border border-outline-variant rounded-lg p-3" /></label>
            {([['fullName', 'Người mua (phụ huynh / học viên)'], ['legalName', 'Tên đơn vị (nếu lấy hóa đơn cho đơn vị)'], ['taxCode', 'Mã số thuế người mua (nếu có)'], ['address', 'Địa chỉ người mua'], ['email', 'Email người mua'], ['phone', 'Số điện thoại']] as const).map(([key, label]) =>
              <label key={key} className="text-sm">{label}<input autoFocus={key === 'fullName'} type={key === 'email' ? 'email' : 'text'} value={buyer[key]} maxLength={key === 'address' ? 400 : key === 'taxCode' ? 20 : key === 'phone' ? 30 : 255} onChange={event => { setBuyer(previous => ({ ...previous, [key]: event.target.value })); changed() }} className="block w-full mt-1 border border-outline-variant rounded-lg p-3" /></label>
            )}
          </fieldset>
          <p className="text-xs text-outline">Tên người mua được gợi ý từ hồ sơ học viên, cần kiểm tra trước khi lưu. Có thể lập bản nháp trước khi thanh toán. Mẫu bán hàng này dùng số tiền phiếu sau giảm giá; không cộng thêm thuế vào học phí.</p>
          <div className="overflow-x-auto border border-outline-variant/20 rounded-xl">
            <table className="w-full text-sm"><thead><tr>{['Nội dung', 'Tiền học phí', 'Giảm giá', 'Thành tiền'].map(label => <th key={label} className="table-header">{label}</th>)}</tr></thead>
              <tbody><tr><td className="table-cell">Học phí {source.className} — {source.studentName} — tháng {source.month}/{source.year}</td><td className="table-cell whitespace-nowrap">{money(source.baseAmount)}</td><td className="table-cell whitespace-nowrap">{money(source.discountAmount)}</td><td className="table-cell font-semibold whitespace-nowrap">{money(source.finalAmount)}</td></tr></tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy || locked || templatesLoading || !templateId || !!templatesError} className="bg-primary text-on-primary px-4 py-2 rounded-lg font-semibold disabled:opacity-40">{busy ? 'Đang xử lý...' : 'Lưu bản nháp'}</button>
            <button type="button" disabled={busy || !draft || draftChanged || templatesLoading || !!templatesError} onClick={view} className="border border-primary text-primary px-4 py-2 rounded-lg font-semibold disabled:opacity-40">Xem trên mẫu MISA</button>
            <button type="button" disabled={busy || locked || !draft || draftChanged || !preparationEnabled} onClick={sync} className="border border-primary text-primary px-4 py-2 rounded-lg font-semibold disabled:opacity-40">Chuẩn bị XML trên MISA</button>
          </div>
          <p className="text-xs text-outline">Bước này tạo XML chưa ký. Chưa xác minh việc xuất hiện trong danh sách nháp MISA. {preparationEnabled ? 'Hàng đợi được xử lý theo lịch worker đã cấu hình.' : 'Backend chưa bật xử lý XML trên MISA.'}</p>
          {draftChanged && <p className="text-xs text-outline">Lưu nội dung hiện tại trước khi lấy liên kết xem trước từ MISA.</p>}
        </form>}
      </>}
      {error && <p role="alert" className="text-red-700 bg-red-50 rounded-lg p-3 text-sm">{error}</p>}
      {notice && <p role="status" className="text-secondary text-sm">{notice}</p>}
      {preview && <div role="status" className="bg-primary/5 rounded-xl p-4 text-sm">
        {!preview.contentVerified && <p role="alert" className="mb-3 text-amber-800">{preview.message}</p>}
        <a href={preview.url} target="_blank" rel="noopener noreferrer" className="text-primary font-bold underline">Mở bản xem trước hóa đơn MISA</a>
        <p className="mt-2 text-outline">Liên kết có hạn khoảng 5 phút, đến {new Date(preview.expiresAt).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}. Bấm “Xem trên mẫu MISA” để lấy lại khi hết hạn. Chưa ký hoặc phát hành hóa đơn.</p>
      </div>}
    </div>
  </div>
}
