import { randomUUID } from 'node:crypto'
import { db as productionDb, C } from '../lib/firebase'
import { createTuitionMisaInvoice } from './misaAutoDraft'
import { readMisaInvoiceStatus } from './misaInvoicePreview'
import { assertInvoicePeriod } from './invoiceEligibility'
import { sendTelegramMessage } from './telegramService'
import { invalidateReadView } from './readViews'
import { withMisaDeadline } from './misaRequestDeadline'

const RUNS = 'monthlyInvoiceRuns'
const LEASE_MS = 120_000
const confirmed = new Set(['DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX'])
type Entry = { id: string; studentName: string; className: string; amount: number; status: string; reason: string; linkedInvoiceId: string }

export function monthlyInvoiceSchedule(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]))
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { year, month, period: `${year}-${String(month).padStart(2, '0')}`,
    due: (year > 2026 || year === 2026 && month >= 10) && day === lastDay && Number(parts.hour) >= 7,
    // 07:00 in Vietnam is 00:00 UTC on the same calendar date.
    cutoff: new Date(Date.UTC(year, month - 1, lastDay)).toISOString() }
}

export function buildMonthlyInvoiceEntries(fees: { id: string; data: any }[], invoices: { id: string; data: any }[], cutoff: string) {
  const links = new Map<string, string>()
  for (const { id, data } of invoices) {
    const ids = new Set([id, ...(Array.isArray(data.recordIds) ? data.recordIds : []),
      ...(Array.isArray(data.sources) ? data.sources.map((source: any) => source?.recordId) : []), data.source?.recordId])
    for (const feeId of ids) if (typeof feeId === 'string') links.set(feeId, id)
  }
  let excludedAfterCutoff = 0
  const entries: Entry[] = []
  for (const { id, data } of fees) {
    const createdAt = Date.parse(data.createdAt)
    if (Number.isFinite(createdAt) && createdAt > Date.parse(cutoff)) { excludedAfterCutoff++; continue }
    const validAmount = Number.isSafeInteger(data.finalAmount) && data.finalAmount >= 0
    const zero = validAmount && data.finalAmount === 0
    entries.push({ id, studentName: String(data.studentName || '').slice(0, 100), className: String(data.className || '').slice(0, 100),
      amount: validAmount ? data.finalAmount : 0, linkedInvoiceId: links.get(id) || '',
      status: zero ? 'SKIPPED_ZERO' : !validAmount || !Number.isFinite(createdAt) ? 'REVIEW' : 'PENDING',
      reason: zero ? 'Phiếu 0 đồng / miễn toàn bộ học phí.' : !validAmount ? 'Số tiền không hợp lệ.' : !Number.isFinite(createdAt) ? 'Thiếu ngày tạo phiếu để xác minh thời điểm đối chiếu.' : '' })
  }
  return { entries, excludedAfterCutoff }
}

