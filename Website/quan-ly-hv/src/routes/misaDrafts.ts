import { Router } from 'express'
import { db, C, toDocs, toObj } from '../lib/firebase'
import { requireRole } from '../middleware/auth'
import type { AuthRequest } from '../types'
import type { Payment, TuitionRecord } from '../types/models'
import { InvoicePreviewError, invoiceSource, listInvoiceTemplates, readMisaInvoiceStatus } from '../services/misaInvoicePreview'
import { chooseDefaultInvoiceTemplate, createTuitionMisaInvoice } from '../services/misaAutoDraft'
import { notifyInvoiceCreated } from '../services/telegramService'
import { getInvoiceList, invalidateReadView, invoiceBillingPeriods, validPeriod } from '../services/readViews'

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
    const templates = await listInvoiceTemplates(year)
    res.json({ templates, defaultTemplate: chooseDefaultInvoiceTemplate(templates), publishingEnabled: false })
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
          status: ['CREATING', 'OUTCOME_UNKNOWN', 'FAILED', 'DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX', 'REMOVED_FROM_MISA'].includes(data.status) ? data.status : 'NOT_CREATED',
          invoiceNumber: data.invoiceNumber, invoiceUrl: data.invoiceUrl, invoiceDate: data.invoiceDate, createdAt: data.createdAt, recordIds: data.recordIds })
      }
    })
    const invoices = Array.from(byRecordId.values())
    res.json({ invoices })
  } catch (error) { next(error) }
})

router.get('/invoices', async (req, res, next) => {
  try {
    const month = Number(req.query.month), year = Number(req.query.year)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30))
    if (!validPeriod(month, year) || !Number.isInteger(limit)) throw new InvoicePreviewError(400, 'Tháng/năm hoặc số dòng không hợp lệ.')
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined
    if (cursor && (cursor.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(cursor))) throw new InvoicePreviewError(400, 'Vị trí trang hóa đơn không hợp lệ.')
    res.json(await getInvoiceList(month, year, limit, cursor, req.query.force === 'true'))
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
    if (snapshots.some(item => item.invoice && !['REMOVED_FROM_MISA', 'FAILED'].includes(item.invoice.status))) throw new InvoicePreviewError(409, 'Có phiếu đã được liên kết với hóa đơn. Chỉ chọn phiếu chưa tạo hóa đơn.')
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
    const statusFields = Object.fromEntries(Object.entries(status).filter(([, value]) => value !== undefined))
    const updated: any = { ...current.data(), ...statusFields, billingPeriods: invoiceBillingPeriods(current.data()), updatedAt: new Date().toISOString() }
    const ids = Array.isArray(updated.recordIds) ? updated.recordIds as string[] : [id]
    if (status.status === 'REMOVED_FROM_MISA') {
      // A removed grouped draft must be split so any one tuition record can be invoiced again.
      const invoices = ids.map(recordId => ({ ...updated, id: recordId, recordIds: [recordId],
        invoiceNumber: null, invoiceUrl: null, transactionId: null, invoiceCode: null }))
      await Promise.all(invoices.map(invoice => db.collection(draftsCollection).doc(invoice.id).set(invoice)))
      await invalidateReadView('invoices')
      res.json({ invoice: invoices.find(invoice => invoice.id === id), invoices })
      return
    }
    await Promise.all(ids.map(recordId => db.collection(draftsCollection).doc(recordId).set(updated)))
    await invalidateReadView('invoices')
    if (['CREATING', 'OUTCOME_UNKNOWN'].includes(current.data()!.status) && updated.status === 'DRAFT_CREATED') {
      notifyInvoiceCreated(updated)
    }
    res.json({ invoice: updated })
  } catch (error) { next(error) }
})

router.post('/invoices/group', async (req: AuthRequest, res, next) => {
  try {
    const ids = req.body?.recordIds
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 20) throw new InvoicePreviewError(400, 'Chọn từ 2 đến 20 phiếu để gộp hóa đơn.')
    const result = await createTuitionMisaInvoice(ids.map(recordId), req.user!.userId, req.body, fetch)
    req.activity = { action: 'CREATE', resourceType: 'tuition', resourceId: ids[0], description: `Tạo hóa đơn nháp gộp ${ids.length} phiếu` }
    res.status(result.alreadyExists ? 200 : 201).json({ invoice: result.invoice, publishingEnabled: false,
      message: result.invoice.status === 'DRAFT_CREATED' ? 'Đã tạo hóa đơn nháp trực tiếp trên MISA. Chưa ký hoặc phát hành.' : (result.invoice as any).lastErrorMessage || 'Đã lưu yêu cầu tạo hóa đơn; cần kiểm tra trạng thái MISA.' })
  } catch (error) { next(error) }
})

// Create one draft directly in MISA. A stable RefID is reserved before the provider call.
router.post('/invoices/:recordId', async (req: AuthRequest, res, next) => {
  try {
    const id = recordId(req.params.recordId)
    const result = await createTuitionMisaInvoice([id], req.user!.userId, req.body, fetch)
    req.activity = { action: 'CREATE', resourceType: 'tuition', resourceId: id, description: `Tạo hóa đơn nháp trên MISA — phiếu ${id}` }
    res.status(result.alreadyExists ? 200 : 201).json({ invoice: result.invoice, publishingEnabled: false,
      message: result.invoice.status === 'DRAFT_CREATED' ? 'Đã tạo hóa đơn nháp trực tiếp trên MISA. Chưa ký hoặc phát hành.' : (result.invoice as any).lastErrorMessage || 'Đã lưu yêu cầu tạo hóa đơn; cần kiểm tra trạng thái MISA.' })
  } catch (error) { next(error) }
})

router.use((error: unknown, _req: AuthRequest, res: import('express').Response, next: import('express').NextFunction) => {
  if (error instanceof InvoicePreviewError) { res.status(error.status).json({ message: error.message, publishingEnabled: false }); return }
  next(error)
})
export default router
