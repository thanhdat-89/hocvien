import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { db, C, toDocs, toObj } from '../lib/firebase'
import { requireRole } from '../middleware/auth'
import type { AuthRequest } from '../types'
import type { Payment, TuitionRecord } from '../types/models'
import { InvoicePreviewError, invoiceSource, listInvoiceTemplates, validateDraftInput, createMisaDraft, readMisaInvoiceStatus } from '../services/misaInvoicePreview'

const router = Router()
router.use(requireRole('ADMIN'))
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
const draftsCollection = 'misaInvoices'
const recordId = (value: unknown) => {
  if (typeof value !== 'string' || !value || value.includes('/') || value.length > 150) throw new InvoicePreviewError(400, 'Mã phiếu học phí không hợp lệ.')
  return value
}
const refs = (id: string) => ({
  record: db.collection(C.TUITION_RECORDS).doc(id), draft: db.collection(draftsCollection).doc(id),
  payments: db.collection(C.PAYMENTS).where('tuitionRecordId', '==', id),
})

router.get('/templates', async (req, res, next) => {
  try {
    const year = Number(req.query.year)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new InvoicePreviewError(400, 'Năm mẫu hóa đơn không hợp lệ.')
    res.json({ templates: await listInvoiceTemplates(year), publishingEnabled: false })
  } catch (error) { next(error) }
})

router.get('/invoices/statuses', async (_req, res, next) => {
  try {
    const snapshot = await db.collection(draftsCollection).get()
    const byRecordId = new Map<string, any>()
    snapshot.docs.forEach(doc => {
      const data = doc.data() as any
      for (const id of (Array.isArray(data.recordIds) && data.recordIds.length ? data.recordIds : [doc.id])) {
        byRecordId.set(id, { id, refId: data.refId,
          status: ['CREATING', 'DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX', 'REMOVED_FROM_MISA'].includes(data.status) ? data.status : 'NOT_CREATED',
          invoiceNumber: data.invoiceNumber, invoiceUrl: data.invoiceUrl, createdAt: data.createdAt, recordIds: data.recordIds })
      }
    })
    const invoices = Array.from(byRecordId.values())
    res.json({ invoices })
  } catch (error) { next(error) }
})

router.get('/invoices/group', async (req, res, next) => {
  try {
    const ids = String(req.query.recordIds || '').split(',').map(recordId)
    if (ids.length < 2 || ids.length > 20 || new Set(ids).size !== ids.length) throw new InvoicePreviewError(400, 'Chọn từ 2 đến 20 phiếu khác nhau để gộp.')
    const snapshots = await Promise.all(ids.map(async id => {
      const r = refs(id)
      const [record, payments, invoice] = await Promise.all([r.record.get(), r.payments.get(), r.draft.get()])
      if (!record.exists) throw new InvoicePreviewError(404, 'Không tìm thấy một trong các phiếu học phí đã chọn.')
      return { record: toObj<TuitionRecord>(record), payments: toDocs<Payment>(payments), invoice: invoice.exists ? invoice.data() : null }
    }))
    const sources = snapshots.map(item => invoiceSource(item.record, item.payments))
    if (sources.some(source => source.studentId !== sources[0].studentId)) throw new InvoicePreviewError(400, 'Chỉ có thể gộp các phiếu của cùng một học viên.')
    if (snapshots.some(item => item.invoice && item.invoice.status !== 'REMOVED_FROM_MISA')) throw new InvoicePreviewError(409, 'Có phiếu đã được liên kết với hóa đơn. Chỉ chọn phiếu chưa tạo hóa đơn.')
    const student = await db.collection(C.STUDENTS).doc(sources[0].studentId).get()
    const data = student.data()
    res.json({ sources, invoice: null, publishingEnabled: false,
      suggestedBuyer: { fullName: data?.fullName || sources[0].studentName, legalName: '', citizenIdNumber: data?.idCard || '',
        address: data?.address || '', email: data?.studentEmail || '', phone: data?.studentPhone || '' } })
  } catch (error) { next(error) }
})

