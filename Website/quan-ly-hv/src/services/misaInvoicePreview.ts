import { createHash, randomUUID } from 'node:crypto'
import { misaConnectionConfig } from './misaConnection'
import type { Payment, TuitionRecord } from '../types/models'

// Handles MISA template lookup and draft creation. It has no signing/publishing operation.
const BASE = 'https://developer.misa.vn/apis/itg/meinvoice/invoice'
export class InvoicePreviewError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export interface InvoiceTemplate {
  id: string; name: string; series: string; templateNo: string; isInvoiceSummary: boolean; invoiceType?: number
}
export interface InvoiceBuyer {
  fullName: string; legalName: string; citizenIdNumber: string; address: string; email: string; phone: string
}
export interface InvoiceSource {
  recordId: string; studentId: string; studentName: string; className: string
  month: number; year: number; baseAmount: number; discountAmount: number; finalAmount: number
  paidAmount: number; paymentMethodName: string; fingerprint: string
}
export type MisaInvoiceStatus = 'NOT_CREATED' | 'DRAFT_CREATED' | 'ISSUED' | 'SENT_TO_TAX' | 'REMOVED_FROM_MISA'
export interface MisaInvoiceRecord {
  id: string; refId: string; status: MisaInvoiceStatus; source: InvoiceSource; template: InvoiceTemplate
  buyer: InvoiceBuyer; invoiceDate: string; createdAt: string; updatedAt: string
  invoiceNumber?: string; transactionId?: string
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
  const call = async (path: '/token' | `/templates?${string}`, init: RequestInit) => {
    try {
      const response = await request(BASE + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) })
      if (!response.ok) throw new Error('PROVIDER_HTTP')
      const result = await response.json() as any
      if ((result?.Success ?? result?.success) !== true) {
        const code = result?.ErrorCode ?? result?.errorCode
        const safeCode = typeof code === 'string' && /^[A-Z0-9_-]{1,60}$/i.test(code) ? ` (${code})` : ''
        throw new InvoicePreviewError(502, `MISA chưa xử lý được yêu cầu${safeCode}.`)
      }
      return decode(result.Data ?? result.data)
    } catch (error) {
      if (error instanceof InvoicePreviewError) throw error
      throw new InvoicePreviewError(502, 'Không nhận được kết quả từ MISA. Vui lòng thử lại sau.')
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
    invoiceType: Number(item.InvoiceType) || undefined,
  })).filter(item => !!item.id && !!item.series)
}

function legacyConfig() {
  const { fields, missing } = misaConnectionConfig('meinvoice')
  if (missing.length) throw new InvoicePreviewError(503, 'Chưa đủ cấu hình meInvoice trên backend.')
  return fields
}

async function legacyCall(url: string, init: RequestInit, request: typeof fetch) {
  try {
    const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error('PROVIDER_HTTP')
    const body: any = await response.json()
    if (body?.success === false || body?.Success === false || body?.error) {
      throw new InvoicePreviewError(502, 'MISA từ chối tạo hóa đơn nháp. Chưa phát hành hóa đơn.')
    }
    return body
  } catch (error) {
    if (error instanceof InvoicePreviewError) throw error
    throw new InvoicePreviewError(502, 'Không nhận được kết quả từ MISA. Kiểm tra danh sách hóa đơn trước khi thử lại.')
  }
}

async function legacyToken(request: typeof fetch) {
  const fields = legacyConfig()
  const auth = await legacyCall('https://app.meinvoice.vn/api/v2/oauth', {
    method: 'POST', headers: { taxcode: fields.MEINVOICE_TAXCODE!, 'Content-Type': 'text/plain' },
    body: new URLSearchParams({ grant_type: 'password', username: fields.MEINVOICE_USERNAME!, password: fields.MEINVOICE_PASSWORD! }).toString(),
  }, request)
  if (typeof auth.access_token !== 'string' || !auth.access_token) throw new InvoicePreviewError(502, 'Không xác thực được tài khoản meInvoice.')
  return { fields, token: auth.access_token }
}

