import { prisma } from '../lib/db'
import { sendTelegramMessage } from './telegramService'

/**
 * Theo dõi sức khỏe kết nối MISA. Mỗi lần gọi (qua misaFetch) được ghi lại:
 *  - Cửa sổ 5 phút trong bộ nhớ: tỉ lệ lỗi > 10% (ít nhất 5 lần gọi) → MỘT cảnh báo Telegram; khi hết lỗi → một tin "đã ổn định".
 *  - Đếm theo ngày, ghi gộp vào bảng misa_call_stats mỗi phút (xem GET /api/tuition/misa/health).
 * Lỗi tính vào tỉ lệ: 429, 401, 5xx, mất kết nối, chưa gửi được. 4xx khác (sai dữ liệu) và 404 không phải lỗi kết nối.
 */
export type MisaCallOutcome = 'ok' | 'http_429' | 'http_401' | 'http_5xx' | 'http_4xx' | 'network' | 'not_sent'
const FAILURE: MisaCallOutcome[] = ['http_429', 'http_401', 'http_5xx', 'network', 'not_sent']
const LABEL: Record<MisaCallOutcome, string> = {
  ok: 'thành công', http_429: 'quá tải (429)', http_401: 'hết phiên đăng nhập (401)', http_5xx: 'MISA lỗi máy chủ (5xx)',
  http_4xx: 'từ chối dữ liệu (4xx)', network: 'mất kết nối / hết giờ', not_sent: 'chưa gửi được (xếp hàng quá lâu)',
}
const WINDOW_MS = 5 * 60_000
const MIN_CALLS = 5
const FAILURE_RATE = 0.1
const FLUSH_MS = 60_000

let window: Array<{ at: number; outcome: MisaCallOutcome }> = []
let alerting = false
let unflushed = new Map<string, number>()   // `${day}|${outcome}` → số lần chưa ghi DB
let flushTimer: NodeJS.Timeout | null = null
let notify: (text: string) => Promise<unknown> = text => sendTelegramMessage(text)

export const outcomeOfStatus = (status: number): MisaCallOutcome =>
  status === 429 ? 'http_429' : status === 401 ? 'http_401' : status >= 500 ? 'http_5xx' : status >= 400 && status !== 404 ? 'http_4xx' : 'ok'

const vnDay = (at: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(at))

function summarize(now: number) {
  window = window.filter(item => now - item.at < WINDOW_MS)
  const byOutcome: Partial<Record<MisaCallOutcome, number>> = {}
  for (const item of window) byOutcome[item.outcome] = (byOutcome[item.outcome] || 0) + 1
  const failures = window.filter(item => FAILURE.includes(item.outcome)).length
  return { calls: window.length, failures, byOutcome }
}

export function recordMisaCall(outcome: MisaCallOutcome, now = Date.now()) {
  window.push({ at: now, outcome })
  const key = `${vnDay(now)}|${outcome}`
  unflushed.set(key, (unflushed.get(key) || 0) + 1)
  if (!flushTimer) {
    flushTimer = setTimeout(() => { flushTimer = null; flushMisaCallStats().catch(() => undefined) }, FLUSH_MS)
    flushTimer.unref?.()
  }
  evaluate(now)
}

function evaluate(now: number) {
  const { calls, failures, byOutcome } = summarize(now)
  const breakdown = (Object.entries(byOutcome) as Array<[MisaCallOutcome, number]>)
    .sort((a, b) => b[1] - a[1]).map(([outcome, count]) => `• ${LABEL[outcome]}: ${count}`)
  if (!alerting && calls >= MIN_CALLS && failures / calls > FAILURE_RATE) {
    alerting = true
    void notify([
      '🚨 KẾT NỐI MISA ĐANG LỖI NHIỀU',
      `${failures}/${calls} yêu cầu lỗi trong 5 phút qua (${Math.round(failures / calls * 100)}%).`,
      ...breakdown,
      'Hóa đơn lỗi do MISA quá tải / mất kết nối sẽ được tự tạo lại mỗi 15 phút. Nếu kéo dài, kiểm tra trạng thái MISA hoặc tài khoản meInvoice.',
    ].join('\n')).catch(() => undefined)
  } else if (alerting && (failures === 0 || (calls >= MIN_CALLS && failures / calls <= FAILURE_RATE))) {
    alerting = false
    void notify(['✅ KẾT NỐI MISA ĐÃ ỔN ĐỊNH LẠI', `5 phút qua: ${calls} yêu cầu, ${failures} lỗi.`].join('\n')).catch(() => undefined)
  }
}

/** Ghi số lần gọi đang giữ trong bộ nhớ vào misa_call_stats (cộng dồn). Lỗi DB: giữ lại để lần sau ghi tiếp. */
export async function flushMisaCallStats() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  const entries = [...unflushed]
  unflushed = new Map()
  for (const [key, count] of entries) {
    const [day, outcome] = key.split('|')
    try {
      await prisma.misaCallStat.upsert({
        where: { day_outcome: { day: new Date(`${day}T00:00:00Z`), outcome } },
        create: { day: new Date(`${day}T00:00:00Z`), outcome, count },
        update: { count: { increment: count } },
      })
    } catch (error) {
      unflushed.set(key, (unflushed.get(key) || 0) + count)
      console.warn('[MISA health] could not save call stats', (error as Error).message?.slice(0, 200))
    }
  }
}

/** Trạng thái hiện tại + 7 ngày gần nhất (cho quản trị). */
export async function misaHealthReport(now = Date.now()) {
  await flushMisaCallStats()
  const since = new Date(`${vnDay(now - 6 * 86400_000)}T00:00:00Z`)
  const rows = await prisma.misaCallStat.findMany({ where: { day: { gte: since } }, orderBy: [{ day: 'desc' }, { outcome: 'asc' }] })
  const days: Record<string, Record<string, number>> = {}
  for (const row of rows) {
    const day = row.day.toISOString().slice(0, 10)
    days[day] = { ...(days[day] || {}), [row.outcome]: row.count }
  }
  return { alerting, last5Minutes: summarize(now), days }
}

/** Chỉ cho kiểm thử */
export function resetMisaHealth(sender?: (text: string) => Promise<unknown>) {
  window = []; alerting = false; unflushed = new Map()
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  notify = sender ?? (text => sendTelegramMessage(text))
}
