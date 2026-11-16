import React, { ReactNode, useId, useState } from 'react'

export default function ResponsiveFilters({ summary, children, resultCount, onApply, onReset }: {
  summary: string; children: ReactNode; resultCount?: number; onApply?: () => void; onReset?: () => void
}) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}
        className="mb-3 flex w-full items-center gap-2 rounded-xl border border-outline-variant/20 bg-white px-4 py-3 text-left text-sm font-semibold text-primary md:hidden">
        <span className="material-symbols-outlined shrink-0" aria-hidden="true">filter_alt</span>
        <span className="min-w-0 flex-1">Bộ lọc<span className="mt-0.5 block truncate text-xs font-normal text-outline">{summary}</span></span>
        <span className="material-symbols-outlined shrink-0" aria-hidden="true">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      <div id={id} className={open ? '' : 'max-md:hidden'}>
        {children}
        {resultCount != null && <div className="mt-3 flex flex-wrap items-center gap-3 md:hidden">
          <button type="button" onClick={() => { setOpen(false); onApply?.() }}
            className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white">
            Xem {resultCount} khoản học phí
          </button>
          <button type="button" onClick={onReset} className="rounded-xl border border-outline-variant/20 px-4 py-3 text-sm font-semibold text-primary">Xóa bộ lọc</button>
        </div>}
      </div>
    </div>
  )
}