export function monthlyInvoiceReport(run: any, entries: any[]) {
  const counts: Record<string, number> = {}
  for (const entry of entries) counts[entry.status] = (counts[entry.status] || 0) + 1
  const totalAmount = entries.filter(entry => entry.status === 'CREATED').reduce((sum, entry) => sum + entry.amount, 0)
  const localTime = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
  const summary = [
    `🧾 ĐỐI CHIẾU HÓA ĐƠN CUỐI THÁNG ${run.month}/${run.year}`,
    `Bắt đầu: ${localTime(run.startedAt)}`,
    `Hoàn tất đối chiếu: ${localTime(run.reconciledAt)}`,
    `Phiếu học phí đã kiểm tra: ${entries.length}`,
    `Phiếu đã có hóa đơn: ${counts.EXISTING || 0}`,
    `Hóa đơn chưa phát hành tạo mới: ${counts.CREATED || 0}`,
    `Tổng giá trị tạo mới: ${totalAmount.toLocaleString('vi-VN')} đ`,
    `Bỏ qua 0 đồng / miễn toàn bộ: ${counts.SKIPPED_ZERO || 0}`,
    `Bỏ qua phiếu đã thay đổi / xóa: ${counts.SKIPPED_CHANGED || 0}`,
    `Thất bại: ${counts.FAILED || 0}; cần đối chiếu: ${counts.REVIEW || 0}`,
    `Phiếu tạo sau 07:00 không thuộc vòng lặp: ${run.excludedAfterCutoff || 0}`,
    `https://qlhv.cqt.vn/tuition/invoices?month=${run.month}&year=${run.year}`,
  ].join('\n')
  const messages = [summary]
  for (const entry of entries.filter(entry => ['FAILED', 'REVIEW'].includes(entry.status))) {
    const line = `\n• ${entry.studentName} — ${entry.className}: ${String(entry.reason || 'Cần kiểm tra.').slice(0, 300)} (phiếu ${entry.id})`
    if (messages[messages.length - 1].length + line.length > 3500) messages.push(`Chi tiết đối chiếu ${run.month}/${run.year}`)
    messages[messages.length - 1] += line
  }
  return { counts, totalAmount, messages }
}

