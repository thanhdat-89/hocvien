import { InvoicePreviewError } from './misaInvoicePreview'

export const INVOICE_START_MESSAGE = 'Chỉ tạo hóa đơn chưa phát hành cho kỳ học phí từ tháng 10/2026. Khoản học phí thuộc kỳ trước tháng 10/2026 không được tạo hóa đơn.'

export function invoicePeriodEligible(month: number, year: number) {
  return Number.isInteger(month) && month >= 1 && month <= 12
    && Number.isInteger(year) && year <= 2100 && (year > 2026 || year === 2026 && month >= 10)
}

export class InvoicePeriodError extends InvoicePreviewError {
  constructor() { super(409, INVOICE_START_MESSAGE) }
}

export function assertInvoicePeriod(month: number, year: number) {
  if (!invoicePeriodEligible(month, year)) throw new InvoicePeriodError()
}
