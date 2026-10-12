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
    const invoices = snapshot.docs.map(doc => {
      const data = doc.data() as any
      return { id: doc.id, refId: data.refId, status: ['CREATING', 'DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX'].includes(data.status) ? data.status : 'NOT_CREATED',
        invoiceNumber: data.invoiceNumber, invoiceUrl: data.invoiceUrl, createdAt: data.createdAt }
    })
    res.json({ invoices })
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
    const updated = { ...current.data(), ...status, updatedAt: new Date().toISOString() }
    await ref.set(updated)
    res.json({ invoice: updated })
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
      if (existing.exists) {
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
