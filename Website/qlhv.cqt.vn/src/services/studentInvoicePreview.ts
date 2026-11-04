import { prisma } from '../lib/db'
import { enrollmentDoc, enrollmentInclude, tuitionRecordDoc, tuitionRecordInclude } from '../lib/docs'
import { buildInvoicePreview, invoiceInfoSelect } from './studentInvoiceInfo'
import { InvoicePreviewError } from './misaInvoicePreview'
import { computeTuitionSummary } from '../lib/tuition'

const INVOICE_CREATED = ['DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX']

/** Xem trước hoá đơn của một tháng (mặc định tháng gần nhất có phiếu); chỉ đọc dữ liệu, không gọi MISA. */
export async function getStudentInvoicePreview(studentId: string, month?: number, year?: number) {
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: invoiceInfoSelect })
  if (!student) throw new InvoicePreviewError(404, 'Không tìm thấy học viên')
  const [recordPeriods, summary] = await Promise.all([
    prisma.tuitionRecord.findMany({
      where: { studentId }, distinct: ['billingYear', 'billingMonth'], select: { billingMonth: true, billingYear: true },
      orderBy: [{ billingYear: 'desc' }, { billingMonth: 'desc' }],
    }).then(rows => rows.map(r => ({ month: r.billingMonth, year: r.billingYear }))),
    computeTuitionSummary(studentId),
  ])
  const periods = [...new Map([...recordPeriods, ...summary].map(p => [p.year * 100 + p.month, { month: p.month, year: p.year }])).entries()]
    .sort(([a], [b]) => b - a).map(([, p]) => p)
  // Mặc định: tháng gần nhất có phiếu; chưa có phiếu nào thì tháng hiện tại (hoặc tháng tạm tính gần nhất đã qua).
  const [nowYear, nowMonth] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()).split('-').map(Number)
  const now = nowYear * 100 + nowMonth
  const period = month && year ? { month, year }
    : recordPeriods[0] ?? periods.find(p => p.year * 100 + p.month <= now) ?? periods[periods.length - 1] ?? null
  // Làm tròn như khi tạo phiếu thật (tuitionCalculator).
  const estimates = period ? summary.filter(r => r.month === period.month && r.year === period.year).map(r => {
    const baseAmount = Math.round(r.baseAmount), discountAmount = Math.round(r.discountAmount)
    return { className: r.className, baseAmount, discountAmount, finalAmount: baseAmount - discountAmount }
  }).filter(r => r.baseAmount > 0) : []

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
    records: recordDocs, estimates, activeClassNames: enrollments.map(e => enrollmentDoc(e).className),
    invoiceDate: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()),
    existingInvoice: existing,
  })
}
