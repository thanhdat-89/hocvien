/**
 * Hàng đợi chung cho mọi lần gọi MISA trong tiến trình: tối đa MISA_MAX_CONCURRENT yêu cầu cùng lúc và các lần
 * bắt đầu cách nhau ít nhất MISA_MIN_INTERVAL_MS. Tick "đã đóng" / tính học phí hàng loạt, trang Hóa đơn, cron cuối tháng
 * cùng đi qua đây nên MISA không bị dồn yêu cầu (HTTP 429), dù frontend gửi bao nhiêu phiếu.
 */

import { outcomeOfStatus, recordMisaCall } from './misaHealth'

/** Yêu cầu chưa được gửi tới MISA (hết thời gian khi còn xếp hàng): chắc chắn chưa tạo gì, tạo lại an toàn. */
export class MisaNotSentError extends Error {
  constructor(message = 'Yêu cầu MISA chưa được gửi đi (hết thời gian chờ).') {
    super(message)
    // Giữ tên lỗi hết giờ như trước cho nơi gọi đang kiểm tra `name === 'TimeoutError'`.
    this.name = 'TimeoutError'
  }
}

const envNumber = (key: string, fallback: number) => {
  const raw = process.env[key]?.trim()
  const value = raw ? Number(raw) : NaN
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

interface Waiter { start: () => void }
let active = 0
let lastStart = 0
let timer: NodeJS.Timeout | null = null
const queue: Waiter[] = []

function pump() {
  const max = Math.max(1, envNumber('MISA_MAX_CONCURRENT', 2))
  const gap = envNumber('MISA_MIN_INTERVAL_MS', 300)
  while (active < max && queue.length) {
    const wait = lastStart + gap - Date.now()
    if (wait > 0) {
      if (!timer) timer = setTimeout(() => { timer = null; pump() }, wait)
      return
    }
    const next = queue.shift()!
    active++
    lastStart = Date.now()
    next.start()
  }
}

function acquire(signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(new MisaNotSentError())
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const index = queue.indexOf(waiter)
      if (index >= 0) queue.splice(index, 1)
      reject(new MisaNotSentError())
    }
    const waiter: Waiter = {
      start: () => { signal?.removeEventListener('abort', onAbort); resolve() },
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    queue.push(waiter)
    pump()
  })
}

function release() {
  active = Math.max(0, active - 1)
  pump()
}

/** Gọi MISA qua hàng đợi chung. Lỗi khi còn đang chờ là MisaNotSentError (chưa gửi gì). */
export async function misaFetch(request: typeof fetch, url: string, init: RequestInit = {}): Promise<Response> {
  try { await acquire(init.signal) } catch (error) { recordMisaCall('not_sent'); throw error }
  try {
    if (init.signal?.aborted) throw new MisaNotSentError()
    const response = await request(url, init)
    recordMisaCall(typeof response?.status === 'number' ? outcomeOfStatus(response.status) : 'ok')
    return response
  } catch (error) {
    recordMisaCall(error instanceof MisaNotSentError ? 'not_sent' : 'network')
    throw error
  } finally {
    release()
  }
}

/** Thời gian chờ trước khi thử lại sau HTTP 429: theo Retry-After nếu có, không thì 1s, 2s, 4s…; tối đa 5s. */
export function retryDelayMs(response: Response | undefined, attempt: number) {
  const header = response?.headers?.get?.('retry-after')
  const seconds = header ? Number(header) : NaN
  const fromHeader = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : NaN
  return Math.min(5000, Number.isFinite(fromHeader) ? fromHeader : 1000 * 2 ** (attempt - 1))
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Lỗi tạm thời phía MISA (quá tải, mất kết nối, lỗi máy chủ) — hóa đơn FAILED vì lý do này được tự tạo lại. */
export function isTransientMisaFailure(message: string | null | undefined) {
  return !!message && /MISA đang bận|HTTP (429|5\d\d)|Không kết nối được MISA|Không nhận được kết quả từ MISA/.test(message)
}

/** Chỉ cho kiểm thử */
export function misaQueueState() { return { active, waiting: queue.length } }
