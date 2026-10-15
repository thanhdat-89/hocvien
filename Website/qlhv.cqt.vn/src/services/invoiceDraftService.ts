import { randomUUID } from 'node:crypto'
import { db, C, toDocs, toObj } from '../lib/firebase'
import type { Payment, TuitionRecord } from '../types/models'
import { invoiceSource, InvoiceDraft, InvoiceTemplate, listInvoiceTemplates } from './misaInvoicePreview'

import { makeInvoiceOutbox } from './invoiceOutbox'

const DRAFTS = 'invoiceDrafts'
const OUTBOX = 'invoiceOutbox'

/** Local drafts need no MISA connection. Choose an active template before previewing. */
export function chooseDefaultInvoiceTemplate(templates: InvoiceTemplate[]): InvoiceTemplate | null {
  const configuredId = process.env.MEINVOICE_DEFAULT_TEMPLATE_ID?.trim()
  const configuredSeries = process.env.MEINVOICE_DEFAULT_SERIES?.trim()
  const candidates = templates.filter(item => item.templateNo === '2' && item.series)
  if (configuredId) {
    const matches = candidates.filter(item => item.id === configuredId && (!configuredSeries || item.series === configuredSeries))
    return matches.length === 1 ? matches[0] : null
  }
  if (configuredSeries) {
    const matches = candidates.filter(item => item.series === configuredSeries)
    return matches.length === 1 ? matches[0] : null
  }
  return candidates.length === 1 ? candidates[0] : null
}

const templateCache = new Map<number, { until: number; promise: Promise<{ template: InvoiceTemplate | null; error?: string }> }>()

async function resolveDefaultTemplate(year: number): Promise<{ template: InvoiceTemplate | null; error?: string }> {
  const cached = templateCache.get(year)
  if (cached && cached.until > Date.now()) return cached.promise
  const promise = (async () => {
    try {
      const template = chooseDefaultInvoiceTemplate(await listInvoiceTemplates(year, (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(3000) })))
      return template ? { template } : { template: null, error: 'Không xác định được một mẫu hóa đơn bán hàng mặc định.' }
    } catch {
      return { template: null, error: 'Không lấy được danh sách mẫu hóa đơn từ MISA. Kiểm tra cấu hình hoặc chọn mẫu trong giao diện.' }
    }
  })()
  templateCache.set(year, { until: Date.now() + 60000, promise })
  return promise
}

export function buildAutomaticInvoiceDraft(record: TuitionRecord, student: Record<string, unknown>, payments: Payment[] = [], template: InvoiceTemplate | null = null, templateError?: string): InvoiceDraft {
  const at = new Date().toISOString()
  return {
    id: record.id, refId: randomUUID(), status: template ? 'PENDING_MISA' : 'NEEDS_REVIEW', revision: 1,
    source: invoiceSource(record, payments),
    template: template ?? { id: '', name: '', series: '', templateNo: '2', isInvoiceSummary: false },
    buyer: {
      fullName: String(student.primaryParentName || record.studentName || '').trim(),
      legalName: '', taxCode: '', address: String(student.address || '').trim(), email: '',
      phone: String(student.primaryParentPhone || '').trim(),
    },
    invoiceDate: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(at)),
    createdAt: at, updatedAt: at, createdBy: 'system', updatedBy: 'system', provider: 'meinvoice', syncAttempts: 0, ...(templateError ? { lastErrorMessage: templateError } : {}),
  }
}

/** Commit the fee and its draft atomically, including free/fully discounted fees. */
export async function createTuitionWithInvoiceDraft(data: Omit<TuitionRecord, 'id'>, student: Record<string, unknown>): Promise<string> {
  const ref = db.collection(C.TUITION_RECORDS).doc()
  const year = Number(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()).slice(0, 4))
  const resolved = await resolveDefaultTemplate(year)
  const draft = buildAutomaticInvoiceDraft({ ...data, id: ref.id }, student, [], resolved.template, resolved.error)
  const batch = db.batch()
  batch.set(ref, data)
  batch.set(db.collection(DRAFTS).doc(ref.id), draft)
  batch.set(db.collection(OUTBOX).doc(ref.id), makeInvoiceOutbox(draft))
  await batch.commit()
  return ref.id
}

/** Recover a missing draft on recalculation, without replacing edited or issued drafts. */
export async function ensureInvoiceDraftForTuitionRecord(recordId: string): Promise<void> {
  const recordRef = db.collection(C.TUITION_RECORDS).doc(recordId)
  const draftRef = db.collection(DRAFTS).doc(recordId)
  const initial = await recordRef.get()
  if (!initial.exists) return
  const existingDraft = await draftRef.get()
  if (existingDraft.exists) return
  const resolved = await resolveDefaultTemplate(Number(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()).slice(0, 4)))
  await db.runTransaction(async tx => {
    const existing = await tx.get(draftRef)
    if (existing.exists) return
    const recordDoc = await tx.get(recordRef)
    if (!recordDoc.exists) return
    const record = toObj<TuitionRecord>(recordDoc)
    const studentDoc = await tx.get(db.collection(C.STUDENTS).doc(record.studentId))
    const payments = toDocs<Payment>(await tx.get(db.collection(C.PAYMENTS).where('tuitionRecordId', '==', recordId)))
    const draft = buildAutomaticInvoiceDraft(record, studentDoc.data() ?? {}, payments, resolved.template, resolved.error)
    tx.set(draftRef, draft)
    tx.set(db.collection(OUTBOX).doc(recordId), makeInvoiceOutbox(draft))
  })
}
