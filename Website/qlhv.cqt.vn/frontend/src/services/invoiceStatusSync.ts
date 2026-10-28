interface InvoiceReference { id: string; refId?: string; status: string }
interface InvoicePage { rows: InvoiceReference[]; nextCursor: string | null }

// Collect every page before updates invalidate the list's pagination version.
// Each RefID is read once, including invoices linked to multiple tuition records.
export async function syncInvoiceStatuses(options: {
  list: (cursor?: string) => Promise<InvoicePage>
  refresh: (id: string) => Promise<unknown>
  cancelled: () => boolean
  progress: (completed: number, total: number) => void
}) {
  const invoices = new Map<string, string>()
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    if (options.cancelled()) return null
    const page = await options.list(cursor)
    for (const row of page.rows) {
      if (row.refId && ['CREATING', 'OUTCOME_UNKNOWN', 'DRAFT_CREATED', 'ISSUED', 'SENT_TO_TAX'].includes(row.status)) {
        invoices.set(row.refId, row.id)
      }
    }
    cursor = page.nextCursor || undefined
    if (cursor && cursors.has(cursor)) throw new Error('Danh sách hóa đơn thay đổi. Vui lòng thử lại.')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  const ids = [...invoices.values()]
  let next = 0, completed = 0, failed = 0
  options.progress(0, ids.length)
  await Promise.all(Array.from({ length: Math.min(2, ids.length) }, async () => {
    while (!options.cancelled()) {
      const id = ids[next++]
      if (!id) return
      try { await options.refresh(id) } catch { failed++ }
      completed++
      if (!options.cancelled()) options.progress(completed, ids.length)
    }
  }))
  return options.cancelled() ? null : { completed, failed }
}
