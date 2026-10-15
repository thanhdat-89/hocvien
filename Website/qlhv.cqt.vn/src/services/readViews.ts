import { randomUUID } from 'node:crypto'
import { db, C } from '../lib/firebase'

export type ViewKind = 'privateMissing' | 'invoices' | 'tuition' | 'studentsIndex' | 'dashboard'
const MAX_AGE_MS = 15 * 60 * 1000

export async function invalidateReadView(kind: ViewKind) {
  try { await db.collection('readViewRevisions').doc(kind).set({ revision: randomUUID() }) }
  catch { console.warn('[Read views] invalidation failed', kind) }
}

export async function readView<T>(kind: ViewKind, key: string, build: () => Promise<T>, clientVersion?: string, force = false, maxAge = MAX_AGE_MS): Promise<{ data?: T; version: string; unchanged?: boolean }> {
  const revisionRef = db.collection('readViewRevisions').doc(kind)
  const revision = (await revisionRef.get()).data()?.revision || 'initial'
  const [clientRevision, clientTime] = (clientVersion || '').split(':')
  if (!force && clientRevision === revision && Date.now() - Number(clientTime) < maxAge && Number(clientTime) <= Date.now()) {
    return { unchanged: true, version: clientVersion! }
  }
  const cacheRef = db.collection('readViews').doc(`${kind}-${key}`)
  const cached = (await cacheRef.get()).data()
  if (!force && cached && cached.revision === revision && Date.now() - cached.generatedAt < maxAge) {
    return { data: cached.data as T, version: `${revision}:${cached.generatedAt}` }
  }
  const data = await build()
  const generatedAt = Date.now()
  const currentRevision = (await revisionRef.get()).data()?.revision || 'initial'
  // A concurrent mutation must prevent this snapshot from being reused.
  if (currentRevision === revision) {
    try { await cacheRef.set({ revision, generatedAt, data }) }
    catch { console.warn('[Read views] cache write failed', kind) }
  }
  return { data, version: `${revision}:${generatedAt}` }
}

export function validPeriod(month: number, year: number) {
  return Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year) && year >= 2000 && year <= 2100
}

export function invoiceBillingPeriods(invoice: any): string[] {
  const sources = invoice.sources?.length ? invoice.sources : [invoice.source]
  return [...new Set<string>(sources.filter((s: any) => s && validPeriod(s.month, s.year))
    .map((s: any) => `${s.year}-${String(s.month).padStart(2, '0')}`))]
}

export async function getMissingPrivateStudents(month: number, year: number, version?: string, force = false) {
  const period = `${year}-${String(month).padStart(2, '0')}`
  return readView('privateMissing', period, async () => {
    const [students, enrollments, sessions] = await Promise.all([
      db.collection(C.STUDENTS).select('fullName', 'gradeLevel').get(),
      db.collection(C.ENROLLMENTS).where('status', '==', 'ACTIVE').select('studentId').get(),
      db.collection(C.PRIVATE_SCHEDULES).where('sessionDate', '>=', `${period}-01`)
        .where('sessionDate', '<=', `${period}-${new Date(year, month, 0).getDate()}`).select('studentId').get(),
    ])
    const enrolled = new Set(enrollments.docs.map(doc => doc.data().studentId))
    const scheduled = new Set(sessions.docs.map(doc => doc.data().studentId))
    return students.docs.filter(doc => !enrolled.has(doc.id) && !scheduled.has(doc.id))
      .map(doc => ({ id: doc.id, fullName: String(doc.data().fullName || ''), gradeLevel: doc.data().gradeLevel ?? null }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'))
  }, version, force)
}

const statuses = new Set(['CREATING', 'OUTCOME_UNKNOWN', 'FAILED', 'DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX', 'REMOVED_FROM_MISA'])

export async function getInvoiceList(month: number, year: number, limit: number, cursor?: string, force = false) {
  const period = `${year}-${String(month).padStart(2, '0')}`
  const view = await readView('invoices', period, async () => {
    const snapshot = await db.collection('misaInvoices').where('billingPeriods', 'array-contains', period).get()
    const byRecordId = new Map<string, any>()
    // Prefer the newest copy when a grouped invoice has several linked documents.
    const documents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any))
      .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
    for (const invoice of documents) {
      if (!statuses.has(invoice.status)) continue
      const sources = invoice.sources?.length ? invoice.sources : [invoice.source]
      const linkedIds = invoice.recordIds?.length ? invoice.recordIds : [invoice.id]
      for (const source of sources) {
        const id = source?.recordId || invoice.id
        if (!source || source.month !== month || source.year !== year || !linkedIds.includes(id)) continue
        byRecordId.set(id, { id, studentId: source.studentId, studentName: source.studentName,
          className: source.className, finalAmount: source.finalAmount, status: invoice.status,
          refId: invoice.refId || '', invoiceNumber: invoice.invoiceNumber || '', invoiceUrl: invoice.invoiceUrl || '',
          invoiceDate: invoice.invoiceDate || '', createdAt: invoice.createdAt || '', recordIds: linkedIds })
      }
    }
    return Array.from(byRecordId.values()).sort((a, b) =>
      (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || b.id.localeCompare(a.id))
  }, undefined, force)
  const rows = view.data!
  let start = 0
  if (cursor) {
    let parsed: any
    try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) }
    catch { throw Object.assign(new Error('Vị trí trang hóa đơn không hợp lệ.'), { status: 400 }) }
    if (!parsed || typeof parsed.version !== 'string' || typeof parsed.id !== 'string') {
      throw Object.assign(new Error('Vị trí trang hóa đơn không hợp lệ.'), { status: 400 })
    }
    if (parsed.version !== view.version) throw Object.assign(new Error('Danh sách hóa đơn đã thay đổi. Vui lòng tải lại.'), { status: 409 })
    start = rows.findIndex(row => row.id === parsed.id) + 1
    if (start === 0) throw Object.assign(new Error('Vị trí trang hóa đơn không hợp lệ.'), { status: 400 })
  }
  const data = rows.slice(start, start + limit)
  const counts = rows.reduce((result, row) => { result[row.status] = (result[row.status] || 0) + 1; return result }, {} as Record<string, number>)
  const nextCursor = start + limit < rows.length
    ? Buffer.from(JSON.stringify({ version: view.version, id: data[data.length - 1].id })).toString('base64url') : null
  return { rows: data, total: rows.length, counts, nextCursor, version: view.version }
}
