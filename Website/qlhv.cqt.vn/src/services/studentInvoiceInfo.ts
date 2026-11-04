import { invoiceLines, InvoicePreviewError } from './misaInvoicePreview'
import { vndInWords } from '../lib/vndWords'

export const invoiceInfoSelect = {
  fullName: true, address: true,
  invoiceFullName: true, invoiceCitizenId: true, invoiceAddress: true, invoiceEmail: true, invoicePhone: true,
} as const

interface InvoiceInfoSource {
  fullName?: string | null; address?: string | null
  invoiceFullName?: string | null; invoiceCitizenId?: string | null; invoiceAddress?: string | null
  invoiceEmail?: string | null; invoicePhone?: string | null
}

/** Người mua mặc định cho hoá đơn cá nhân: ưu tiên "Thông tin hoá đơn", thiếu thì lùi về tên/địa chỉ học viên. */
export function buyerFromStudent(student: InvoiceInfoSource | null | undefined, fallbackName = '') {
  return {
    fullName: student?.invoiceFullName || student?.fullName || fallbackName,
    legalName: '',
    citizenIdNumber: student?.invoiceCitizenId || '',
    address: student?.invoiceAddress || student?.address || '',
    email: student?.invoiceEmail || '',
    phone: student?.invoicePhone || '',
  }
}

const FIELDS = ['invoiceFullName', 'invoiceCitizenId', 'invoiceAddress', 'invoiceEmail', 'invoicePhone'] as const
const MAX = { invoiceFullName: 255, invoiceCitizenId: 12, invoiceAddress: 400, invoiceEmail: 255, invoicePhone: 30 }

/** Chuẩn hoá + kiểm tra phần thông tin hoá đơn trong body PUT; trường không gửi → không đụng tới. */
export function parseInvoiceInfo(body: Record<string, unknown>) {
  const out: Partial<Record<typeof FIELDS[number], string | null>> = {}
  for (const key of FIELDS) {
    const raw = body[key]
    if (raw === undefined) continue
    const value = raw === null ? '' : String(raw).trim().replace(/\s+/g, ' ')
    if (value.length > MAX[key]) throw new InvoicePreviewError(400, 'Thông tin hoá đơn quá dài.')
    out[key] = value || null
  }
  const { invoiceCitizenId: id, invoiceEmail: email, invoicePhone: phone } = out
  if (id && !/^(\d{9}|\d{12})$/.test(id)) throw new InvoicePreviewError(400, 'Số CCCD phải gồm 9 hoặc 12 chữ số.')
  if (email && !/^[^\s@;]+@[^\s@;]+\.[^\s@;]+$/.test(email)) throw new InvoicePreviewError(400, 'Email hoá đơn không hợp lệ.')
  if (phone && !/^[0-9+().\-\s]{8,30}$/.test(phone)) throw new InvoicePreviewError(400, 'Số điện thoại hoá đơn không hợp lệ.')
  return out
}

interface PreviewRecord { className: string; baseAmount: number; discountAmount: number; finalAmount: number }

/** Bản xem trước hoá đơn: cùng người mua và dòng hàng với hoá đơn thật; tháng chưa có phiếu thì dòng mẫu theo lớp đang học. */
export function buildInvoicePreview(input: {
  student: InvoiceInfoSource; records: PreviewRecord[]; activeClassNames: string[]
  period: { month: number; year: number } | null; periods: { month: number; year: number }[]
  invoiceDate: string; series: string | null; existingInvoice: { invoiceNumber: string | null; status: string } | null
}) {
  const { student, records, period } = input
  const buyer = buyerFromStudent(student)
  const lines = records.length
    ? invoiceLines(records)
    : input.activeClassNames.map(className => ({ description: `Học phí ${className}`, unitName: 'Tháng', quantity: 1,
      unitPrice: null, amount: null, discountAmount: 0, finalAmount: null }))
  const sum = (field: 'amount' | 'discountAmount' | 'finalAmount') => records.length
    ? invoiceLines(records).reduce((total, line) => total + line[field], 0) : null
  const warnings: string[] = []
  if (!records.length) warnings.push(period
    ? `Chưa có phiếu học phí tháng ${period.month}/${period.year}; số tiền chỉ là mẫu.`
    : 'Học viên chưa có phiếu học phí nào; số tiền chỉ là mẫu.')
  if (input.existingInvoice) warnings.push(`Tháng này đã có hoá đơn${input.existingInvoice.invoiceNumber ? ` số ${input.existingInvoice.invoiceNumber}` : ''} trên MISA.`)
  if (!buyer.citizenIdNumber) warnings.push('Chưa có số CCCD.')
  if (!buyer.address) warnings.push('Chưa có địa chỉ.')
  if (!buyer.email) warnings.push('Chưa có email: MISA sẽ không gửi được hoá đơn cho người mua.')
  const finalAmount = sum('finalAmount')
  return {
    invoiceDate: input.invoiceDate, series: input.series, buyer,
    buyerFallback: { fullName: !student.invoiceFullName, address: !student.invoiceAddress && !!student.address },
    period, periods: input.periods, lines,
    totals: { amount: sum('amount'), discountAmount: sum('discountAmount'), finalAmount },
    amountInWords: finalAmount === null ? null : vndInWords(finalAmount),
    existingInvoice: input.existingInvoice, warnings,
  }
}
