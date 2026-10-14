/** Leave room for Firestore persistence and response delivery within Vercel's 60s limit. */
export function withMisaDeadline(request: typeof fetch, deadline = Date.now() + 35_000): typeof fetch {
  return async (input, init) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new DOMException('MISA request budget exhausted', 'TimeoutError')
    const timeout = AbortSignal.timeout(remaining)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return request(input, { ...init, signal })
  }
}
