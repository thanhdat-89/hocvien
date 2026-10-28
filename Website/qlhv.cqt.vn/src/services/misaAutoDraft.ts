import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma, type Tx } from '../lib/db'
import { paymentDoc, paymentInclude, tuitionRecordDoc, tuitionRecordInclude } from '../lib/docs'
import type { Payment, TuitionRecord } from '../types/models'
import { readInvoice, saveInvoiceCopies } from './misaInvoiceStore'
import { InvoicePreviewError, invoiceSource, listInvoiceTemplates, validateDraftInput, InvoiceTemplate, MisaInvoiceRecord, createMisaDraft, readMisaInvoiceStatus } from './misaInvoicePreview'
import { notifyInvoiceCreated, notifyInvoiceCreationFailed } from './telegramService'
import { invalidateReadView, invoiceBillingPeriods } from './readViews'
import { withMisaDeadline } from './misaRequestDeadline'
import { assertInvoicePeriod, InvoicePeriodError } from './invoiceEligibility'

export function chooseDefaultInvoiceTemplate(templates: InvoiceTemplate[]) {
  const id = process.env.MEINVOICE_DEFAULT_TEMPLATE_ID?.trim()
  const series = process.env.MEINVOICE_DEFAULT_SERIES?.trim()
  const matches = templates.filter(t => t.templateNo === '2' && (!id || t.id === id) && (!series || t.series === series))
  return matches.length === 1 ? matches[0] : null
}

/** Shared by the invoice page and tuition actions; reserve all records before contacting MISA. */
export async function createTuitionMisaInvoice(recordIds: string[], actorId: string, body?: any, request: typeof fetch = fetch,
  options: { notifications?: boolean; positiveAmountOnly?: boolean } = {}) {
  try {
    const result = await createTuitionMisaInvoiceInternal(recordIds, actorId, body, withMisaDeadline(request), options)
    if (options.notifications !== false && !result.alreadyExists && ['FAILED', 'OUTCOME_UNKNOWN'].includes(result.invoice.status)) {
      const invoice = result.invoice as MisaInvoiceRecord
      notifyInvoiceCreationFailed({ recordIds, refId: invoice.refId,
        reason: invoice.lastErrorMessage || 'Chưa tạo được hóa đơn MISA.',
        outcomeUnknown: invoice.status === 'OUTCOME_UNKNOWN', sources: invoice.sources || [invoice.source] })
    }
    return result
  } catch (error) {
    if (error instanceof InvoicePeriodError || options.notifications === false) throw error
    notifyInvoiceCreationFailed({ recordIds,
      reason: error instanceof InvoicePreviewError ? error.message : 'Lỗi xử lý nội bộ hoặc kết nối dữ liệu khi tạo hóa đơn.' }, async () => {
      const records = (await prisma.tuitionRecord.findMany({ where: { id: { in: recordIds.slice(0, 20) } }, include: tuitionRecordInclude })).map(tuitionRecordDoc)
      return records.map((data: any) => ({ studentName: String(data.studentName || 'Chưa xác định học viên'), className: String(data.className || 'Chưa xác định lớp'),
        month: data.billingMonth || 0, year: data.billingYear || 0, finalAmount: Number(data.finalAmount) || 0 }))
    })
    throw error
  }
}

