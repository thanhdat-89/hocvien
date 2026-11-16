/** Every item settles once; one failure must not block the remaining queue. */
export async function settleWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>, concurrency = 2): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (next < items.length) {
      const index = next++
      try { results[index] = { status: 'fulfilled', value: await worker(items[index]) } }
      catch (reason) { results[index] = { status: 'rejected', reason } }
    }
  }))
  return results
}
