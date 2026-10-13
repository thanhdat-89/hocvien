import { randomUUID } from 'node:crypto'
import { InvoiceDraft, InvoicePreviewError, invoiceApi } from './misaInvoicePreview'
import { misaConnectionConfig } from './misaConnection'

// This endpoint creates an unpublished MISA invoice record (PublishStatus=0).
// It is distinct from SignType=1, which only prepares unsigned XML.
const LEGACY_BASE = 'https://app.meinvoice.vn/api/v2'
const decode = (value: any) => { if (typeof value !== 'string') return value; try { return JSON.parse(value) } catch { return null } }
export class MisaPreparationError extends InvoicePreviewError {
  constructor(public code: string, public ambiguous: boolean, message: string) { super(502, message) }
}
export interface MisaPreparationResult { refId: string; transactionId: string; invoiceNo: string; invoiceCode: string }

export function validateSavedDraft(draft: InvoiceDraft) {
  if (!draft.template.id || !draft.template.series || (!draft.buyer.fullName && !draft.buyer.legalName)) {
    throw new InvoicePreviewError(409, 'Cần chọn mẫu và nhập người mua trước khi gửi MISA.')
  }
  if (draft.template.templateNo !== '2') throw new InvoicePreviewError(409, 'Chỉ hỗ trợ mẫu hóa đơn bán hàng số 2.')
}

export function buildUnpublishedInvoiceRequest(draft: InvoiceDraft) {
  validateSavedDraft(draft)
  const { source: s, buyer: b, template: t } = draft
  const detail = {
    RefDetailID: randomUUID(), RefID: draft.refId, Description: `Học phí ${s.className} — ${s.studentName} — tháng ${s.month}/${s.year}`,
    UnitName: 'Tháng', Quantity: 1, UnitPrice: s.baseAmount, AmountOC: s.baseAmount, Amount: s.baseAmount,
    DiscountRate: s.baseAmount ? s.discountAmount / s.baseAmount * 100 : 0,
    DiscountAmountOC: s.discountAmount, DiscountAmount: s.discountAmount, VATRate: 0, VATAmountOC: 0, VATAmount: 0,
    AmountWithoutVATOC: s.finalAmount, AmountWithoutVAT: s.finalAmount,
    IsPromotion: false, SortOrder: 1, SortOrderView: 1, CustomField1Detail: String(s.discountAmount),
  }
  return [{
    EntityState: 1, MISAEntityState: 1, RefID: draft.refId,
    SourceType: 0, InvTemplateNo: t.templateNo, InvoiceType: 10, InvSeries: t.series,
    InvDate: `${draft.invoiceDate}T00:00:00+07:00`, InvNo: '', PublishStatus: 0,
    InvoiceTemplateID: t.id, AccountObjectName: b.legalName || b.fullName, AccountObjectTaxCode: b.taxCode || '',
    AccountObjectAddress: b.address, ContactName: b.fullName, ReceiverEmail: b.email, ReceiverMobile: b.phone,
    SendInvoiceStatus: 0, SendNumber: 0, IsInvoiceReceipted: false, PaymentMethod: 'TM/CK',
    CurrencyCode: 'VND', CurrencyID: 'VND', ExchangeRate: 1,
    TotalSaleAmountOC: s.baseAmount, TotalSaleAmount: s.baseAmount,
    TotalDiscountAmountOC: s.discountAmount, TotalDiscountAmount: s.discountAmount,
    TotalVATAmountOC: 0, TotalVATAmount: 0, TotalAmountWithoutVATOC: s.finalAmount, TotalAmountWithoutVAT: s.finalAmount,
    TotalAmountOC: s.finalAmount, TotalAmount: s.finalAmount, EInvoiceStatus: 1, PaymentStatus: 0,
    IsInvoiceDiscount: s.discountAmount > 0, TypeDiscount: 0,
    DiscountRate: s.baseAmount ? s.discountAmount / s.baseAmount * 100 : 0,
    InvoiceDetails: [detail], IsInvoiceDeleted: false, IsInvoiceSummary: t.isInvoiceSummary,
  }]
}

function safeProviderMessage(body: any) {
  const validation = Array.isArray(body?.ValidateResult) ? body.ValidateResult.find((item: any) => item?.ErrorMessage) : null
  const code = body?.ErrorCode ?? body?.errorCode ?? validation?.ErrorCode
  const message = body?.ErrorMessage ?? body?.errorMessage ?? body?.Message ?? body?.message ?? validation?.ErrorMessage
  const safeCode = typeof code === 'string' && /^[A-Z0-9_.-]{1,80}$/i.test(code) ? ` (${code})` : ''
  const safeMessage = typeof message === 'string' ? message.replace(/[\x00-\x1f]/g, ' ').slice(0, 300) : ''
  const secrets = Object.values(misaConnectionConfig('meinvoice').fields).filter((value): value is string => !!value && value.length >= 4)
  const redacted = secrets.reduce((text, secret) => text.split(secret).join('[ẩn]'), safeMessage)
  return redacted ? `${redacted}${safeCode}` : `MISA từ chối tạo hóa đơn chưa phát hành${safeCode}. Kiểm tra mẫu, ký hiệu và thông tin người mua.`
}

