import { createHash } from 'node:crypto'
import { misaConnectionConfig } from './misaConnection'
import type { Payment, TuitionRecord } from '../types/models'

// Only authentication, template lookup and UNPUBLISHED preview are allowed here.
const BASE = 'https://developer.misa.vn/apis/itg/meinvoice/invoice'
export class InvoicePreviewError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export interface InvoiceTemplate {
  id: string; name: string; series: string; templateNo: string; isInvoiceSummary: boolean
}
export interface InvoiceBuyer {
  fullName: string; legalName: string; taxCode: string; address: string; email: string; phone: string
}
export interface InvoiceSource {
  recordId: string; studentId: string; studentName: string; className: string
  month: number; year: number; baseAmount: number; discountAmount: number; finalAmount: number
  paidAmount: number; paymentMethodName: string; fingerprint: string
}
export interface InvoiceDraft {
  id: string; refId: string; status: 'LOCAL_DRAFT'; revision: number
  source: InvoiceSource; template: InvoiceTemplate; buyer: InvoiceBuyer; invoiceDate: string
  createdAt: string; updatedAt: string; createdBy: string; updatedBy: string
}

const decode = (value: any) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}
async function invoiceApi(request: typeof fetch = fetch) {
  const { fields, missing } = misaConnectionConfig('meinvoice')
  if (missing.length) throw new InvoicePreviewError(503, 'Chưa đủ cấu hình meInvoice trên backend.')
  const headers = { 'Content-Type': 'application/json', ClientID: fields.MEINVOICE_CLIENT_ID!, ClientSecret: fields.MEINVOICE_CLIENT_SECRET! }
  const deadline = Date.now() + 20000
  const call = async (path: '/token' | '/unpublishview' | `/templates?${string}`, init: RequestInit) => {
    try {
      const response = await request(BASE + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) })
      if (!response.ok) throw new Error('PROVIDER_HTTP')
      const result = await response.json() as any
      if ((result?.Success ?? result?.success) !== true) {
        const code = result?.ErrorCode ?? result?.errorCode
        const safeCode = typeof code === 'string' && /^[A-Z0-9_-]{1,60}$/i.test(code) ? ` (${code})` : ''
        throw new InvoicePreviewError(502, `MISA chưa xử lý được yêu cầu${safeCode}. Bản nháp chưa được phát hành.`)
      }
      return decode(result.Data ?? result.data)
    } catch (error) {
      if (error instanceof InvoicePreviewError) throw error
      throw new InvoicePreviewError(502, 'Không nhận được kết quả từ MISA. Có thể thử lại; chức năng phát hành đang tắt.')
    }
  }
  const token = await call('/token', { method: 'POST', headers, body: JSON.stringify({
    taxcode: fields.MEINVOICE_TAXCODE, username: fields.MEINVOICE_USERNAME, password: fields.MEINVOICE_PASSWORD,
  }) })
  if (typeof token !== 'string' || !token) throw new InvoicePreviewError(502, 'Không xác thực được meInvoice.')
  return { call, headers: { ...headers, Authorization: `Bearer ${token}` } }
}

export async function listInvoiceTemplates(year: number, request: typeof fetch = fetch): Promise<InvoiceTemplate[]> {
  const api = await invoiceApi(request)
  const list = await api.call(`/templates?invoiceWithCode=true&ticket=false&year=${year}`, { method: 'GET', headers: api.headers })
  if (!Array.isArray(list)) throw new InvoicePreviewError(502, 'Danh sách mẫu hóa đơn từ MISA không hợp lệ.')
  return list.filter(item => item.Inactive !== true).map(item => ({
    id: String(item.IPTemplateID ?? ''), name: String(item.TemplateName ?? ''), series: String(item.InvSeries ?? ''),
    templateNo: String(item.InvTemplateNo ?? ''), isInvoiceSummary: item.IsSendSummary === true,
  })).filter(item => !!item.id && !!item.series)
}

