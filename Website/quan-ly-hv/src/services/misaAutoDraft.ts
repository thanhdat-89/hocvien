import { randomUUID } from 'node:crypto'
import { db, C, toDocs, toObj } from '../lib/firebase'
import type { Payment, TuitionRecord } from '../types/models'
import { InvoicePreviewError, invoiceSource, listInvoiceTemplates, validateDraftInput, InvoiceTemplate, MisaInvoiceRecord } from './misaInvoicePreview'
import { prepareUnsignedInvoice } from './misaDraftGateway'

export function chooseDefaultInvoiceTemplate(templates: InvoiceTemplate[]) {
  const id = process.env.MEINVOICE_DEFAULT_TEMPLATE_ID?.trim()
  const series = process.env.MEINVOICE_DEFAULT_SERIES?.trim()
  const matches = templates.filter(t => t.templateNo === '2' && (!id || t.id === id) && (!series || t.series === series))
  return matches.length === 1 ? matches[0] : null
}

/** Shared by the invoice page and tuition actions; reserve all records before contacting MISA. */
export async function createTuitionMisaInvoice(recordIds: string[], actorId: string, body?: any, request: typeof fetch = fetch) {
  if (!recordIds.length || recordIds.length > 20 || new Set(recordIds).size !== recordIds.length) throw new InvoicePreviewError(400, 'Danh sách phiếu không hợp lệ hoặc bị trùng.')
  const suppliedInput = body ? validateDraftInput(body) : undefined
  const refs = recordIds.map(id => ({ fee: db.collection(C.TUITION_RECORDS).doc(id),
    payments: db.collection(C.PAYMENTS).where('tuitionRecordId', '==', id), invoice: db.collection('misaInvoices').doc(id) }))
  const current = await Promise.all(refs.map(r => r.invoice.get()))
  if (recordIds.length === 1 && current[0].exists && !['REMOVED_FROM_MISA', 'FAILED'].includes(current[0].data()?.status)) {
    return { invoice: current[0].data()!, alreadyExists: true }
  }
  const legacy = await Promise.all(recordIds.map(id => db.collection('invoiceDrafts').doc(id).get()))
  if (legacy.some(doc => doc.exists && ['MISA_DRAFT_CREATED', 'MISA_XML_PREPARED', 'CREATING_MISA', 'OUTCOME_UNKNOWN'].includes(doc.data()?.status) && doc.data()?.lastErrorCode !== 'PROVIDER_REJECTED')) {
    throw new InvoicePreviewError(409, 'Phiếu có yêu cầu MISA từ luồng cũ chưa được đối chiếu. Cần kiểm tra RefID cũ trước khi tạo lại để tránh trùng hóa đơn.')
  }
  const invoiceDate = suppliedInput?.invoiceDate ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
  const templates = await listInvoiceTemplates(Number(invoiceDate.slice(0, 4)), request)
  const template = body ? templates.find(t => t.id === body.templateId && t.templateNo === '2') : chooseDefaultInvoiceTemplate(templates)
  if (!template) throw new InvoicePreviewError(409, 'Chưa xác định được mẫu MISA mặc định. Chọn mẫu trong Hóa đơn điện tử hoặc cấu hình mẫu mặc định.')
  const firstFee = await refs[0].fee.get()
  if (!firstFee.exists) throw new InvoicePreviewError(404, 'Không tìm thấy phiếu học phí.')
  const student = (await db.collection(C.STUDENTS).doc(firstFee.data()!.studentId).get()).data()
  const input = suppliedInput ?? validateDraftInput( { invoiceDate, templateId: template.id, revision: 0, buyer: {
    fullName: student?.fullName || firstFee.data()!.studentName, legalName: '', citizenIdNumber: student?.idCard || '',
    address: student?.address || '', email: student?.studentEmail || '', phone: student?.studentPhone || '',
  } })
  const reserved = await db.runTransaction(async tx => {
    const snapshots = await Promise.all(refs.map(async r => ({ fee: await tx.get(r.fee), payments: await tx.get(r.payments), invoice: await tx.get(r.invoice) })))
    const existing = snapshots.find(s => s.invoice.exists && !['REMOVED_FROM_MISA', 'FAILED'].includes(s.invoice.data()?.status))
    if (existing) {
      if (recordIds.length === 1) return { invoice: existing.invoice.data()!, alreadyExists: true }
      throw new InvoicePreviewError(409, 'Có phiếu đã có hóa đơn hoặc đang chờ đối chiếu MISA.')
    }
    const sources = snapshots.map(s => {
      if (!s.fee.exists) throw new InvoicePreviewError(404, 'Không tìm thấy phiếu học phí.')
      return invoiceSource(toObj<TuitionRecord>(s.fee), toDocs<Payment>(s.payments))
    })
    if (sources.some(s => s.studentId !== sources[0].studentId)) throw new InvoicePreviewError(400, 'Chỉ gộp các phiếu của cùng một học viên.')
    const at = new Date().toISOString()
    const invoice: MisaInvoiceRecord = { id: recordIds[0], recordIds, refId: randomUUID(), status: 'CREATING',
      source: sources[0], sources, template, buyer: input.buyer, invoiceDate: input.invoiceDate, revision: 0, createdAt: at, updatedAt: at, createdBy: actorId }
    refs.forEach(r => tx.set(r.invoice, invoice))
    return { invoice, alreadyExists: false }
  })
  if (reserved.alreadyExists) return reserved
  try {
    const created = await prepareUnsignedInvoice(reserved.invoice as any, request)
    const invoice = { ...reserved.invoice, invoiceNumber: created.invoiceNo, invoiceCode: created.invoiceCode, transactionId: created.transactionId, status: 'DRAFT_CREATED' as const, updatedAt: new Date().toISOString() }
    await Promise.all(refs.map(r => r.invoice.set(invoice)))
    return { invoice, alreadyExists: false }
  } catch (error) {
    const known = error instanceof InvoicePreviewError && !error.ambiguous
    const invoice = { ...reserved.invoice, status: known ? 'FAILED' as const : 'OUTCOME_UNKNOWN' as const,
      lastErrorMessage: error instanceof InvoicePreviewError ? error.message : 'Chưa xác định được kết quả MISA; cần đối chiếu RefID.', updatedAt: new Date().toISOString() }
    await Promise.all(refs.map(r => r.invoice.set(invoice)))
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
    return { enabled: true, status: 'FAILED', message: error instanceof InvoicePreviewError ? error.message : 'Phiếu đã lưu nhưng chưa tạo được hóa đơn nháp MISA.' }
  }
}
