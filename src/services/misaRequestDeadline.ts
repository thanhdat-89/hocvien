import { MisaNotSentError } from './misaRateLimit'

/** Leave room for database writes and response delivery within the request time budget. */
export function withMisaDeadline(request: typeof fetch, deadline = Date.now() + 35_000): typeof fetch {
  return async (input, init) => {
    const remaining = deadline - Date.now()
    // Hết ngân sách trước khi gửi: chưa có gì tới MISA nên tạo lại an toàn (không phải "không rõ kết quả").
    if (remaining <= 0) throw new MisaNotSentError('MISA request budget exhausted')
    const timeout = AbortSignal.timeout(remaining)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return request(input, { ...init, signal })
  }
}