router.get('/invoices/:recordId', async (req, res, next) => {
  try {
    const id = recordId(req.params.recordId)
    const r = refs(id)
    const [record, payments, invoice] = await Promise.all([r.record.get(), r.payments.get(), r.draft.get()])
    if (!record.exists) throw new InvoicePreviewError(404, 'Không tìm thấy phiếu học phí.')
    const source = invoiceSource(toObj<TuitionRecord>(record), toDocs<Payment>(payments))
    const student = await db.collection(C.STUDENTS).doc(source.studentId).get()
    const data = student.data()
    res.json({ source, invoice: invoice.exists ? invoice.data() : null, publishingEnabled: false,
      suggestedBuyer: { fullName: data?.fullName || source.studentName, legalName: '', citizenIdNumber: data?.idCard || '',
        address: data?.address || '', email: data?.studentEmail || '', phone: data?.studentPhone || '' } })
  } catch (error) { next(error) }
})

router.post('/invoices/:recordId/refresh-status', async (req, res, next) => {
  try {
    const id = recordId(req.params.recordId)
    const ref = db.collection(draftsCollection).doc(id)
    const current = await ref.get()
    if (!current.exists || !current.data()?.refId) throw new InvoicePreviewError(404, 'Chưa có hóa đơn MISA cho phiếu này.')
    const status = await readMisaInvoiceStatus(String(current.data()!.refId), fetch)
    const updated: any = { ...current.data(), ...status, updatedAt: new Date().toISOString() }
    const ids = Array.isArray(updated.recordIds) ? updated.recordIds as string[] : [id]
    if (status.status === 'REMOVED_FROM_MISA') {
      // A removed grouped draft must be split so any one tuition record can be invoiced again.
      const invoices = ids.map(recordId => ({ ...updated, id: recordId, recordIds: [recordId],
        invoiceNumber: null, invoiceUrl: null, transactionId: null, invoiceCode: null }))
      await Promise.all(invoices.map(invoice => db.collection(draftsCollection).doc(invoice.id).set(invoice)))
      res.json({ invoice: invoices.find(invoice => invoice.id === id), invoices })
      return
    }
    await Promise.all(ids.map(recordId => db.collection(draftsCollection).doc(recordId).set(updated)))
    res.json({ invoice: updated })
  } catch (error) { next(error) }
})

router.post('/invoices/group', async (req: AuthRequest, res, next) => {
  try {
    const ids = req.body?.recordIds
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 20) throw new InvoicePreviewError(400, 'Chọn từ 2 đến 20 phiếu để gộp hóa đơn.')
    const recordIds = ids.map(recordId)
    if (new Set(recordIds).size !== recordIds.length) throw new InvoicePreviewError(400, 'Danh sách phiếu bị trùng.')
    const input = validateDraftInput(req.body)
    const templates = await listInvoiceTemplates(Number(input.invoiceDate.slice(0, 4)))
    const template = templates.find(item => item.id === input.templateId)
    if (!template || template.templateNo !== '2') throw new InvoicePreviewError(409, 'Cần chọn mẫu hóa đơn bán hàng đang hoạt động của đơn vị.')
    const reservation = await db.runTransaction(async tx => {
      const references = recordIds.map(refs)
      const snapshots = await Promise.all(references.map(async r => {
        const [record, payments, existing] = await Promise.all([tx.get(r.record), tx.get(r.payments), tx.get(r.draft)])
        if (!record.exists) throw new InvoicePreviewError(404, 'Không tìm thấy một trong các phiếu học phí đã chọn.')
        if (existing.exists && existing.data()?.status !== 'REMOVED_FROM_MISA') throw new InvoicePreviewError(409, 'Có phiếu đã được liên kết với hóa đơn hoặc đang chờ xác minh. Hãy bỏ phiếu đó khỏi nhóm.')
        return { record: toObj<TuitionRecord>(record), payments: toDocs<Payment>(payments) }
      }))
      const sources = snapshots.map(item => invoiceSource(item.record, item.payments))
      if (sources.some(source => source.studentId !== sources[0].studentId)) throw new InvoicePreviewError(400, 'Chỉ có thể gộp các phiếu của cùng một học viên.')
      const at = new Date().toISOString()
      const invoice = { id: recordIds[0], recordIds, refId: randomUUID(), status: 'CREATING', source: sources[0], sources, template,
        buyer: input.buyer, invoiceDate: input.invoiceDate, createdAt: at, updatedAt: at, createdBy: req.user!.userId }
      references.forEach(r => tx.set(r.draft, invoice))
      return invoice
    })
    const created = await createMisaDraft(reservation, fetch)
    const invoice = { ...reservation, ...created, status: 'DRAFT_CREATED', updatedAt: new Date().toISOString() }
    await Promise.all(recordIds.map(id => refs(id).draft.set(invoice)))
    req.activity = { action: 'CREATE', resourceType: 'tuition', resourceId: recordIds[0],
      description: `Tạo hóa đơn nháp gộp ${recordIds.length} phiếu — Học viên ${reservation.source.studentName}` }
    res.status(201).json({ invoice, publishingEnabled: false, message: 'Đã tạo hóa đơn nháp gộp trực tiếp trên MISA. Chưa ký hoặc phát hành.' })
  } catch (error) { next(error) }
})

