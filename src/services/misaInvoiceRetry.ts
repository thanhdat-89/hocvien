import { prisma } from '../lib/db'
import { invoiceDoc } from './misaInvoiceStore'
import { chooseDefaultInvoiceTemplate, createTuitionMisaInvoice } from './misaAutoDraft'
import { listInvoiceTemplates } from './misaInvoicePreview'
import { isTransientMisaFailure } from './misaRateLimit'
import { sendTelegramMessage } from './telegramService'

/**
 * Cron mỗi 15 phút: tạo lại hoá đơn MISA ở trạng thái FAILED do lỗi TẠM THỜI của MISA (quá tải 429, mất kết nối, lỗi máy chủ).
 * Chỉ FAILED — MISA đã từ chối hoặc chưa nhận yêu cầu — nên tạo lại không thể trùng. "Không rõ kết quả" (OUTCOME_UNKNOWN)
 * và lỗi dữ liệu (sai thông tin người mua, mẫu…) không bao giờ tự tạo lại. Tối đa 5 lần mỗi hoá đơn, chỉ lỗi trong 3 ngày gần đây.
 * Giữ nguyên mẫu + người mua đã chọn lần trước. Chỉ báo Telegram khi có hoá đơn cần người xử lý: dừng tự thử lại
 * (đủ 5 lần / lỗi dữ liệu) hoặc không rõ kết quả. Tạo lại thành công hay sẽ thử tiếp thì không cần báo.
 */
export const MAX_AUTO_RETRIES = 5
const MIN_AGE_MS = 10 * 60_000
const LOOKBACK_MS = 3 * 86400_000
const BATCH = 40

type Outcome = 'created' | 'failed' | 'exhausted' | 'unknown' | 'skipped'
interface Item { recordId: string; studentName: string; label: string; outcome: Outcome; reason?: string }

export interface RetryDependencies {
  create?: typeof createTuitionMisaInvoice
  templates?: typeof listInvoiceTemplates
  notify?: typeof sendTelegramMessage
  now?: () => number
}

const vnToday = (now: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(now))

