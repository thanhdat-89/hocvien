import { randomUUID } from 'node:crypto'
import { db, C, toObj, toDocs } from '../lib/firebase'
import { InvoiceDraft, InvoicePreviewError, invoiceSource } from './misaInvoicePreview'
import { MisaPreparationError, prepareUnsignedInvoice } from './misaDraftGateway'

export const invoiceAutomationEnabled = () => process.env.MEINVOICE_AUTO_PREPARE_XML === 'true'
const localEditable = (status: string) => ['LOCAL_DRAFT', 'PENDING_MISA', 'SYNC_FAILED', 'NEEDS_REVIEW'].includes(status)
export function makeInvoiceOutbox(draft: InvoiceDraft) {
  return { tuitionRecordId: draft.id, draftId: draft.id, operation: 'CREATE_UNPUBLISHED_INVOICE',
    status: draft.template.id ? 'PENDING' : 'NEEDS_REVIEW', attempts: 0,
    idempotencyKey: draft.refId, revision: draft.revision, nextRetryAt: new Date().toISOString(),
    createdAt: draft.createdAt, updatedAt: draft.updatedAt, leaseToken: '', leaseUntil: '' }
}

/** Claims exactly one saved revision; external calls never occur in Firestore transactions. */
export async function processInvoiceOutbox(id: string, provider = prepareUnsignedInvoice, expectedRevision?: number): Promise<InvoiceDraft> {
  if (!invoiceAutomationEnabled()) throw new InvoicePreviewError(503, 'Chưa bật bước tạo hóa đơn Chưa phát hành trên MISA (MEINVOICE_AUTO_PREPARE_XML).')
  const draftRef = db.collection('invoiceDrafts').doc(id)
  const queueRef = db.collection('invoiceOutbox').doc(id)
  const leaseToken = randomUUID()
  const draft = await db.runTransaction(async tx => {
    const [saved, queued, record, payments] = await Promise.all([
      tx.get(draftRef), tx.get(queueRef), tx.get(db.collection(C.TUITION_RECORDS).doc(id)),
      tx.get(db.collection(C.PAYMENTS).where('tuitionRecordId', '==', id)),
    ])
    if (!saved.exists || !queued.exists || !record.exists) throw new InvoicePreviewError(404, 'Không tìm thấy phiếu hoặc bản nháp.')
    const data = saved.data() as InvoiceDraft
    const q = queued.data()!
    if (expectedRevision !== undefined && data.revision !== expectedRevision) throw new InvoicePreviewError(409, 'Bản nháp đã thay đổi; mở lại để lấy phiên bản mới.')
    if (data.status === 'MISA_DRAFT_CREATED' || data.status === 'MISA_XML_PREPARED') return data
    if (q.status === 'PROCESSING') {
      if (q.leaseUntil > new Date().toISOString()) throw new InvoicePreviewError(409, 'Hóa đơn đang được xử lý.')
      // A crashed attempt may already have reached MISA; never resend it automatically.
      tx.update(queueRef, { status: 'OUTCOME_UNKNOWN', updatedAt: new Date().toISOString() })
      tx.update(draftRef, { status: 'OUTCOME_UNKNOWN', lastErrorMessage: 'Lần gửi trước bị gián đoạn; cần đối chiếu RefID trên MISA.' })
      return { ...data, status: 'OUTCOME_UNKNOWN' as const }
    }
    if (!['PENDING', 'RETRY'].includes(q.status) || !localEditable(data.status)) throw new InvoicePreviewError(409, 'Cần kiểm tra kết quả hoặc lưu lại bản nháp trước khi gửi.')
    if (q.nextRetryAt > new Date().toISOString()) throw new InvoicePreviewError(409, 'Chưa đến thời điểm thử lại.')
    if (q.idempotencyKey !== data.refId || q.revision !== data.revision) throw new InvoicePreviewError(409, 'Phiên bản hàng đợi không khớp bản nháp.')
    const source = invoiceSource(toObj(record) as any, toDocs(payments) as any)
    if (source.fingerprint !== data.source.fingerprint) {
      const lastErrorMessage = 'Phiếu hoặc thanh toán đã thay đổi; lưu lại bản nháp trước khi gửi.'
      tx.update(queueRef, { status: 'NEEDS_REVIEW', updatedAt: new Date().toISOString() })
      tx.update(draftRef, { status: 'NEEDS_REVIEW', lastErrorMessage })
      return { ...data, status: 'NEEDS_REVIEW' as const, lastErrorMessage }
    }
    const attempts = Number(q.attempts || 0) + 1
    tx.update(queueRef, { status: 'PROCESSING', attempts, leaseToken, leaseUntil: new Date(Date.now() + 120000).toISOString() })
    tx.update(draftRef, { status: 'CREATING_MISA', syncAttempts: attempts })
    return { ...data, status: 'CREATING_MISA' as const, syncAttempts: attempts }
  })
  if (draft.status !== 'CREATING_MISA') return draft
  let patch: Partial<InvoiceDraft>
  let queueStatus: string
  try {
    const result = await provider(draft)
    patch = { status: 'MISA_DRAFT_CREATED', providerInvoiceId: result.transactionId, providerInvoiceNo: result.invoiceNo,
      lastSyncAt: new Date().toISOString(), lastErrorCode: '', lastErrorMessage: '' }
    queueStatus = 'DONE'
  } catch (error) {
    // Keep this classification robust if a provider error crosses a module boundary.
    const providerError = error as any
    const previewError = error instanceof InvoicePreviewError
      || (providerError && typeof providerError.status === 'number' && typeof providerError.message === 'string')
    const ambiguous = !previewError || providerError.ambiguous === true
    const invalid = previewError && [400, 409].includes(Number(providerError.status))
    queueStatus = ambiguous ? 'OUTCOME_UNKNOWN' : invalid || (draft.syncAttempts ?? 0) >= 5 ? 'NEEDS_REVIEW' : 'RETRY'
    patch = { status: ambiguous ? 'OUTCOME_UNKNOWN' : queueStatus === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'SYNC_FAILED',
      lastErrorCode: typeof providerError.code === 'string' ? providerError.code : 'PREPARATION_FAILED',
      lastErrorMessage: previewError ? providerError.message : 'Không xử lý được yêu cầu; cần kiểm tra kết nối MISA.' }
  }
  // If persistence fails after the provider call, the PROCESSING lease remains and will
  // become OUTCOME_UNKNOWN rather than resending an invoice whose outcome may be known only to MISA.
  await db.runTransaction(async tx => {
    const current = await tx.get(queueRef)
    if (current.data()?.leaseToken !== leaseToken) throw new InvoicePreviewError(409, 'Phiên xử lý hóa đơn đã thay đổi.')
    tx.update(draftRef, { ...patch, updatedAt: new Date().toISOString() })
    tx.update(queueRef, { status: queueStatus, leaseToken: '', leaseUntil: '', nextRetryAt: new Date(Date.now() + 300000).toISOString(), updatedAt: new Date().toISOString() })
  })
  return { ...draft, ...patch }
}

export async function processPendingInvoices() {
  if (!invoiceAutomationEnabled()) return { enabled: false, processed: 0 }
  const snapshot = await db.collection('invoiceOutbox').where('status', 'in', ['PENDING', 'RETRY', 'PROCESSING']).orderBy('nextRetryAt').limit(10).get()
  let processed = 0
  // Bound work to the serverless request budget; remaining items stay durable for the next run.
  const deadline = Date.now() + 24000
  for (const doc of snapshot.docs) {
    const q = doc.data()
    if (q.status === 'PROCESSING' ? q.leaseUntil > new Date().toISOString() : q.nextRetryAt > new Date().toISOString()) continue
    if (Date.now() >= deadline || processed >= 1) break
    try { await processInvoiceOutbox(doc.id); processed++ } catch { /* Existing item retains its state. */ }
  }
  return { enabled: true, processed }
}
