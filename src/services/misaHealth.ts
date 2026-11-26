import { prisma } from '../lib/db'

/**
 * Theo dõi sức khỏe kết nối MISA. Mỗi lần gọi (qua misaFetch) được ghi lại:
 *  - Cửa sổ 5 phút trong bộ nhớ: tỉ lệ lỗi > 10% (ít nhất 5 lần gọi) → `alerting` trong báo cáo.
 *  - Đếm theo ngày, ghi gộp vào bảng misa_call_stats mỗi phút (xem GET /api/tuition/misa/health).
 * Không gửi Telegram: lỗi kết nối thoáng qua không cần ai xử lý. Hoá đơn tạo lỗi đã có tin riêng
 * (telegramService.notifyInvoiceCreationFailed, misaInvoiceRetry) — chỉ những tin đó mới báo.
 * Lỗi tính vào tỉ lệ: 429, 401, 5xx, mất kết nối, chưa gửi được. 4xx khác (sai dữ liệu) và 404 không phải lỗi kết nối.
 */
export type MisaCallOutcome = 'ok' | 'http_429' | 'http_401' | 'http_5xx' | 'http_4xx' | 'network' | 'not_sent'
const FAILURE: MisaCallOutcome[] = ['http_429', 'http_401', 'http_5xx', 'network', 'not_sent']
const WINDOW_MS = 5 * 60_000
const MIN_CALLS = 5
const FAILURE_RATE = 0.1
const FLUSH_MS = 60_000

let window: Array<{ at: number; outcome: MisaCallOutcome }> = []
let unflushed = new Map<string, number>()   // `${day}|${outcome}` → số lần chưa ghi DB
let flushTimer: NodeJS.Timeout | null = null

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

const isAlerting = ({ calls, failures }: { calls: number; failures: number }) => calls >= MIN_CALLS && failures / calls > FAILURE_RATE

export function recordMisaCall(outcome: MisaCallOutcome, now = Date.now()) {
  window.push({ at: now, outcome })
  const key = `${vnDay(now)}|${outcome}`
  unflushed.set(key, (unflushed.get(key) || 0) + 1)
  if (!flushTimer) {
    flushTimer = setTimeout(() => { flushTimer = null; flushMisaCallStats().catch(() => undefined) }, FLUSH_MS)
    flushTimer.unref?.()
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
  const last5Minutes = summarize(now)
  return { alerting: isAlerting(last5Minutes), last5Minutes, days }
}

/** Chỉ cho kiểm thử */
export function resetMisaHealth() {
  window = []; unflushed = new Map()
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
}
