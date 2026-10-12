import { randomUUID } from 'node:crypto'
import { db, C, toDocs, toObj } from '../lib/firebase'
import type { Payment, TuitionRecord } from '../types/models'
import { InvoicePreviewError, invoiceSource, listInvoiceTemplates, createMisaDraft } from './misaInvoicePreview'

const invoices = 'misaInvoices'
const now = () => new Date().toISOString()

function invoiceDateInVietnam(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** Create one unpublished MISA draft after a tuition record is fully paid. */
export async function createAutomaticMisaDraft(recordId: string, actorId: string, request: typeof fetch = fetch) {
  const recordRef = db.collection(C.TUITION_RECORDS).doc(recordId)
  const paymentQuery = db.collection(C.PAYMENTS).where('tuitionRecordId', '==', recordId)
  const draftRef = db.collection(invoices).doc(recordId)
  const [recordSnapshot, paymentSnapshot, currentDraft] = await Promise.all([
    recordRef.get(), paymentQuery.get(), draftRef.get(),
  ])
  if (!recordSnapshot.exists) throw new InvoicePreviewError(404, 'Không tìm thấy phiếu học phí để lập hóa đơn.')
  const record = toObj<TuitionRecord>(recordSnapshot)
  const payments = toDocs<Payment>(paymentSnapshot)
  const source = invoiceSource(record, payments)
  if (currentDraft.exists && currentDraft.data()?.status !== 'REMOVED_FROM_MISA') {
    return { status: currentDraft.data()?.status || 'UNKNOWN', alreadyExists: true }
  }

  const year = Number(invoiceDateInVietnam().slice(0, 4))
  const templates = await listInvoiceTemplates(year, request)
  const template = templates.find(item => item.templateNo === '2')
  if (!template) throw new InvoicePreviewError(409, 'MISA không có mẫu hóa đơn bán hàng đang hoạt động để tạo nháp.')

  const studentSnapshot = await db.collection(C.STUDENTS).doc(source.studentId).get()
  const student = studentSnapshot.data()
  const buyer = {
    fullName: student?.fullName || source.studentName, legalName: '',
    citizenIdNumber: student?.idCard || '', address: student?.address || '',
    email: student?.studentEmail || '', phone: student?.studentPhone || '',
  }

  const reservation = await db.runTransaction(async tx => {
    const [latestRecord, latestPayments, latestDraft] = await Promise.all([
      tx.get(recordRef), tx.get(paymentQuery), tx.get(draftRef),
    ])
    if (!latestRecord.exists) throw new InvoicePreviewError(404, 'Không tìm thấy phiếu học phí để lập hóa đơn.')
    const latestSource = invoiceSource(toObj<TuitionRecord>(latestRecord), toDocs<Payment>(latestPayments))
    if (latestDraft.exists && latestDraft.data()?.status !== 'REMOVED_FROM_MISA') {
      throw new InvoicePreviewError(409, 'Phiếu này đã có hóa đơn MISA hoặc đang được xử lý.')
    }
    const at = now()
    const invoice = { id: recordId, recordIds: [recordId], refId: randomUUID(), status: 'CREATING',
      source: latestSource, template, buyer, invoiceDate: invoiceDateInVietnam(), createdAt: at,
      updatedAt: at, createdBy: actorId }
    tx.set(draftRef, invoice)
    return invoice
  })

  // MISA API used here only creates a draft. It has no sign, issue, or tax-authority action.
  const created = await createMisaDraft(reservation, request)
  const invoice = { ...reservation, ...created, status: 'DRAFT_CREATED', updatedAt: now() }
  await draftRef.set(invoice)
  return { status: 'DRAFT_CREATED', alreadyExists: false, invoice }
}

export async function tryCreateAutomaticMisaDraft(recordId: string, actorId: string) {
  try {
    return await createAutomaticMisaDraft(recordId, actorId)
  } catch (error: any) {
    const message = error instanceof InvoicePreviewError ? error.message : 'Không tạo được hóa đơn nháp trên MISA.'
    console.error('[misa-auto-draft] Failed for tuition record:', recordId, message)
    return { status: 'FAILED', alreadyExists: false, message }
  }
}
