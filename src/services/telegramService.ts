import { waitUntil } from '@vercel/functions'
import type { MisaInvoiceRecord, InvoiceSource } from './misaInvoicePreview'

export function telegramConfigStatus() {
  const missing = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'].filter(key => !process.env[key]?.trim())
  return { configured: missing.length === 0, missing }
}

async function telegramCall(method: 'getMe' | 'getChat' | 'sendMessage', body: Record<string, unknown>, request: typeof fetch) {
  if (!telegramConfigStatus().configured) return { ok: false, errorCode: 'NOT_CONFIGURED', result: undefined as any }
  try {
    const response = await request(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN!.trim()}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000), redirect: 'error',
    })
    const data = await response.json() as any
    if (!response.ok || data.ok !== true) return { ok: false, errorCode: `HTTP_${response.status}`, result: undefined }
    return { ok: true, result: data.result, errorCode: undefined }
  } catch {
    // Raw fetch errors may include the secret bot token in their URL.
    return { ok: false, errorCode: 'NETWORK_ERROR', result: undefined }
  }
}

export async function checkTelegramConnection(request: typeof fetch = fetch) {
  const config = telegramConfigStatus()
  if (!config.configured) return { ...config, state: 'NOT_CONFIGURED' }
  const bot = await telegramCall('getMe', {}, request)
  if (!bot.ok) return { ...config, state: 'BOT_ERROR', errorCode: bot.errorCode }
  const chat = await telegramCall('getChat', { chat_id: process.env.TELEGRAM_CHAT_ID!.trim() }, request)
  if (!chat.ok) return { ...config, state: 'CHAT_ERROR', errorCode: chat.errorCode }
  return { ...config, state: 'CONNECTED', botUsername: bot.result?.username, chatType: chat.result?.type }
}

export async function sendTelegramMessage(text: string, request: typeof fetch = fetch) {
  const result = await telegramCall('sendMessage', {
    chat_id: process.env.TELEGRAM_CHAT_ID?.trim(), text,
    link_preview_options: { is_disabled: true },
  }, request)
  return { sent: result.ok, errorCode: result.errorCode, messageId: result.result?.message_id }
}

export function invoiceTelegramMessage(invoice: MisaInvoiceRecord) {
  const sources = invoice.sources?.length ? invoice.sources : [invoice.source]
  const money = (amount: number) => amount.toLocaleString('vi-VN') + ' đ'
  return [
    '🧾 HÓA ĐƠN MỚI — CHƯA PHÁT HÀNH',
    `Học viên: ${invoice.source.studentName.slice(0, 100)}`,
    `Ngày hóa đơn: ${invoice.invoiceDate.split('-').reverse().join('/')}`,
    ...sources.map(s => `• ${s.className.slice(0, 80)} — kỳ ${s.month}/${s.year}: ${money(s.finalAmount)}`),
    `Tổng tiền: ${money(sources.reduce((total, source) => total + source.finalAmount, 0))}`,
    `Số hóa đơn: ${invoice.invoiceNumber || 'Chưa cấp số'}`,
    `RefID: ${invoice.refId}`,
    'https://qlhv.cqt.vn/tuition/invoices',
  ].join('\n')
}

function scheduleNotification(text: string | Promise<string>, refId?: string) {
  if (!telegramConfigStatus().configured) return
  try {
    const send = typeof text === 'string' ? sendTelegramMessage(text) : text.then(message => sendTelegramMessage(message))
    const task = send.then(result => {
      if (!result.sent) console.warn('[Telegram] invoice notification failed', { refId, code: result.errorCode })
    }).catch(() => { console.warn('[Telegram] invoice notification failed') })
    // Preserve background delivery on Vercel without delaying the API response.
    waitUntil(task)
  } catch { console.warn('[Telegram] could not schedule invoice notification') }
}

export function notifyInvoiceCreated(invoice: MisaInvoiceRecord) {
  if (invoice.status !== 'DRAFT_CREATED' || !telegramConfigStatus().configured) return
  try { scheduleNotification(invoiceTelegramMessage(invoice), invoice.refId) }
  catch { console.warn('[Telegram] could not format invoice notification') }
}

type FailureSource = Pick<InvoiceSource, 'studentName' | 'className' | 'month' | 'year' | 'finalAmount'>
export interface InvoiceCreationFailure {
  recordIds: string[]
  refId?: string
  reason: string
  outcomeUnknown?: boolean
  /** Lỗi tạm thời của MISA, hoá đơn lưu FAILED → cron tự tạo lại (services/misaInvoiceRetry.ts) */
  autoRetry?: boolean
  sources?: FailureSource[]
}

export function invoiceFailureTelegramMessage(failure: InvoiceCreationFailure) {
  let reason = failure.reason
  for (const [key, value] of Object.entries(process.env)) {
    if (/password|secret|token/i.test(key) && value && value.trim().length >= 4) {
      reason = reason.split(value.trim()).join('[ẩn]')
    }
  }
  reason = reason.replace(/[\x00-\x1f]/g, ' ').slice(0, 500)
  return [
    failure.outcomeUnknown ? '⚠️ CHƯA XÁC ĐỊNH KẾT QUẢ TẠO HÓA ĐƠN' : '❌ TẠO HÓA ĐƠN KHÔNG THÀNH CÔNG',
    ...(failure.sources || []).slice(0, 20).map(s =>
      `• ${s.studentName.slice(0, 80)} — ${s.className.slice(0, 80)} — kỳ ${s.month}/${s.year}: ${s.finalAmount.toLocaleString('vi-VN')} đ`),
    `Lý do: ${reason}`,
    `Mã phiếu: ${failure.recordIds.slice(0, 20).join(', ')}`,
    ...(failure.refId ? [`RefID: ${failure.refId}`] : []),
    ...(failure.outcomeUnknown ? ['Cần đối chiếu RefID trên MISA trước khi tạo lại để tránh trùng hóa đơn.'] : []),
    'https://qlhv.cqt.vn/tuition/invoices',
  ].join('\n').slice(0, 4000)
}