export function createMonthlyInvoiceReconciler(dependencies: {
  db?: FirebaseFirestore.Firestore; createInvoice?: typeof createTuitionMisaInvoice; readStatus?: typeof readMisaInvoiceStatus
  sendTelegram?: typeof sendTelegramMessage; invalidate?: typeof invalidateReadView; clock?: () => number
} = {}) {
  const db = dependencies.db || productionDb
  const createInvoice = dependencies.createInvoice || createTuitionMisaInvoice
  const readStatus = dependencies.readStatus || readMisaInvoiceStatus
  const sendTelegram = dependencies.sendTelegram || sendTelegramMessage
  const invalidate = dependencies.invalidate || invalidateReadView
  const clock = dependencies.clock || Date.now
  const iso = () => new Date(clock()).toISOString()

  async function preview(month: number, year: number) {
    assertInvoicePeriod(month, year)
    const cutoff = new Date(Date.UTC(year, month, 0)).toISOString()
    const [fees, invoices] = await Promise.all([
      db.collection(C.TUITION_RECORDS).where('billingMonth', '==', month).where('billingYear', '==', year).get(),
      // Include grouped and older invoice documents without billingPeriods metadata.
      db.collection('misaInvoices').get(),
    ])
    return { month, year, cutoff, ...buildMonthlyInvoiceEntries(fees.docs.map(doc => ({ id: doc.id, data: doc.data() })),
      invoices.docs.map(doc => ({ id: doc.id, data: doc.data() })), cutoff) }
  }

  async function start(now = new Date(clock())) {
    const schedule = monthlyInvoiceSchedule(now)
    if (!schedule.due) return { started: false, reason: 'NOT_DUE' }
    const ref = db.collection(RUNS).doc(schedule.period)
    const token = randomUUID()
    const claimed = await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data()
      if (current && (current.status !== 'INITIALIZING' || current.leaseUntil > clock())) return false
      tx.set(ref, { ...current, month: schedule.month, year: schedule.year, cutoff: schedule.cutoff,
        startedAt: current?.startedAt || iso(), status: 'INITIALIZING', leaseToken: token, leaseUntil: clock() + LEASE_MS })
      return true
    })
    if (!claimed) return { started: false, reason: 'ALREADY_STARTED' }
    await initialize(ref, token)
    return { started: true, period: schedule.period }
  }

  async function initialize(ref: FirebaseFirestore.DocumentReference, token: string) {
    const run = (await ref.get()).data()!
    const snapshot = await preview(run.month, run.year)
    // Deterministic item IDs allow initialization to resume after an interrupted batch.
    for (let index = 0; index < snapshot.entries.length; index += 400) {
      const batch = db.batch()
      for (const entry of snapshot.entries.slice(index, index + 400)) batch.set(ref.collection('items').doc(entry.id), entry)
      await batch.commit()
    }
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data()!
      if (current.leaseToken !== token) return
      tx.update(ref, { status: 'RUNNING', total: snapshot.entries.length, excludedAfterCutoff: snapshot.excludedAfterCutoff,
        leaseToken: '', leaseUntil: 0, updatedAt: iso() })
    })
  }

  async function reconcile(entry: Entry, run: any, period: string, recovering: boolean) {
    const feeDoc = await db.collection(C.TUITION_RECORDS).doc(entry.id).get()
    const fee = feeDoc.data()
    if (!fee || fee.billingMonth !== run.month || fee.billingYear !== run.year) return { status: 'SKIPPED_CHANGED', reason: 'Phiếu đã xóa hoặc thay đổi kỳ học phí.' }
    if (fee.finalAmount === 0) return { status: 'SKIPPED_ZERO', reason: 'Phiếu 0 đồng / miễn toàn bộ học phí.' }
    if (!Number.isSafeInteger(fee.finalAmount) || fee.finalAmount < 0) return { status: 'REVIEW', reason: 'Số tiền không hợp lệ.' }
    const doc = await db.collection('misaInvoices').doc(entry.id).get()
    const linked = !doc.exists && entry.linkedInvoiceId ? await db.collection('misaInvoices').doc(entry.linkedInvoiceId).get() : doc
    let invoice = linked.data()
    const actor = `monthly-invoices:${period}`
    const resultForConfirmed = () => ({ status: invoice!.createdBy === actor ? 'CREATED' : 'EXISTING',
      amount: invoice!.source?.finalAmount ?? fee.finalAmount, refId: invoice!.refId || '', reason: '' })
    if (invoice && confirmed.has(invoice.status)) return resultForConfirmed()
    if (invoice) {
      if (!invoice.refId || !['CREATING', 'OUTCOME_UNKNOWN'].includes(invoice.status)) {
        return { status: 'REVIEW', reason: 'Đã có liên kết hóa đơn lỗi hoặc đã xóa; cần kiểm tra trước khi tạo lại.' }
      }
      try {
        const status = await readStatus(invoice.refId, withMisaDeadline(fetch, clock() + 12000))
        if (!confirmed.has(status.status)) return { status: 'REVIEW', reason: 'MISA chưa xác nhận hóa đơn hiện hữu; không tạo lại.' }
        const fields = Object.fromEntries(Object.entries(status).filter(([, value]) => value !== undefined))
        const ids = Array.from(new Set([linked.id, entry.id, ...(invoice.recordIds || [])])) as string[]
        await db.runTransaction(async tx => {
          const refs = ids.map(id => db.collection('misaInvoices').doc(id))
          const docs = await Promise.all(refs.map(ref => tx.get(ref)))
          docs.forEach((doc, index) => { if (doc.data()?.refId === invoice!.refId) tx.set(refs[index], { ...fields, updatedAt: iso() }, { merge: true }) })
        })
        invoice = { ...invoice, ...fields }
        await invalidate('invoices')
        return resultForConfirmed()
      } catch { return { status: 'REVIEW', reason: 'Chưa đọc được kết quả theo RefID trên MISA; giữ nguyên để tránh tạo trùng.' } }
    }
    if (recovering) {
      // If the previous process reached MISA, its canonical reservation must exist.
      // Missing metadata after an interruption is treated conservatively.
      return { status: 'REVIEW', reason: 'Lượt trước bị gián đoạn, chưa có liên kết xác nhận; cần đối chiếu trước khi tạo lại.' }
    }
    try {
      const result = await createInvoice([entry.id], actor, undefined, withMisaDeadline(fetch, clock() + 40000),
        { notifications: false, positiveAmountOnly: true })
      invoice = result.invoice
      if (confirmed.has(invoice.status)) return resultForConfirmed()
      return { status: invoice.status === 'FAILED' ? 'FAILED' : 'REVIEW', refId: invoice.refId || '',
        reason: invoice.lastErrorMessage || 'MISA chưa xác nhận kết quả; không tự động tạo lại.' }
    } catch (error) {
      return { status: 'FAILED', reason: error instanceof Error ? error.message.slice(0, 300) : 'Chưa tạo được hóa đơn.' }
    }
  }

  async function tick() {
    // Catch up if the 07:00 trigger was missed. Never start a new run on another date.
    await start()
    const active = await db.collection(RUNS).where('status', 'in', ['INITIALIZING', 'RUNNING', 'REPORT_PENDING']).limit(1).get()
    if (active.empty) return { processed: 0, state: 'IDLE' }
    const ref = active.docs[0].ref
    const token = randomUUID()
    const run = await db.runTransaction(async tx => {
      const data = (await tx.get(ref)).data()!
      if (data.leaseUntil > clock() || !['INITIALIZING', 'RUNNING', 'REPORT_PENDING'].includes(data.status)) return null
      tx.update(ref, { leaseToken: token, leaseUntil: clock() + LEASE_MS })
      return data
    })
    if (!run) return { processed: 0, state: 'BUSY' }
    const save = async (patch: Record<string, unknown>) => db.runTransaction(async tx => {
      if ((await tx.get(ref)).data()?.leaseToken === token) tx.update(ref, { ...patch, updatedAt: iso() })
    })
    try {
      if (run.status === 'INITIALIZING') { await initialize(ref, token); return { processed: 0, state: 'INITIALIZED' } }
      if (run.status === 'REPORT_PENDING') {
        const index = run.reportIndex || 0
        const sent = await sendTelegram(run.reportMessages[index])
        if (!sent.sent) {
          await save({ notificationError: sent.errorCode || 'SEND_FAILED', notificationAttempts: (run.notificationAttempts || 0) + 1 })
          return { processed: 0, state: 'NOTIFICATION_RETRY' }
        }
        await save({ reportIndex: index + 1, notificationError: '', telegramMessageId: sent.messageId || null,
          ...(index + 1 === run.reportMessages.length ? { status: 'COMPLETE', completedAt: iso() } : {}) })
        return { processed: 0, state: index + 1 === run.reportMessages.length ? 'COMPLETE' : 'REPORT_PENDING' }
      }
      // One provider operation per invocation stays inside the 60-second serverless budget.
      const pending = await ref.collection('items').where('status', 'in', ['PENDING', 'PROCESSING']).limit(1).get()
      if (!pending.empty) {
        const item = pending.docs[0]
        const entry = item.data() as Entry
        await item.ref.update({ status: 'PROCESSING', processingAt: iso() })
        const outcome = await reconcile(entry, run, ref.id, entry.status === 'PROCESSING')
        await item.ref.update({ ...outcome, finishedAt: iso() })
        return { processed: 1, state: 'RUNNING' }
      }
      const all = await ref.collection('items').get()
      const reconciledAt = iso()
      const report = monthlyInvoiceReport({ ...run, reconciledAt }, all.docs.map(doc => doc.data()))
      await save({ status: 'REPORT_PENDING', reconciledAt, counts: report.counts, totalAmount: report.totalAmount,
        reportMessages: report.messages, reportIndex: 0 })
      return { processed: 0, state: 'REPORT_PENDING' }
    } catch (error) {
      await save({ lastError: error instanceof Error ? error.message.slice(0, 300) : 'WORKER_ERROR' })
      throw error
    } finally {
      await save({ leaseToken: '', leaseUntil: 0 })
    }
  }
  async function hasWork() {
    const active = await db.collection(RUNS).where('status', 'in', ['INITIALIZING', 'RUNNING', 'REPORT_PENDING']).limit(1).get()
    return !active.empty
  }
  return { start, tick, preview, hasWork }
}

export const monthlyInvoiceReconciler = createMonthlyInvoiceReconciler()
