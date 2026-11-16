import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma, type Tx } from '../lib/db'
import { tuitionRecordDoc, tuitionRecordInclude } from '../lib/docs'
import { listInvoiceEntries, mergeInvoiceFields, readInvoice } from './misaInvoiceStore'
import { createTuitionMisaInvoice } from './misaAutoDraft'
import { readMisaInvoiceStatus } from './misaInvoicePreview'
import { assertInvoicePeriod } from './invoiceEligibility'
import { sendTelegramMessage } from './telegramService'
import { invalidateReadView } from './readViews'
import { withMisaDeadline } from './misaRequestDeadline'

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

// ─── Lưu trữ lượt chạy ────────────────────────────────────────
// Một lượt = tài liệu { ...data, status, leaseToken, leaseUntil } như trên Firestore; cột riêng chỉ cho trạng thái/lease.
type RunDoc = Record<string, any>
const ACTIVE = ['INITIALIZING', 'RUNNING', 'REPORT_PENDING']

function runFromRow(row: { status: string; leaseToken: string; leaseUntil: bigint; data: Prisma.JsonValue }): RunDoc {
  return { ...(row.data as object), status: row.status, leaseToken: row.leaseToken, leaseUntil: Number(row.leaseUntil) }
}

/** Khoá và đọc lượt chạy trong transaction (undefined nếu chưa có). */
async function lockRun(tx: Tx, id: string): Promise<RunDoc | undefined> {
  const [row] = await tx.$queryRaw<{ status: string; leaseToken: string; leaseUntil: bigint; data: Prisma.JsonValue }[]>`
    SELECT status, "leaseToken", "leaseUntil", data FROM monthly_invoice_runs WHERE id = ${id} FOR UPDATE`
  return row ? runFromRow(row) : undefined
}

async function writeRun(tx: Tx, id: string, doc: RunDoc) {
  const { status, leaseToken, leaseUntil, ...data } = doc
  const fields = { status: String(status ?? ''), leaseToken: String(leaseToken ?? ''), leaseUntil: BigInt(Math.trunc(Number(leaseUntil) || 0)),
    data: data as Prisma.InputJsonValue }
  await tx.monthlyInvoiceRun.upsert({ where: { id }, create: { id, ...fields }, update: fields })
}

