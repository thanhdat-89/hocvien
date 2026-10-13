import { buildPreviewPayload, InvoiceDraft, InvoicePreviewError, invoiceApi } from './misaInvoicePreview'

// MISA's documented SignType=1 step prepares unsigned XML; it is not a publish call.
const BASE = 'https://developer.misa.vn/apis/itg/meinvoice/invoice'
const decode = (value: any) => { if (typeof value !== 'string') return value; try { return JSON.parse(value) } catch { return null } }
export class MisaPreparationError extends InvoicePreviewError {
  constructor(public code: string, public ambiguous: boolean, message: string) { super(502, message) }
}
export function buildUnsignedRequest(draft: InvoiceDraft) {
  validateSavedDraft(draft)
  return { SignType: 1, InvoiceData: [buildPreviewPayload(draft)] }
}
export function validateSavedDraft(draft: InvoiceDraft) {
  if (!draft.template.id || !draft.template.series || (!draft.buyer.fullName && !draft.buyer.legalName)) {
    throw new InvoicePreviewError(409, 'Cần chọn mẫu và nhập người mua trước khi gửi MISA.')
  }
}
export interface MisaPreparationResult { refId: string; transactionId: string; invoiceNo: string; invoiceCode: string }
export async function prepareUnsignedInvoice(draft: InvoiceDraft, request: typeof fetch = fetch): Promise<MisaPreparationResult> {
  const body = buildUnsignedRequest(draft)
  // A single authentication and a shared deadline bound the entire provider operation.
  const deadline = Date.now() + 12000
  const boundedRequest: typeof fetch = (url, init) => request(url, { ...init,
    signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) })
  const api = await invoiceApi(boundedRequest)
  const templates = await api.call(`/templates?invoiceWithCode=true&ticket=false&year=${Number(draft.invoiceDate.slice(0, 4))}`, { method: 'GET', headers: api.headers })
  const active = Array.isArray(templates) && templates.find(t => t.Inactive !== true
    && t.IPTemplateID === draft.template.id && t.InvSeries === draft.template.series && String(t.InvTemplateNo) === '2')
  if (!active) throw new InvoicePreviewError(409, 'Mẫu hóa đơn đã thay đổi; cần chọn lại mẫu.')
  body.InvoiceData[0].IsInvoiceSummary = active.IsSendSummary === true
  let result: any
  try {
    const response = await boundedRequest(BASE, { method: 'POST', headers: api.headers, redirect: 'error', body: JSON.stringify(body) })
    if (!response.ok) throw new Error()
    result = await response.json()
  } catch { throw new MisaPreparationError('OUTCOME_UNKNOWN', true, 'Chưa xác định được kết quả MISA. Cần đối chiếu RefID trước khi gửi lại.') }
  // Do not infer that an HTTP 200 means a saved draft, and never log XML or tokens.
  if (result.publishInvoiceResult != null || result.PublishInvoiceResult != null) {
    throw new MisaPreparationError('UNEXPECTED_PUBLISH_RESULT', true, 'MISA trả kết quả ngoài bước tạo XML. Cần kiểm tra trước khi tiếp tục.')
  }
  if ((result.success ?? result.Success) !== true) {
    throw new MisaPreparationError('PROVIDER_REJECTED', true, 'MISA từ chối tạo dữ liệu hóa đơn. Kiểm tra mẫu và thông tin người mua.')
  }
  const rows = decode(result.createInvoiceResult ?? result.CreateInvoiceResult)
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null
  if (!row || row.RefID !== draft.refId || row.ErrorCode || typeof row.TransactionID !== 'string' || !row.TransactionID) {
    throw new MisaPreparationError('RESULT_UNVERIFIED', true, 'Kết quả tạo XML không khớp RefID hoặc thiếu mã tra cứu. Cần đối chiếu MISA.')
  }
  return { refId: row.RefID, transactionId: row.TransactionID, invoiceNo: String(row.InvNo ?? ''), invoiceCode: String(row.InvCode ?? '') }
}