export function invoiceSource(record: TuitionRecord, payments: Payment[]): InvoiceSource {
  const amounts = [record.baseAmount, record.discountAmount, record.finalAmount]
  if (amounts.some(n => !Number.isSafeInteger(n) || n < 0) || record.finalAmount <= 0
    || record.baseAmount - record.discountAmount !== record.finalAmount
    || !Number.isInteger(record.billingMonth) || record.billingMonth < 1 || record.billingMonth > 12
    || !Number.isInteger(record.billingYear) || record.billingYear < 2000 || record.billingYear > 2100
    || !['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'].includes(record.status)) {
    throw new InvoicePreviewError(409, 'Phiếu học phí không hợp lệ để lập bản nháp. Kiểm tra số tiền và kỳ học phí đã lưu.')
  }
  if (payments.some(p => p.tuitionRecordId !== record.id || !Number.isSafeInteger(p.amount))) {
    throw new InvoicePreviewError(409, 'Dữ liệu thanh toán không hợp lệ.')
  }
  const paidAmount = payments.reduce((sum, payment) => sum + payment.amount, 0)
  if (!Number.isSafeInteger(paidAmount) || paidAmount < record.finalAmount) {
    throw new InvoicePreviewError(409, 'Phiếu chưa được thanh toán đủ theo các giao dịch đã lưu.')
  }
  const methods = new Set(payments.filter(p => p.amount > 0).map(p => p.method))
  const paymentMethodName = methods.size === 1 && methods.has('CASH') ? 'TM'
    : methods.size === 1 && methods.has('BANK_TRANSFER') ? 'CK' : 'TM/CK'
  const source = {
    recordId: record.id, studentId: record.studentId, studentName: record.studentName, className: record.className,
    month: record.billingMonth, year: record.billingYear, baseAmount: record.baseAmount,
    discountAmount: record.discountAmount, finalAmount: record.finalAmount, paidAmount, paymentMethodName,
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ ...source,
    payments: payments.map(p => ({ id: p.id, amount: p.amount, method: p.method })).sort((a, b) => a.id.localeCompare(b.id)),
  })).digest('hex')
  return { ...source, fingerprint }
}

export function validateDraftInput(body: any) {
  const text = (value: unknown, max: number) => {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string' || value.length > max || /[\x00-\x1f]/.test(value)) {
      throw new InvoicePreviewError(400, 'Thông tin người mua không hợp lệ hoặc quá dài.')
    }
    return value.trim()
  }
  const buyer: InvoiceBuyer = {
    fullName: text(body?.buyer?.fullName, 255), legalName: text(body?.buyer?.legalName, 255),
    taxCode: text(body?.buyer?.taxCode, 20), address: text(body?.buyer?.address, 400),
    email: text(body?.buyer?.email, 255), phone: text(body?.buyer?.phone, 30),
  }
  if (!buyer.fullName && !buyer.legalName) throw new InvoicePreviewError(400, 'Cần nhập tên người mua hoặc tên đơn vị.')
  if (buyer.taxCode && (!/^\d{10}(?:-\d{3})?$|^\d{12}$/.test(buyer.taxCode) || !buyer.legalName || !buyer.address)) {
    throw new InvoicePreviewError(400, 'Khi có mã số thuế cần nhập đúng mã, tên đơn vị và địa chỉ.')
  }
  if (buyer.email && !/^[^\s@;]+@[^\s@;]+\.[^\s@;]+$/.test(buyer.email)) throw new InvoicePreviewError(400, 'Email người mua không hợp lệ.')
  const invoiceDate = body?.invoiceDate
  if (typeof invoiceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)
    || !Number.isFinite(Date.parse(invoiceDate)) || new Date(invoiceDate).toISOString().slice(0, 10) !== invoiceDate) {
    throw new InvoicePreviewError(400, 'Ngày hóa đơn không hợp lệ.')
  }
  const templateId = text(body?.templateId, 100)
  const revision = body?.revision
  if (!templateId || !Number.isInteger(revision) || revision < 0) throw new InvoicePreviewError(400, 'Cần chọn mẫu hóa đơn và phiên bản bản nháp.')
  return { buyer, invoiceDate, templateId, revision }
}