async function legacyToken(request: typeof fetch) {
  const { fields, missing } = misaConnectionConfig('meinvoice')
  if (missing.length) throw new InvoicePreviewError(503, 'Chưa đủ cấu hình meInvoice trên backend.')
  try {
    const response = await request(`${LEGACY_BASE}/oauth`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(7000),
      headers: { taxcode: fields.MEINVOICE_TAXCODE!, 'Content-Type': 'text/plain' },
      body: new URLSearchParams({ grant_type: 'password', username: fields.MEINVOICE_USERNAME!, password: fields.MEINVOICE_PASSWORD! }).toString() })
    const body = await response.json() as any
    if (!response.ok || typeof body.access_token !== 'string' || !body.access_token) throw new MisaPreparationError('AUTH_FAILED', false, safeProviderMessage(body))
    const organizationUnitId = typeof body.OrganizationUnitID === 'string' ? body.OrganizationUnitID : ''
    const databaseId = typeof body.DatabaseID === 'string' ? body.DatabaseID : ''
    if (!organizationUnitId || !databaseId) throw new MisaPreparationError('AUTH_FAILED', false, 'MISA chưa trả thông tin đơn vị và dữ liệu; chưa gửi hóa đơn.')
    return { fields, token: body.access_token, organizationUnitId, databaseId }
  } catch (error) {
    if (error instanceof InvoicePreviewError) throw error
    throw new MisaPreparationError('AUTH_FAILED', false, 'Không xác thực được tài khoản meInvoice; chưa gửi hóa đơn.')
  }
}

export async function prepareUnsignedInvoice(draft: InvoiceDraft, request: typeof fetch = fetch): Promise<MisaPreparationResult> {
  validateSavedDraft(draft)
  // Keep the existing provider-template check before the write, but use the legacy
  // unpublished-invoice endpoint for the actual draft creation.
  const api = await invoiceApi(request)
  const templates = await api.call(`/templates?invoiceWithCode=true&ticket=false&year=${Number(draft.invoiceDate.slice(0, 4))}`, { method: 'GET', headers: api.headers })
  const active = Array.isArray(templates) && templates.find((t: any) => t.Inactive !== true
    && t.IPTemplateID === draft.template.id && t.InvSeries === draft.template.series && String(t.InvTemplateNo) === '2')
  if (!active) throw new InvoicePreviewError(409, 'Mẫu hóa đơn đã thay đổi; cần chọn lại mẫu.')
  const { fields, token, organizationUnitId, databaseId } = await legacyToken(request)
  const body = buildUnpublishedInvoiceRequest(draft)
  let response: Response
  try {
    response = await request(`${LEGACY_BASE}/v3sainvoice/Code`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}`, TaxCode: fields.MEINVOICE_TAXCODE!, OrganizationUnitID: organizationUnitId, DatabaseID: databaseId, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch { throw new MisaPreparationError('OUTCOME_UNKNOWN', true, 'Chưa xác định được kết quả MISA. Cần đối chiếu RefID trước khi gửi lại.') }
  let result: any = null
  try { result = await response.json() } catch { throw new MisaPreparationError('RESULT_UNVERIFIED', true, 'MISA trả phản hồi không đọc được; cần đối chiếu RefID trước khi gửi lại.') }
  const rejected = (value: any) => value?.success === false || value?.Success === false
    || value?.IsValid === false || !!value?.error || !!value?.ErrorMessage || !!value?.ErrorCode?.length
  if (rejected(result)) throw new MisaPreparationError('PROVIDER_REJECTED', false, safeProviderMessage(result))
  // A transport/server failure alone does not prove the invoice was rejected.
  if (!response.ok) throw new MisaPreparationError('RESULT_UNVERIFIED', true, 'MISA trả lỗi HTTP; cần đối chiếu RefID trước khi gửi lại.')
  let item: any = decode(result?.data ?? result?.Data)
  // The documented Webapp API returns a dictionary keyed by the submitted RefID.
  if (item && !Array.isArray(item) && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, draft.refId)) item = decode(item[draft.refId])
  if (Array.isArray(item)) item = item.find((entry: any) => entry?.RefID === draft.refId)
  if (typeof item?.Data === 'string') item = decode(item.Data)
  if (rejected(item)) throw new MisaPreparationError('PROVIDER_REJECTED', false, safeProviderMessage(item))
  if (!item || typeof item !== 'object' || item.RefID !== draft.refId
    || (item.PublishStatus != null && Number(item.PublishStatus) !== 0)
    || (item.IsValid !== true && item.PublishStatus == null)) {
    throw new MisaPreparationError('RESULT_UNVERIFIED', true, 'Chưa xác nhận được hóa đơn Chưa phát hành; cần đối chiếu RefID trước khi gửi lại.')
  }
  // An unpublished record can have no transaction number yet; its confirmed RefID
  // is the stable provider record identifier in that case.
  const transactionId = typeof item.TransactionID === 'string' && item.TransactionID ? item.TransactionID : item.RefID
  return { refId: draft.refId, transactionId, invoiceNo: String(item.InvNo ?? ''), invoiceCode: String(item.InvoiceCode ?? item.InvCode ?? '') }
}