export async function readMisaInvoiceStatus(refId: string, request: typeof fetch = fetch) {
  const { fields, token } = await legacyToken(request)
  let response: Response
  try {
    response = await request(`https://app.meinvoice.vn/api/v2/v3sainvoice/code/${encodeURIComponent(refId)}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, TaxCode: fields.MEINVOICE_TAXCODE!, 'Content-Type': 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(20000),
    })
  } catch { throw new InvoicePreviewError(502, 'Không nhận được trạng thái từ MISA. Vui lòng thử lại sau.') }
  let result: any = null
  try { result = await response.json() } catch { /* A 404 may have an empty response body. */ }
  if (response.status === 404) return { status: 'REMOVED_FROM_MISA' } as const
  if (!response.ok) throw new InvoicePreviewError(502, 'MISA chưa trả được trạng thái hóa đơn. Website giữ nguyên trạng thái hiện tại.')
  const errorText = [result?.error, result?.Error, result?.message, result?.Message, result?.content, result?.ErrorMessage,
    ...(Array.isArray(result?.errorCode) ? result.errorCode : []), ...(Array.isArray(result?.ErrorCode) ? result.ErrorCode : [])]
    .filter(value => typeof value === 'string').join(' ')
  if ((result?.success ?? result?.Success) === false) {
    if (/not found|không tìm thấy|không tồn tại/i.test(errorText)) return { status: 'REMOVED_FROM_MISA' } as const
    throw new InvoicePreviewError(502, 'MISA chưa xác nhận được trạng thái hóa đơn. Website giữ nguyên trạng thái hiện tại.')
  }
  let invoice: any = decode(result.data ?? result.Data)
  if (typeof invoice === 'string') invoice = decode(invoice)
  if (Array.isArray(invoice)) {
    if (invoice.length === 0) return { status: 'REMOVED_FROM_MISA' } as const
    invoice = invoice[0]
  }
  if (invoice?.Data && typeof invoice.Data === 'string') invoice = decode(invoice.Data)
  if (invoice?.IsInvoiceDeleted === true || invoice?.IsInvoiceDeleted === 1) return { status: 'REMOVED_FROM_MISA' } as const
  if (!invoice && Number(result?.recordsFiltered) === 0) return { status: 'REMOVED_FROM_MISA' } as const
  if (!invoice || invoice.RefID !== refId) throw new InvoicePreviewError(502, 'MISA chưa trả về trạng thái hóa đơn khớp mã tham chiếu.')
  const published = Number(invoice.PublishStatus) > 0
  const sentToTax = [1, 2].includes(Number(invoice.SendToTaxStatus))
  const transactionId = typeof invoice.TransactionID === 'string' ? invoice.TransactionID : undefined
  let invoiceUrl: string | undefined
  if (published && transactionId) {
    try {
      const linkResult = await legacyCall('https://app.meinvoice.vn/api/v3/invoicepublished/linkview', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, CompanyTaxCode: fields.MEINVOICE_TAXCODE!, 'Content-Type': 'application/json' },
        body: JSON.stringify([transactionId]),
      }, request)
      const candidate = decode(linkResult.Data ?? linkResult.data)
      const link = new URL(typeof candidate === 'string' ? candidate : '')
      if (link.protocol === 'https:' && (link.hostname === 'meinvoice.vn' || link.hostname.endsWith('.meinvoice.vn'))
        && !link.username && !link.password) invoiceUrl = link.href
    } catch { /* Keep the confirmed invoice status even when a view link cannot be issued. */ }
  }
  return {
    status: !published ? 'DRAFT_CREATED' : sentToTax ? 'SENT_TO_TAX' : 'ISSUED',
    invoiceNumber: typeof invoice.InvNo === 'string' && invoice.InvNo ? invoice.InvNo : undefined,
    transactionId,
    invoiceCode: invoice.InvoiceCode || undefined,
    invoiceUrl,
  } as const
}

export async function createMisaDraft(input: { refId: string; source: InvoiceSource; sources?: InvoiceSource[]; template: InvoiceTemplate; buyer: InvoiceBuyer; invoiceDate: string }, request: typeof fetch = fetch) {
  const { source: s, buyer: b, template: t } = input
  const sources = input.sources?.length ? input.sources : [s]
  if (sources.some(item => item.studentId !== s.studentId)) throw new InvoicePreviewError(400, 'Không thể gộp phiếu của nhiều học viên vào cùng hóa đơn.')
  const total = (field: 'baseAmount' | 'discountAmount' | 'finalAmount') => sources.reduce((sum, item) => sum + item[field], 0)
  const baseAmount = total('baseAmount'), discountAmount = total('discountAmount'), finalAmount = total('finalAmount')
  if (![baseAmount, discountAmount, finalAmount].every(Number.isSafeInteger)) throw new InvoicePreviewError(400, 'Tổng tiền hóa đơn vượt quá giới hạn an toàn.')
  const { fields, token } = await legacyToken(request)
  const details = sources.map((item, index) => ({
    RefDetailID: randomUUID(), RefID: input.refId, Description: `Học phí ${item.className}`,
    UnitName: 'Tháng', Quantity: 1, UnitPrice: item.baseAmount, AmountOC: item.baseAmount, Amount: item.baseAmount,
    DiscountRate: item.baseAmount ? item.discountAmount / item.baseAmount * 100 : 0,
    DiscountAmountOC: item.discountAmount, DiscountAmount: item.discountAmount, VATRate: 0, VATAmountOC: 0, VATAmount: 0,
    AmountWithoutVATOC: item.finalAmount, AmountWithoutVAT: item.finalAmount,
    IsPromotion: false, SortOrder: index + 1, SortOrderView: index + 1, CustomField1Detail: String(item.discountAmount),
  }))
  const payload = [{
    EntityState: 1, MISAEntityState: 1, RefID: input.refId,
    ...(process.env.MEINVOICE_ORGANIZATION_UNIT_ID ? { OrganizationUnitID: process.env.MEINVOICE_ORGANIZATION_UNIT_ID } : {}),
    // Legacy v2 Web API uses InvoiceType=10 for the cash-register (MTT) invoice.
    SourceType: 0, InvTemplateNo: t.templateNo, InvoiceType: 10, InvSeries: t.series,
    InvDate: `${input.invoiceDate}T00:00:00+07:00`, InvNo: '', PublishStatus: 0,
    InvoiceTemplateID: t.id, AccountObjectName: b.legalName || b.fullName, AccountObjectTaxCode: '', CitizenIDNumber: b.citizenIdNumber,
    AccountObjectAddress: b.address, ContactName: b.fullName, ReceiverEmail: b.email, ReceiverMobile: b.phone,
    SendInvoiceStatus: 0, SendNumber: 0, IsInvoiceReceipted: false, PaymentMethod: 'TM/CK',
    CurrencyCode: 'VND', CurrencyID: 'VND', ExchangeRate: 1,
    TotalSaleAmountOC: baseAmount, TotalSaleAmount: baseAmount,
    TotalDiscountAmountOC: discountAmount, TotalDiscountAmount: discountAmount,
    TotalVATAmountOC: 0, TotalVATAmount: 0, TotalAmountWithoutVATOC: finalAmount, TotalAmountWithoutVAT: finalAmount,
    TotalAmountOC: finalAmount, TotalAmount: finalAmount, EInvoiceStatus: 1, PaymentStatus: 0,
    IsInvoiceDiscount: discountAmount > 0, TypeDiscount: 0, DiscountRate: baseAmount ? discountAmount / baseAmount * 100 : 0,
    InvoiceDetails: details, IsInvoiceDeleted: false, IsInvoiceSummary: t.isInvoiceSummary,
  }]
  const result = await legacyCall('https://app.meinvoice.vn/api/v2/v3sainvoice/Code', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, TaxCode: fields.MEINVOICE_TAXCODE!, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, request)
  const rows = decode(result.data ?? result.Data)
  let item: any = Array.isArray(rows) ? rows[0] : rows?.[input.refId] ?? rows
  if (typeof item === 'string') item = decode(item)
  if (typeof item?.Data === 'string') item = decode(item.Data)
  if (!item || typeof item !== 'object' || item?.Success === false || item?.ErrorMessage || item?.ErrorCode?.length
    || Number(item?.PublishStatus) !== 0) {
    throw new InvoicePreviewError(502, 'MISA không tạo được hóa đơn nháp. Chưa phát hành hóa đơn.')
  }
  if (item?.RefID && item.RefID !== input.refId) throw new InvoicePreviewError(502, 'MISA trả mã hóa đơn không khớp. Hãy kiểm tra MISA trước khi thao tác lại.')
  return { invoiceNumber: typeof item?.InvNo === 'string' ? item.InvNo : 'Chưa cấp số', transactionId: item?.TransactionID }
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
  // Keep the invoice's payment label generic, as requested, regardless of payment split.
  const paymentMethodName = 'TM/Chuyển khoản'
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
    citizenIdNumber: text(body?.buyer?.citizenIdNumber, 20), address: text(body?.buyer?.address, 400),
    email: text(body?.buyer?.email, 255), phone: text(body?.buyer?.phone, 30),
  }
  if (!buyer.fullName && !buyer.legalName) throw new InvoicePreviewError(400, 'Cần nhập tên người mua hoặc tên đơn vị.')
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