export function createMonthlyInvoiceReconciler(dependencies: {
  createInvoice?: typeof createTuitionMisaInvoice; readStatus?: typeof readMisaInvoiceStatus
  sendTelegram?: typeof sendTelegramMessage; invalidate?: typeof invalidateReadView; clock?: () => number
} = {}) {
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
      prisma.tuitionRecord.findMany({ where: { billingMonth: month, billingYear: year }, include: tuitionRecordInclude }),
      // Include grouped and older invoice documents without billingPeriods metadata.
      listInvoiceEntries(),
    ])
    return { month, year, cutoff, ...buildMonthlyInvoiceEntries(fees.map(fee => ({ id: fee.id, data: tuitionRecordDoc(fee) })), invoices, cutoff) }
  }

  async function start(now = new Date(clock())) {
    const schedule = monthlyInvoiceSchedule(now)
    if (!schedule.due) return { started: false, reason: 'NOT_DUE' }
    const id = schedule.period
    const token = randomUUID()
    let claimed: boolean
    try {
      claimed = await prisma.$transaction(async tx => {
        const current = await lockRun(tx, id)
        if (current && (current.status !== 'INITIALIZING' || current.leaseUntil > clock())) return false
        await writeRun(tx, id, { ...current, month: schedule.month, year: schedule.year, cutoff: schedule.cutoff,
          startedAt: current?.startedAt || iso(), status: 'INITIALIZING', leaseToken: token, leaseUntil: clock() + LEASE_MS })
        return true
      })
    } catch (error: any) {
      // Hai tiến trình cùng tạo lượt mới: dòng thứ hai vi phạm khoá chính.
      if (error?.code === 'P2002') return { started: false, reason: 'ALREADY_STARTED' }
      throw error
    }
    if (!claimed) return { started: false, reason: 'ALREADY_STARTED' }
    await initialize(id, token)
    return { started: true, period: schedule.period }
  }

  async function initialize(id: string, token: string) {
    const run = runFromRow(await prisma.monthlyInvoiceRun.findUniqueOrThrow({ where: { id } }))
    const snapshot = await preview(run.month, run.year)
    // Deterministic item IDs allow initialization to resume after an interrupted batch.
    await prisma.$transaction(async tx => {
      for (const entry of snapshot.entries) {
        const fields = { status: entry.status, data: entry as unknown as Prisma.InputJsonValue }
        await tx.monthlyInvoiceRunItem.upsert({ where: { runId_id: { runId: id, id: entry.id } }, create: { runId: id, id: entry.id, ...fields }, update: fields })
      }
    }, { timeout: 60_000 })
    await prisma.$transaction(async tx => {
      const current = await lockRun(tx, id)
      if (current?.leaseToken !== token) return
      await writeRun(tx, id, { ...current, status: 'RUNNING', total: snapshot.entries.length, excludedAfterCutoff: snapshot.excludedAfterCutoff,
        leaseToken: '', leaseUntil: 0, updatedAt: iso() })
    })
  }

  async function reconcile(entry: Entry, run: any, period: string, recovering: boolean) {
    const feeRow = await prisma.tuitionRecord.findUnique({ where: { id: entry.id }, include: tuitionRecordInclude })
    const fee = feeRow ? tuitionRecordDoc(feeRow) : undefined
    if (!fee || fee.billingMonth !== run.month || fee.billingYear !== run.year) return { status: 'SKIPPED_CHANGED', reason: 'Phiếu đã xóa hoặc thay đổi kỳ học phí.' }
    if (fee.finalAmount === 0) return { status: 'SKIPPED_ZERO', reason: 'Phiếu 0 đồng / miễn toàn bộ học phí.' }
    if (!Number.isSafeInteger(fee.finalAmount) || fee.finalAmount < 0) return { status: 'REVIEW', reason: 'Số tiền không hợp lệ.' }
    const direct = await readInvoice(entry.id)
    const linkedId = !direct && entry.linkedInvoiceId ? entry.linkedInvoiceId : entry.id
    let invoice = direct ?? (entry.linkedInvoiceId ? await readInvoice(entry.linkedInvoiceId) : null) ?? undefined
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
        const ids = Array.from(new Set([linkedId, entry.id, ...(invoice.recordIds || [])])) as string[]
        await prisma.$transaction(async tx => {
          for (const id of ids) {
            const copy = await tx.misaInvoice.findUnique({ where: { id }, select: { refId: true } })
            if (copy?.refId === invoice!.refId) await mergeInvoiceFields(id, { ...fields, updatedAt: iso() }, tx)
          }
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
      if (confirmed.has(invoice!.status)) return resultForConfirmed()
      return { status: invoice!.status === 'FAILED' ? 'FAILED' : 'REVIEW', refId: invoice!.refId || '',
        reason: invoice!.lastErrorMessage || 'MISA chưa xác nhận kết quả; không tự động tạo lại.' }
    } catch (error) {
      return { status: 'FAILED', reason: error instanceof Error ? error.message.slice(0, 300) : 'Chưa tạo được hóa đơn.' }
    }
  }

  async function tick() {
    // Catch up if the 07:00 trigger was missed. Never start a new run on another date.
    await start()
    const active = await prisma.monthlyInvoiceRun.findFirst({ where: { status: { in: ACTIVE } }, select: { id: true } })
    if (!active) return { processed: 0, state: 'IDLE' }
    const id = active.id
    const token = randomUUID()
    const run = await prisma.$transaction(async tx => {
      const data = (await lockRun(tx, id))!
      if (data.leaseUntil > clock() || !ACTIVE.includes(data.status)) return null
      await writeRun(tx, id, { ...data, leaseToken: token, leaseUntil: clock() + LEASE_MS })
      return data
    })
    if (!run) return { processed: 0, state: 'BUSY' }
    const save = async (patch: Record<string, unknown>) => prisma.$transaction(async tx => {
      const current = await lockRun(tx, id)
      if (current?.leaseToken === token) await writeRun(tx, id, { ...current, ...patch, updatedAt: iso() })
    })
    const updateItem = async (itemId: string, patch: Record<string, unknown>) => {
      const item = await prisma.monthlyInvoiceRunItem.findUniqueOrThrow({ where: { runId_id: { runId: id, id: itemId } } })
      const data = { ...(item.data as object), ...patch } as Record<string, unknown>
      await prisma.monthlyInvoiceRunItem.update({ where: { runId_id: { runId: id, id: itemId } },
        data: { status: String(data.status ?? item.status), data: data as Prisma.InputJsonValue } })
    }
    try {
      if (run.status === 'INITIALIZING') { await initialize(id, token); return { processed: 0, state: 'INITIALIZED' } }
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
      // One provider operation per invocation keeps each worker call short.
      const pending = await prisma.monthlyInvoiceRunItem.findFirst({ where: { runId: id, status: { in: ['PENDING', 'PROCESSING'] } } })
      if (pending) {
        const entry = { ...(pending.data as object), status: pending.status } as Entry
        await updateItem(pending.id, { status: 'PROCESSING', processingAt: iso() })
        const outcome = await reconcile(entry, run, id, entry.status === 'PROCESSING')
        await updateItem(pending.id, { ...outcome, finishedAt: iso() })
        return { processed: 1, state: 'RUNNING' }
      }
      const all = await prisma.monthlyInvoiceRunItem.findMany({ where: { runId: id } })
      const reconciledAt = iso()
      const report = monthlyInvoiceReport({ ...run, reconciledAt }, all.map(item => ({ ...(item.data as object), status: item.status })))
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
    return !!(await prisma.monthlyInvoiceRun.findFirst({ where: { status: { in: ACTIVE } }, select: { id: true } }))
  }
  return { start, tick, preview, hasWork }
}

export const monthlyInvoiceReconciler = createMonthlyInvoiceReconciler()
