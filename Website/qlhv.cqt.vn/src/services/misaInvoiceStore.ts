import { Prisma, type MisaInvoice } from '@prisma/client'
import { prisma, api, toDay, type Tx } from '../lib/db'

// ─── Hoá đơn MISA dạng tài liệu Firestore cũ ──────────────────────────────
// Firestore lưu một bản sao của hoá đơn dưới mỗi phiếu học phí được gộp (doc id = id phiếu), mọi bản sao
// mang cùng trường `id` = recordIds[0]. PostgreSQL giữ đúng cách đó: mỗi dòng có khoá chính = id phiếu.

/** Dòng → tài liệu: ngày dạng chuỗi, `id` như dữ liệu Firestore (recordIds[0]). */
export function invoiceDoc(row: MisaInvoice): any {
  const doc = api(row)
  return { ...doc, id: row.recordIds[0] ?? row.id }
}

const json = (v: unknown) => (v === undefined || v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue))
const text = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v))
const date = (v: unknown) => (v ? new Date(String(v)) : undefined)

/** Tài liệu (hoặc một phần, với `partial`) → dữ liệu ghi Prisma. Trường lạ bị bỏ qua. */
function invoiceData(doc: any, partial = false): Prisma.MisaInvoiceUncheckedUpdateInput {
  const data: Prisma.MisaInvoiceUncheckedUpdateInput = {}
  const has = (key: string) => !partial || key in doc
  if (has('refId')) data.refId = String(doc.refId ?? '')
  if (has('status')) data.status = String(doc.status ?? '')
  if (has('revision')) data.revision = Number(doc.revision ?? 0)
  if (has('invoiceDate') && doc.invoiceDate) data.invoiceDate = toDay(doc.invoiceDate)!
  for (const key of ['invoiceNumber', 'invoiceCode', 'transactionId', 'invoiceUrl', 'lastErrorMessage'] as const) if (has(key)) data[key] = text(doc[key])
  if (has('recordIds')) data.recordIds = Array.isArray(doc.recordIds) ? doc.recordIds : []
  if (has('billingPeriods')) data.billingPeriods = Array.isArray(doc.billingPeriods) ? doc.billingPeriods : []
  if (has('source')) data.source = json(doc.source)
  if (has('sources')) data.sources = json(doc.sources)
  if (has('template')) data.template = json(doc.template)
  if (has('buyer')) data.buyer = json(doc.buyer)
  if (has('restoredAt')) data.restoredAt = date(doc.restoredAt) ?? null
  if (has('createdBy')) data.createdBy = String(doc.createdBy ?? '')
  if (has('createdAt') && doc.createdAt) data.createdAt = new Date(doc.createdAt)
  data.updatedAt = date(doc.updatedAt) ?? new Date()
  return data
}

export async function readInvoice(id: string, tx: Tx = prisma) {
  const row = await tx.misaInvoice.findUnique({ where: { id } })
  return row ? invoiceDoc(row) : null
}

/** Cơ sở của hoá đơn = cơ sở của học viên có phiếu được gộp (hoặc học viên trong `source`). */
async function invoiceBranchId(ids: string[], doc: any, tx: Tx): Promise<string | null> {
  const record = await tx.tuitionRecord.findFirst({ where: { id: { in: ids } }, select: { student: { select: { branchId: true } } } })
  if (record) return record.student.branchId
  const studentId = doc?.source?.studentId
  return typeof studentId === 'string'
    ? (await tx.student.findUnique({ where: { id: studentId }, select: { branchId: true } }))?.branchId ?? null
    : null
}

/** Ghi (thay toàn bộ) bản sao hoá đơn dưới từng phiếu — tương đương `doc(id).set(invoice)` cho mỗi id. */
export async function saveInvoiceCopies(ids: string[], doc: any, tx: Tx = prisma) {
  const data = { ...invoiceData(doc), branchId: await invoiceBranchId(ids, doc, tx) } as Prisma.MisaInvoiceUncheckedCreateInput
  for (const id of ids) {
    await tx.misaInvoice.upsert({ where: { id }, create: { ...data, id }, update: data })
  }
}

/** Gộp một phần trường vào bản sao hiện có — tương đương `set(fields, { merge: true })`. */
export async function mergeInvoiceFields(id: string, fields: any, tx: Tx = prisma) {
  await tx.misaInvoice.update({ where: { id }, data: invoiceData(fields, true) })
}

/** Mọi hoá đơn dạng { id: id dòng, data: tài liệu } — cho đối soát cuối tháng. */
export async function listInvoiceEntries() {
  const rows = await prisma.misaInvoice.findMany()
  return rows.map(row => ({ id: row.id, data: invoiceDoc(row) }))
}