async function createTuitionMisaInvoiceInternal(recordIds: string[], actorId: string, body?: any, request: typeof fetch = fetch,
  options: { notifications?: boolean; positiveAmountOnly?: boolean } = {}) {
  if (!recordIds.length || recordIds.length > 20 || new Set(recordIds).size !== recordIds.length) throw new InvoicePreviewError(400, 'Danh sách phiếu không hợp lệ hoặc bị trùng.')
  const suppliedInput = body ? validateDraftInput(body) : undefined
  const loadFee = async (id: string, tx: Tx = prisma) => {
    const row = await tx.tuitionRecord.findUnique({ where: { id }, include: tuitionRecordInclude })
    return row ? tuitionRecordDoc(row) as TuitionRecord & { id: string } : null
  }
  const current = await Promise.all(recordIds.map(id => readInvoice(id)))
  if (recordIds.length === 1 && current[0] && !['REMOVED_FROM_MISA', 'FAILED'].includes(current[0].status)) {
    return { invoice: current[0], alreadyExists: true }
  }
  const fees = await Promise.all(recordIds.map(id => loadFee(id)))
  for (const fee of fees) {
    if (!fee) throw new InvoicePreviewError(404, 'Không tìm thấy phiếu học phí.')
    assertInvoicePeriod(fee.billingMonth, fee.billingYear)
    if (options.positiveAmountOnly && (!Number.isSafeInteger(fee.finalAmount) || fee.finalAmount <= 0)) {
      throw new InvoicePreviewError(409, 'Vòng lặp cuối tháng chỉ tạo hóa đơn cho học phí sau giảm trừ lớn hơn 0 đồng.')
    }
  }
  const legacy = await prisma.invoiceDraft.findMany({ where: { id: { in: recordIds } }, select: { status: true, lastErrorCode: true } })
  if (legacy.some(doc => ['MISA_DRAFT_CREATED', 'MISA_XML_PREPARED', 'CREATING_MISA', 'OUTCOME_UNKNOWN'].includes(doc.status) && doc.lastErrorCode !== 'PROVIDER_REJECTED')) {
    throw new InvoicePreviewError(409, 'Phiếu có yêu cầu MISA từ luồng cũ chưa được đối chiếu. Cần kiểm tra RefID cũ trước khi tạo lại để tránh trùng hóa đơn.')
  }
  const invoiceDate = suppliedInput?.invoiceDate ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
  const templates = await listInvoiceTemplates(Number(invoiceDate.slice(0, 4)), request)
  const template = body ? templates.find(t => t.id === body.templateId && t.templateNo === '2') : chooseDefaultInvoiceTemplate(templates)
  if (!template) throw new InvoicePreviewError(409, 'Chưa xác định được mẫu MISA mặc định. Chọn mẫu trong Hóa đơn điện tử hoặc cấu hình mẫu mặc định.')
  const firstFee = fees[0]
  if (!firstFee) throw new InvoicePreviewError(404, 'Không tìm thấy phiếu học phí.')
  // Học viên không có trường idCard/studentEmail/studentPhone trong schema — giữ chuỗi rỗng như dữ liệu Firestore.
  const student = await prisma.student.findUnique({ where: { id: firstFee.studentId }, select: { fullName: true, address: true } })
  const input = suppliedInput ?? validateDraftInput( { invoiceDate, templateId: template.id, revision: 0, buyer: {
    fullName: student?.fullName || firstFee.studentName, legalName: '', citizenIdNumber: '',
    address: student?.address || '', email: '', phone: '',
  } })
  const reserved = await prisma.$transaction(async tx => {
    // Khoá các phiếu (theo thứ tự id) trước khi đọc hoá đơn: hai yêu cầu cùng phiếu không thể cùng giữ chỗ RefID.
    await tx.$queryRaw`SELECT id FROM tuition_records WHERE id IN (${Prisma.join([...recordIds].sort())}) ORDER BY id FOR UPDATE`
    const snapshots = await Promise.all(recordIds.map(async id => ({
      fee: await loadFee(id, tx),
      payments: (await tx.payment.findMany({ where: { tuitionRecordId: id }, include: paymentInclude })).map(paymentDoc) as Payment[],
      invoice: await readInvoice(id, tx),
    })))
    const existing = snapshots.find(s => s.invoice && !['REMOVED_FROM_MISA', 'FAILED'].includes(s.invoice.status))
    if (existing) {
      if (recordIds.length === 1) return { invoice: existing.invoice as MisaInvoiceRecord, alreadyExists: true }
      throw new InvoicePreviewError(409, 'Có phiếu đã có hóa đơn hoặc đang chờ đối chiếu MISA.')
    }
    const sources = snapshots.map(s => {
      if (!s.fee) throw new InvoicePreviewError(404, 'Không tìm thấy phiếu học phí.')
      assertInvoicePeriod(s.fee.billingMonth, s.fee.billingYear)
      if (options.positiveAmountOnly && (!Number.isSafeInteger(s.fee.finalAmount) || s.fee.finalAmount <= 0)) {
        throw new InvoicePreviewError(409, 'Học phí đã thay đổi thành 0 đồng hoặc không hợp lệ; không tạo hóa đơn.')
      }
      return invoiceSource(s.fee, s.payments)
    })
    if (sources.some(s => s.studentId !== sources[0].studentId)) throw new InvoicePreviewError(400, 'Chỉ gộp các phiếu của cùng một học viên.')
    const at = new Date().toISOString()
    const invoice: MisaInvoiceRecord = { id: recordIds[0], recordIds, refId: randomUUID(), status: 'CREATING',
      source: sources[0], sources, template, buyer: input.buyer, invoiceDate: input.invoiceDate, revision: 0, createdAt: at, updatedAt: at, createdBy: actorId }
    const storedInvoice = { ...invoice, billingPeriods: invoiceBillingPeriods(invoice) }
    await saveInvoiceCopies(recordIds, storedInvoice, tx)
    return { invoice: storedInvoice, alreadyExists: false }
  })
  if (reserved.alreadyExists) return reserved
  await invalidateReadView('invoices')
  try {
    // The active template was validated above, before reserving these records.
    // Reuse it rather than repeating developer-API authentication and lookup.
    const created = await createMisaDraft(reserved.invoice, request)
    const invoice = { ...reserved.invoice, invoiceNumber: created.invoiceNumber, invoiceCode: '', transactionId: created.transactionId || reserved.invoice.refId, status: 'DRAFT_CREATED' as const, updatedAt: new Date().toISOString() }
    await saveInvoiceCopies(recordIds, invoice)
    await invalidateReadView('invoices')
    if (options.notifications !== false) notifyInvoiceCreated(invoice)
    return { invoice, alreadyExists: false }
  } catch (error) {
    const known = error instanceof InvoicePreviewError && !error.ambiguous
    if (!known) {
      // A lost write response may still have created the invoice. Only read its
      // existing RefID; never repeat the POST, even when lookup finds nothing.
      try {
        const status = await readMisaInvoiceStatus(reserved.invoice.refId, withMisaDeadline(request, Date.now() + 8_000))
        if (['DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX'].includes(status.status)) {
          const confirmed = { ...reserved.invoice,
            ...Object.fromEntries(Object.entries(status).filter(([, value]) => value !== undefined)),
            status: status.status, updatedAt: new Date().toISOString() }
          await saveInvoiceCopies(recordIds, confirmed)
          await invalidateReadView('invoices')
          if (options.notifications !== false) notifyInvoiceCreated(confirmed)
          return { invoice: confirmed, alreadyExists: false }
        }
      } catch { /* Keep the unresolved RefID reserved for later reconciliation. */ }
    }
    const invoice = { ...reserved.invoice, status: known ? 'FAILED' as const : 'OUTCOME_UNKNOWN' as const,
      lastErrorMessage: error instanceof InvoicePreviewError ? error.message : 'Chưa xác định được kết quả MISA; cần đối chiếu RefID.', updatedAt: new Date().toISOString() }
    await saveInvoiceCopies(recordIds, invoice)
    await invalidateReadView('invoices')
    return { invoice, alreadyExists: false }
  }
}

export async function tryCreateAutomaticMisaDraft(recordId: string, actorId: string) {
  try {
    const result = await createTuitionMisaInvoice([recordId], actorId)
    const invoice = result.invoice as MisaInvoiceRecord
    return { enabled: true, status: invoice.status, alreadyExists: result.alreadyExists, invoice,
      refId: invoice.refId || '', transactionId: invoice.transactionId || '', message: invoice.lastErrorMessage || '' }
  } catch (error) {
    if (error instanceof InvoicePeriodError) return { enabled: false, status: 'SKIPPED_BEFORE_INVOICE_START', message: error.message }
    return { enabled: true, status: 'FAILED', message: error instanceof InvoicePreviewError ? error.message : 'Phiếu đã lưu nhưng chưa tạo được hóa đơn nháp MISA.' }
  }
}
