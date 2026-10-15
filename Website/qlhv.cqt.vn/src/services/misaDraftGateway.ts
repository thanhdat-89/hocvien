import { InvoiceDraft, InvoicePreviewError, invoiceApi, createMisaDraft } from './misaInvoicePreview'

// This endpoint creates an unpublished MISA invoice record (PublishStatus=0).
// It is distinct from signing or publishing: both remain disabled in this app.
export class MisaPreparationError extends InvoicePreviewError {
  constructor(public code: string, public ambiguous: boolean, message: string) {
    super(502, message, ambiguous)
  }
}

export interface MisaPreparationResult {
  refId: string
  transactionId: string
  invoiceNo: string
  invoiceCode: string
}

export function validateSavedDraft(draft: InvoiceDraft) {
  if (!draft.template.id || !draft.template.series || (!draft.buyer.fullName && !draft.buyer.legalName)) {
    throw new InvoicePreviewError(409, 'Cần chọn mẫu và nhập người mua trước khi gửi MISA.')
  }
  if (draft.template.templateNo !== '2') {
    throw new InvoicePreviewError(409, 'Chỉ hỗ trợ mẫu hóa đơn bán hàng số 2.')
  }
}

export async function prepareUnsignedInvoice(draft: InvoiceDraft, request: typeof fetch = fetch): Promise<MisaPreparationResult> {
  validateSavedDraft(draft)
  // Validate the selected template through the connected developer API before the write.
  const api = await invoiceApi(request)
  const templates = await api.call(`/templates?invoiceWithCode=true&ticket=false&year=${Number(draft.invoiceDate.slice(0, 4))}`, {
    method: 'GET', headers: api.headers,
  })
  const active = Array.isArray(templates) && templates.find((template: any) => template.Inactive !== true
    && template.IPTemplateID === draft.template.id
    && template.InvSeries === draft.template.series
    && String(template.InvTemplateNo) === '2')
  if (!active) throw new InvoicePreviewError(409, 'Mẫu hóa đơn đã thay đổi; cần chọn lại mẫu.')

  try {
    const result = await createMisaDraft(draft, request)
    return {
      refId: draft.refId,
      transactionId: result.transactionId || draft.refId,
      invoiceNo: result.invoiceNumber,
      invoiceCode: '',
    }
  } catch (error) {
    if (error instanceof InvoicePreviewError) {
      throw new MisaPreparationError(error.ambiguous ? 'RESULT_UNVERIFIED' : 'PROVIDER_REJECTED', error.ambiguous, error.message)
    }
    throw error
  }
}
