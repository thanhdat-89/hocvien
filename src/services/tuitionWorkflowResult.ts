import { prisma, toClassId, fromClassId } from '../lib/db'
import { tuitionRecordDoc, tuitionRecordInclude } from '../lib/docs'
import { getPaymentStatus } from './tuitionCalculator'
import type { TuitionRecord } from '../types/models'
import { invoicePeriodEligible, INVOICE_START_MESSAGE } from './invoiceEligibility'
import { readInvoice } from './misaInvoiceStore'

/** Read only: recover a lost response without replaying a payment or creating an invoice. */
export async function getTuitionWorkflowResult(input: { studentId: string; classId: string; month: number; year: number; recordId?: string }) {
  let row
  if (input.recordId) {
    row = await prisma.tuitionRecord.findUnique({ where: { id: input.recordId }, include: tuitionRecordInclude })
  } else {
    const rows = await prisma.tuitionRecord.findMany({
      where: { studentId: input.studentId, classId: toClassId(input.classId), billingMonth: input.month, billingYear: input.year },
      include: tuitionRecordInclude, take: 2,
    })
    if (rows.length > 1) throw Object.assign(new Error('Có nhiều phiếu phù hợp; cần kiểm tra trước khi thực hiện lại.'), { status: 409 })
    row = rows[0]
  }
  if (!row) return null
  const record: TuitionRecord & { id: string } = tuitionRecordDoc(row)
  if (record.studentId !== input.studentId || fromClassId(row.classId) !== input.classId || record.billingMonth !== input.month || record.billingYear !== input.year) {
    throw Object.assign(new Error('Phiếu không khớp học viên, lớp hoặc kỳ học phí.'), { status: 409 })
  }
  const [finalStatus, invoice] = await Promise.all([getPaymentStatus(row.id), readInvoice(row.id)])
  const skipped = !invoice && !invoicePeriodEligible(record.billingMonth, record.billingYear)
  return {
    recordId: row.id, paid: finalStatus.remaining <= 0, finalStatus,
    invoiceDraft: { enabled: !skipped, status: skipped ? 'SKIPPED_BEFORE_INVOICE_START' : invoice?.status || 'OUTCOME_UNKNOWN',
      refId: invoice?.refId || '', transactionId: invoice?.transactionId || '',
      message: skipped ? INVOICE_START_MESSAGE : invoice?.lastErrorMessage || (invoice ? '' : 'Phiếu đã lưu nhưng chưa xác nhận được kết quả hóa đơn. Kiểm tra danh sách hóa đơn trước khi tạo lại.') },
  }
}