export async function retryFailedMisaInvoices(deps: RetryDependencies = {}) {
  const create = deps.create ?? createTuitionMisaInvoice
  const templates = deps.templates ?? listInvoiceTemplates
  const notify = deps.notify ?? sendTelegramMessage
  const now = (deps.now ?? Date.now)()

  const rows = await prisma.misaInvoice.findMany({
    where: { status: 'FAILED', autoRetryCount: { lt: MAX_AUTO_RETRIES },
      updatedAt: { lt: new Date(now - MIN_AGE_MS), gt: new Date(now - LOOKBACK_MS) } },
    orderBy: { updatedAt: 'asc' }, take: BATCH * 4,
  })
  // Hoá đơn gộp có một bản sao dưới mỗi phiếu: chỉ xử lý bản đứng tên phiếu đầu tiên.
  const candidates = rows.filter(row => row.id === (row.recordIds[0] ?? row.id) && isTransientMisaFailure(row.lastErrorMessage)).slice(0, BATCH)

  const items: Item[] = []
  let defaultTemplateId: string | null | undefined
  for (const row of candidates) {
    const doc = invoiceDoc(row)
    const recordIds: string[] = row.recordIds.length ? row.recordIds : [row.id]
    const source = (Array.isArray(doc.sources) && doc.sources[0]) || doc.source || {}
    const item: Item = { recordId: row.id, studentName: String(source.studentName || 'Học viên'),
      label: `${source.className || ''} — kỳ ${source.month || '?'}/${source.year || '?'}`, outcome: 'skipped' }
    items.push(item)

    // Giữ chỗ: chỉ một lần chạy (hoặc một người) xử lý hoá đơn này; bỏ qua nếu vừa có ai đổi trạng thái.
    const claimed = await prisma.misaInvoice.updateMany({
      where: { id: { in: recordIds }, status: 'FAILED', updatedAt: row.updatedAt, autoRetryCount: row.autoRetryCount },
      data: { autoRetryCount: { increment: 1 } },
    })
    if (claimed.count === 0) { item.reason = 'Trạng thái vừa thay đổi'; continue }
    const attempt = row.autoRetryCount + 1

    try {
      let templateId = typeof doc.template?.id === 'string' && doc.template.id ? doc.template.id : ''
      if (!templateId) {
        if (defaultTemplateId === undefined) {
          defaultTemplateId = chooseDefaultInvoiceTemplate(await templates(Number(vnToday(now).slice(0, 4))))?.id ?? null
        }
        templateId = defaultTemplateId ?? ''
      }
      if (!templateId) throw new Error('Chưa xác định được mẫu MISA mặc định.')
      const body = { invoiceDate: vnToday(now), templateId, revision: 0, buyer: doc.buyer }
      const { invoice } = await create(recordIds, row.createdBy || 'auto-retry', body, fetch,
        { notifications: false, positiveAmountOnly: true })
      if (['DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX'].includes(invoice.status)) {
        item.outcome = 'created'
        await prisma.misaInvoice.updateMany({ where: { id: { in: recordIds } }, data: { autoRetryCount: 0 } })
      } else if (invoice.status === 'OUTCOME_UNKNOWN' || invoice.status === 'CREATING') {
        item.outcome = 'unknown'; item.reason = (invoice as any).lastErrorMessage
      } else {
        item.reason = (invoice as any).lastErrorMessage
        item.outcome = attempt >= MAX_AUTO_RETRIES || !isTransientMisaFailure(item.reason) ? 'exhausted' : 'failed'
      }
    } catch (error) {
      item.reason = error instanceof Error ? error.message : 'Lỗi không xác định'
      item.outcome = attempt >= MAX_AUTO_RETRIES || !isTransientMisaFailure(item.reason) ? 'exhausted' : 'failed'
    }
    // Lỗi dữ liệu (không phải lỗi tạm thời của MISA): dừng hẳn, không thử lại ở lần chạy sau.
    if (item.outcome === 'exhausted') {
      await prisma.misaInvoice.updateMany({ where: { id: { in: recordIds }, status: 'FAILED' }, data: { autoRetryCount: MAX_AUTO_RETRIES } })
    }
  }

  const count = (outcome: Outcome) => items.filter(item => item.outcome === outcome).length
  const summary = { checked: candidates.length, created: count('created'), failed: count('failed'),
    exhausted: count('exhausted'), unknown: count('unknown'), skipped: count('skipped') }
  if (summary.exhausted + summary.unknown > 0) {
    const sent = await notify(retrySummaryMessage(items)).catch(() => ({ sent: false }))
    if (!sent.sent) console.warn('[MISA auto-retry] Telegram summary not sent')
  }
  return summary
}

export function retrySummaryMessage(items: Item[]) {
  const pick = (outcome: Outcome) => items.filter(item => item.outcome === outcome)
  const line = (item: Item) => `• ${item.studentName.slice(0, 80)} — ${item.label.slice(0, 80)}${item.reason ? `: ${item.reason.slice(0, 150)}` : ''}`
  const section = (title: string, list: Item[]) => list.length ? [title, ...list.slice(0, 15).map(line), ...(list.length > 15 ? [`… và ${list.length - 15} phiếu khác`] : [])] : []
  return [
    '🔁 TỰ TẠO LẠI HÓA ĐƠN MISA — CẦN XỬ LÝ',
    ...section(`⛔ Dừng tự thử lại — cần xử lý tay: ${pick('exhausted').length}`, pick('exhausted')),
    ...section(`⚠️ Không rõ kết quả — đối chiếu RefID trên MISA trước khi tạo lại: ${pick('unknown').length}`, pick('unknown')),
    'https://qlhv.cqt.vn/tuition/invoices',
  ].join('\n').slice(0, 4000)
}
