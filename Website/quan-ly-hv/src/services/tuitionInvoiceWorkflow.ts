import { db, C, toObj, toDocs } from '../lib/firebase'
import type { TuitionRecord, Payment } from '../types/models'
import { ensureInvoiceDraftForTuitionRecord } from './invoiceDraftService'
import { InvoiceDraft, InvoicePreviewError, invoiceSource } from './misaInvoicePreview'
import { invoiceAutomationEnabled, makeInvoiceOutbox, processInvoiceOutbox } from './invoiceOutbox'

/** Called after all fee/payment writes. Failure never rolls back a saved tuition record. */
export async function runTuitionInvoiceWorkflow(recordId: string) {
  try {
    await ensureInvoiceDraftForTuitionRecord(recordId)
    const draftRef = db.collection('invoiceDrafts').doc(recordId)
    const queueRef = db.collection('invoiceOutbox').doc(recordId)
    await db.runTransaction(async tx => {
      const [saved, queued, fee, payments] = await Promise.all([
        tx.get(draftRef), tx.get(queueRef), tx.get(db.collection(C.TUITION_RECORDS).doc(recordId)),
        tx.get(db.collection(C.PAYMENTS).where('tuitionRecordId', '==', recordId)),
      ])
      if (!saved.exists || !fee.exists) return
      const draft = saved.data() as InvoiceDraft
      // Never reset a request which may already have reached the provider, including
      // historical generic PROVIDER_REJECTED states without the original response.
      if (!['LOCAL_DRAFT', 'PENDING_MISA', 'SYNC_FAILED', 'NEEDS_REVIEW'].includes(draft.status)) return
      if (['PROCESSING', 'OUTCOME_UNKNOWN', 'DONE'].includes(queued.data()?.status)) return
      const source = invoiceSource(toObj<TuitionRecord>(fee), toDocs<Payment>(payments))
      if (source.fingerprint === draft.source.fingerprint && queued.exists && queued.data()?.status !== 'BLOCKED') return
      const updated: InvoiceDraft = { ...draft, source, revision: draft.revision + 1,
        status: draft.template.id ? 'PENDING_MISA' : 'NEEDS_REVIEW', updatedAt: new Date().toISOString() }
      tx.set(draftRef, updated)
      tx.set(queueRef, makeInvoiceOutbox(updated))
    })
    let processingMessage = ''
    if (invoiceAutomationEnabled()) {
      try { await processInvoiceOutbox(recordId) } catch (error) {
        processingMessage = error instanceof InvoicePreviewError ? error.message : 'Chưa nhận được kết quả xử lý hóa đơn; cần kiểm tra hàng đợi.'
      }
    }
    const saved = await draftRef.get()
    const draft = saved.data() as InvoiceDraft | undefined
    return { enabled: invoiceAutomationEnabled(), status: draft?.status ?? 'NEEDS_REVIEW',
      message: processingMessage || draft?.lastErrorMessage || '', refId: draft?.refId ?? '', transactionId: draft?.providerInvoiceId ?? '' }
  } catch {
    return { enabled: invoiceAutomationEnabled(), status: 'NEEDS_REVIEW',
      message: 'Phiếu đã lưu nhưng chưa hoàn tất xử lý hóa đơn; cần kiểm tra hàng đợi.' }
  }
}
