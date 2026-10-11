import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { db, C, toDocs, toObj } from '../lib/firebase'
import { requireRole } from '../middleware/auth'
import type { AuthRequest } from '../types'
import type { Payment, TuitionRecord } from '../types/models'
import {
  InvoiceDraft, InvoicePreviewError, invoiceSource, listInvoiceTemplates, previewInvoice, validateDraftInput,
} from '../services/misaInvoicePreview'

const router = Router()
router.use(requireRole('ADMIN'))
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
const draftsCollection = 'invoiceDrafts'
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

router.get('/drafts/:recordId', async (req, res, next) => {
  try {
    const id = recordId(req.params.recordId)
    const r = refs(id)
    const [record, payments, draft] = await Promise.all([r.record.get(), r.payments.get(), r.draft.get()])
    if (!record.exists) throw new InvoicePreviewError(404, 'Không tìm thấy phiếu học phí.')
    const source = invoiceSource(toObj<TuitionRecord>(record), toDocs<Payment>(payments))
    const student = await db.collection(C.STUDENTS).doc(source.studentId).get()
    const data = student.data()
    res.json({ source, draft: draft.exists ? draft.data() : null, publishingEnabled: false,
      suggestedBuyer: { fullName: data?.primaryParentName || source.studentName, legalName: '', taxCode: '',
        address: data?.address || '', email: '', phone: data?.primaryParentPhone || '' } })
  } catch (error) { next(error) }
})

router.post('/drafts/:recordId', async (req: AuthRequest, res, next) => {
  try {
    const id = recordId(req.params.recordId)
    const input = validateDraftInput(req.body)
    // Lookup current provider template, never accept client-supplied series or amounts.
    const year = Number(input.invoiceDate.slice(0, 4))
    const templates = await listInvoiceTemplates(year)
    const template = templates.find(item => item.id === input.templateId)
    if (!template || template.templateNo !== '2') throw new InvoicePreviewError(409, 'Cần chọn mẫu hóa đơn bán hàng đang hoạt động của đơn vị.')
    const r = refs(id)
    const draft = await db.runTransaction(async tx => {
      const [record, payments, old] = await Promise.all([tx.get(r.record), tx.get(r.payments), tx.get(r.draft)])
      if (!record.exists) throw new InvoicePreviewError(404, 'Không tìm thấy phiếu học phí.')
      const source = invoiceSource(toObj<TuitionRecord>(record), toDocs<Payment>(payments))
      const previous = old.exists ? old.data() as InvoiceDraft : undefined
      if (previous && previous.status !== 'LOCAL_DRAFT') throw new InvoicePreviewError(409, 'Không thể sửa hóa đơn đã chuyển khỏi trạng thái bản nháp.')
      if ((previous?.revision ?? 0) !== input.revision) throw new InvoicePreviewError(409, 'Bản nháp đã thay đổi. Đóng và mở lại để lấy phiên bản mới.')
      const at = new Date().toISOString()
      const nextDraft: InvoiceDraft = {
        id, refId: previous?.refId ?? randomUUID(), status: 'LOCAL_DRAFT', revision: input.revision + 1,
        source, template, buyer: input.buyer, invoiceDate: input.invoiceDate,
        createdAt: previous?.createdAt ?? at, updatedAt: at, createdBy: previous?.createdBy ?? req.user!.userId, updatedBy: req.user!.userId,
      }
      tx.set(r.draft, nextDraft)
      return nextDraft
    })
    req.activity = { action: draft.revision === 1 ? 'CREATE' : 'UPDATE', resourceType: 'tuition', resourceId: id,
      description: `${draft.revision === 1 ? 'Tạo' : 'Sửa'} bản nháp hóa đơn — Học viên ${draft.source.studentName} — Lớp ${draft.source.className} — tháng ${draft.source.month}/${draft.source.year}` }
    res.json({ draft, publishingEnabled: false })
  } catch (error) { next(error) }
})

router.post('/drafts/:recordId/preview', async (req: AuthRequest, res, next) => {
  try {
    const id = recordId(req.params.recordId)
    const r = refs(id)
    const draft = await db.runTransaction(async tx => {
      const [record, payments, saved] = await Promise.all([tx.get(r.record), tx.get(r.payments), tx.get(r.draft)])
      if (!record.exists || !saved.exists) throw new InvoicePreviewError(404, 'Cần lưu bản nháp trước khi xem trên mẫu MISA.')
      const data = saved.data() as InvoiceDraft
      const source = invoiceSource(toObj<TuitionRecord>(record), toDocs<Payment>(payments))
      if (data.status !== 'LOCAL_DRAFT' || data.revision !== req.body?.revision || source.fingerprint !== data.source.fingerprint) {
        throw new InvoicePreviewError(409, 'Phiếu, thanh toán hoặc bản nháp đã thay đổi. Mở lại và lưu bản nháp trước khi xem.')
      }
      return data
    })
    req.activity = { action: 'UPDATE', resourceType: 'tuition', resourceId: id,
      description: `Xem trước bản nháp hóa đơn — Học viên ${draft.source.studentName} — tháng ${draft.source.month}/${draft.source.year}` }
    res.json(await previewInvoice(draft))
  } catch (error) { next(error) }
})

router.use((error: unknown, _req: AuthRequest, res: import('express').Response, next: import('express').NextFunction) => {
  if (error instanceof InvoicePreviewError) { res.status(error.status).json({ message: error.message, publishingEnabled: false }); return }
  next(error)
})
export default router
