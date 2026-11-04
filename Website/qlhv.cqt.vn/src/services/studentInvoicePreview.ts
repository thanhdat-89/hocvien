import { prisma } from '../lib/db'
import { enrollmentDoc, enrollmentInclude, tuitionRecordDoc, tuitionRecordInclude } from '../lib/docs'
import { buildInvoicePreview, invoiceInfoSelect } from './studentInvoiceInfo'
import { InvoicePreviewError } from './misaInvoicePreview'

const INVOICE_CREATED = ['DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX']

/** Xem trước hoá đơn của một tháng (mặc định tháng gần nhất có phiếu); chỉ đọc dữ liệu, không gọi MISA. */
export async function getStudentInvoicePreview(studentId: string, month?: number, year?: number) {
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: invoiceInfoSelect })
  if (!student) throw new InvoicePreviewError(404, 'Không tìm thấy học viên')
  const periods = await prisma.tuitionRecord.findMany({
    where: { studentId }, distinct: ['billingYear', 'billingMonth'], select: { billingMonth: true, billingYear: true },
    orderBy: [{ billingYear: 'desc' }, { billingMonth: 'desc' }],
  }).then(rows => rows.map(r => ({ month: r.billingMonth, year: r.billingYear })))
  const period = month && year ? { month, year } : periods[0] ?? null

  const [records, enrollments, lastInvoice] = await Promise.all([
    period ? prisma.tuitionRecord.findMany({ where: { studentId, billingMonth: period.month, billingYear: period.year },
      include: tuitionRecordInclude, orderBy: { createdAt: 'asc' } }) : [],
    prisma.classEnrollment.findMany({ where: { studentId, status: 'ACTIVE' }, include: enrollmentInclude, orderBy: { enrollmentDate: 'asc' } }),
    prisma.misaInvoice.findFirst({ where: { status: { in: INVOICE_CREATED } }, orderBy: { invoiceDate: 'desc' }, select: { template: true } }),
  ])
  const recordDocs = records.map(tuitionRecordDoc)
  const existing = recordDocs.length ? await prisma.misaInvoice.findFirst({
    where: { status: { in: INVOICE_CREATED }, recordIds: { hasSome: recordDocs.map(r => r.id) } },
    select: { invoiceNumber: true, status: true },
  }) : null
  const series = (lastInvoice?.template as { series?: unknown } | null)?.series

  return buildInvoicePreview({
    student, period, periods, series: typeof series === 'string' && series ? series : null,
    records: recordDocs, activeClassNames: enrollments.map(e => enrollmentDoc(e).className),
    invoiceDate: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()),
    existingInvoice: existing,
  })
}