export function buildPreviewPayload(draft: InvoiceDraft) {
  // Sales invoice only. VAT invoice configuration needs a separate reviewed implementation.
  if (draft.template.templateNo !== '2') throw new InvoicePreviewError(409, 'Bản nháp hiện hỗ trợ mẫu hóa đơn bán hàng (mẫu số 2).')
  const { source: s, buyer: b } = draft
  return {
    RefID: draft.refId, InvSeries: draft.template.series, InvDate: draft.invoiceDate,
    CurrencyCode: 'VND', ExchangeRate: 1, PaymentMethodName: s.paymentMethodName,
    IsInvoiceSummary: draft.template.isInvoiceSummary, IsSendEmail: false,
    BuyerFullName: b.fullName, BuyerLegalName: b.legalName, BuyerTaxCode: b.taxCode,
    BuyerAddress: b.address, BuyerEmail: b.email, BuyerPhoneNumber: b.phone,
    TotalSaleAmountOC: s.baseAmount, TotalSaleAmount: s.baseAmount,
    TotalDiscountAmountOC: s.discountAmount, TotalDiscountAmount: s.discountAmount,
    TotalAmountWithoutVATOC: s.finalAmount, TotalAmountWithoutVAT: s.finalAmount,
    TotalVATAmountOC: 0, TotalVATAmount: 0, TotalAmountOC: s.finalAmount, TotalAmount: s.finalAmount,
    OriginalInvoiceDetail: [{
      ItemType: 1, SortOrder: 1, LineNumber: 1,
      ItemName: `Học phí ${s.className} — ${s.studentName} — tháng ${s.month}/${s.year}`,
      UnitName: 'Tháng', Quantity: 1, UnitPrice: s.baseAmount, AmountOC: s.baseAmount, Amount: s.baseAmount,
      DiscountRate: s.baseAmount > 0 ? s.discountAmount / s.baseAmount * 100 : 0,
      DiscountAmountOC: s.discountAmount, DiscountAmount: s.discountAmount,
      AmountWithoutVATOC: s.finalAmount, AmountWithoutVAT: s.finalAmount, VATAmountOC: 0, VATAmount: 0,
    }],
  }
}

export async function previewInvoice(draft: InvoiceDraft, request: typeof fetch = fetch) {
  const payload = buildPreviewPayload(draft)
  const api = await invoiceApi(request)
  const year = Number(draft.invoiceDate.slice(0, 4))
  const templates = await api.call(`/templates?invoiceWithCode=true&ticket=false&year=${year}`, { method: 'GET', headers: api.headers })
  const active = Array.isArray(templates) && templates.find(item => item.Inactive !== true
    && item.IPTemplateID === draft.template.id && item.InvSeries === draft.template.series && String(item.InvTemplateNo) === '2')
  if (!active) throw new InvoicePreviewError(409, 'Mẫu đã thay đổi hoặc ngừng hoạt động. Chọn lại mẫu và lưu bản nháp.')
  payload.IsInvoiceSummary = active.IsSendSummary === true
  const data = await api.call('/unpublishview', { method: 'POST', headers: api.headers, body: JSON.stringify(payload) })
  let url: URL
  try { url = new URL(data) } catch { throw new InvoicePreviewError(502, 'MISA chưa trả về liên kết xem trước hợp lệ.') }
  if (url.protocol !== 'https:' || url.username || url.password
    || !(url.hostname === 'meinvoice.vn' || url.hostname.endsWith('.meinvoice.vn'))) {
    throw new InvoicePreviewError(502, 'Liên kết xem trước từ MISA không thuộc tên miền được cho phép.')
  }
  // A successful API response can still point to an empty download. Verify only the PDF header,
  // cancel the stream afterwards, and do not claim the document rendered when it did not.
  let contentVerified = false
  try {
    const response = await request(url.href, { method: 'GET', redirect: 'error',
      headers: { Range: 'bytes=0-3' }, signal: AbortSignal.timeout(4000) })
    if (response.ok && response.body) {
      const reader = response.body.getReader()
      let header = Buffer.alloc(0)
      try {
        while (header.length < 4) {
          const chunk = await reader.read()
          if (chunk.done) break
          header = Buffer.concat([header, Buffer.from(chunk.value).subarray(0, 4 - header.length)])
        }
        contentVerified = header.toString() === '%PDF'
      } finally { await reader.cancel().catch(() => {}) }
    }
  } catch { /* The admin can retry without altering the local draft. */ }
  // The short-lived URL is returned only to the authenticated admin, never persisted or logged.
  return { url: url.href, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), publishingEnabled: false,
    contentVerified, message: contentVerified ? '' : 'MISA đã trả liên kết nhưng chưa đọc được nội dung PDF. Có thể liên kết mở trang trắng; thử lấy lại sau. Bản nháp vẫn được lưu, chưa ký hoặc phát hành.' }
}
