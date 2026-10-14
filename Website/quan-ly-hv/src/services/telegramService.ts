import { waitUntil } from '@vercel/functions'
import type { MisaInvoiceRecord } from './misaInvoicePreview'

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

export function notifyInvoiceCreated(invoice: MisaInvoiceRecord) {
  if (invoice.status !== 'DRAFT_CREATED' || !telegramConfigStatus().configured) return
  try {
    const task = sendTelegramMessage(invoiceTelegramMessage(invoice)).then(result => {
      if (!result.sent) console.warn('[Telegram] invoice notification failed', { refId: invoice.refId, code: result.errorCode })
    }).catch(() => { console.warn('[Telegram] invoice notification failed') })
    // Preserve background delivery on Vercel without delaying the API response.
    waitUntil(task)
  } catch { console.warn('[Telegram] could not schedule invoice notification') }
}
