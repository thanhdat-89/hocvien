import { InvoicePreviewError } from './misaInvoicePreview'

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