// Create a draft directly in MISA. Persist a stable RefID before the outbound call so
// concurrent requests cannot create multiple invoices for the same tuition record.
router.post('/invoices/:recordId', async (req: AuthRequest, res, next) => {
  try {
    const id = recordId(req.params.recordId)
    const input = validateDraftInput(req.body)
    const year = Number(input.invoiceDate.slice(0, 4))
    const templates = await listInvoiceTemplates(year)
    const template = templates.find(item => item.id === input.templateId)
    if (!template || template.templateNo !== '2') throw new InvoicePreviewError(409, 'Cần chọn mẫu hóa đơn bán hàng đang hoạt động của đơn vị.')
    const r = refs(id)
    const reservation = await db.runTransaction(async tx => {
      const [record, payments, existing] = await Promise.all([tx.get(r.record), tx.get(r.payments), tx.get(r.draft)])
      if (!record.exists) throw new InvoicePreviewError(404, 'Không tìm thấy phiếu học phí.')
      const source = invoiceSource(toObj<TuitionRecord>(record), toDocs<Payment>(payments))
      if (existing.exists && existing.data()?.status !== 'REMOVED_FROM_MISA') {
        const prior = existing.data() as any
        if (prior.status === 'DRAFT_CREATED' || prior.status === 'ISSUED' || prior.status === 'SENT_TO_TAX') {
          throw new InvoicePreviewError(409, `Phiếu này đã có hóa đơn MISA (${prior.status}).`)
        }
        throw new InvoicePreviewError(409, 'Yêu cầu tạo hóa đơn trước đó chưa xác định được kết quả. Hãy kiểm tra MISA trước khi thử lại.')
      }
      const at = new Date().toISOString()
      const invoice = { id, refId: randomUUID(), status: 'CREATING', source, template, buyer: input.buyer,
        invoiceDate: input.invoiceDate, createdAt: at, updatedAt: at, createdBy: req.user!.userId }
      tx.set(r.draft, invoice)
      return invoice
    })
    const created = await createMisaDraft(reservation, fetch)
    const invoice = { ...reservation, ...created, status: 'DRAFT_CREATED', updatedAt: new Date().toISOString() }
    await r.draft.set(invoice)
    req.activity = { action: 'CREATE', resourceType: 'tuition', resourceId: id,
      description: `Tạo hóa đơn nháp trên MISA — Học viên ${reservation.source.studentName} — Lớp ${reservation.source.className} — tháng ${reservation.source.month}/${reservation.source.year}` }
    res.status(201).json({ invoice, publishingEnabled: false, message: 'Đã tạo hóa đơn nháp trực tiếp trên MISA. Chưa ký hoặc phát hành.' })
  } catch (error) { next(error) }
})

router.use((error: unknown, _req: AuthRequest, res: import('express').Response, next: import('express').NextFunction) => {
  if (error instanceof InvoicePreviewError) { res.status(error.status).json({ message: error.message, publishingEnabled: false }); return }
  next(error)
})
export default router