/**
 * Lỗi tạo hóa đơn được gom trong FAILURE_BATCH_MS rồi gửi MỘT tin: tick / tính học phí hàng loạt khi MISA lỗi không còn
 * ra hàng chục tin lẻ. Chỉ một lỗi trong khoảng đó thì gửi tin chi tiết như cũ.
 */
const FAILURE_BATCH_MS = 60_000
let pendingFailures: InvoiceCreationFailure[] = []
let pendingLoads: Promise<void>[] = []
let failureTimer: NodeJS.Timeout | null = null

/** Giờ cron tự tạo lại (mỗi 15 phút, sau khi lỗi được ít nhất 10 phút) — dạng HH:MM giờ Việt Nam. */
export function nextAutoRetryTime(now = Date.now()) {
  const quarter = 15 * 60_000
  const at = Math.ceil((now + 10 * 60_000) / quarter) * quarter
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at))
}

function redactReason(reason: string) {
  for (const [key, value] of Object.entries(process.env)) {
    if (/password|secret|token/i.test(key) && value && value.trim().length >= 4) reason = reason.split(value.trim()).join('[ẩn]')
  }
  return reason.replace(/[\x00-\x1f]/g, ' ').slice(0, 300)
}

export function invoiceFailureBatchMessage(failures: InvoiceCreationFailure[], now = Date.now()) {
  if (failures.length === 1) {
    const [only] = failures
    const text = invoiceFailureTelegramMessage(only)
    return only.autoRetry ? text.replace('\nhttps://qlhv.cqt.vn/tuition/invoices', `\nHệ thống sẽ tự tạo lại lúc ${nextAutoRetryTime(now)}.\nhttps://qlhv.cqt.vn/tuition/invoices`) : text
  }
  const line = (f: InvoiceCreationFailure) => {
    const s = f.sources?.[0]
    const who = s ? `${s.studentName.slice(0, 60)} — ${s.className.slice(0, 60)} — kỳ ${s.month}/${s.year}: ${s.finalAmount.toLocaleString('vi-VN')} đ`
      : `Phiếu ${f.recordIds.slice(0, 3).join(', ')}`
    return `• ${who}${f.refId && f.outcomeUnknown ? ` (RefID ${f.refId})` : ''}`
  }
  const unknown = failures.filter(f => f.outcomeUnknown)
  const failed = failures.filter(f => !f.outcomeUnknown)
  const auto = failed.filter(f => f.autoRetry), manual = failed.filter(f => !f.autoRetry)
  // Gom theo lý do: thường cả loạt cùng một lỗi (vd. MISA quá tải).
  const reasons = new Map<string, number>()
  for (const f of failures) { const r = redactReason(f.reason); reasons.set(r, (reasons.get(r) || 0) + 1) }
  const section = (title: string, list: InvoiceCreationFailure[]) => list.length
    ? ['', title, ...list.slice(0, 15).map(line), ...(list.length > 15 ? [`… và ${list.length - 15} phiếu khác`] : [])] : []
  return [
    `❌ ${failures.length} HÓA ĐƠN CHƯA TẠO ĐƯỢC`,
    ...[...reasons].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => `Lý do (${count}): ${reason}`),
    ...section(`🔁 Sẽ tự tạo lại lúc ${nextAutoRetryTime(now)}: ${auto.length}`, auto),
    ...section(`✋ Cần kiểm tra và tạo lại bằng tay: ${manual.length}`, manual),
    ...section(`⚠️ Chưa xác định kết quả — đối chiếu RefID trên MISA trước khi tạo lại: ${unknown.length}`, unknown),
    '',
    'https://qlhv.cqt.vn/tuition/invoices',
  ].join('\n').slice(0, 4000)
}

/** Gửi ngay các lỗi đang gom (cũng dùng trong kiểm thử). */
export async function flushInvoiceFailureNotifications(request: typeof fetch = fetch) {
  if (failureTimer) { clearTimeout(failureTimer); failureTimer = null }
  await Promise.all(pendingLoads)
  const failures = pendingFailures
  pendingFailures = []; pendingLoads = []
  if (!failures.length) return { sent: false, count: 0 }
  const result = await sendTelegramMessage(invoiceFailureBatchMessage(failures), request)
  if (!result.sent) console.warn('[Telegram] invoice failure notification failed', { count: failures.length, code: result.errorCode })
  return { sent: result.sent, count: failures.length }
}

export function notifyInvoiceCreationFailed(failure: InvoiceCreationFailure, loadSources?: () => Promise<FailureSource[]>) {
  if (!telegramConfigStatus().configured) return
  try {
    if (loadSources) {
      pendingLoads.push(loadSources().catch(() => []).then(sources => { pendingFailures.push({ ...failure, sources }) }))
    } else pendingFailures.push(failure)
    if (!failureTimer) {
      failureTimer = setTimeout(() => {
        failureTimer = null
        flushInvoiceFailureNotifications().catch(() => console.warn('[Telegram] invoice failure notification failed'))
      }, FAILURE_BATCH_MS)
    }
  } catch { console.warn('[Telegram] could not queue invoice failure notification') }
}
