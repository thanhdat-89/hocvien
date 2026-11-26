import React, { ReactNode, useEffect, useId, useState } from 'react'
import { useIsPhone } from '../hooks/useMediaQuery'

/**
 * Bộ lọc: trên máy tính hiện ngay trong trang; trên điện thoại gom vào một nút,
 * bấm mở bảng trượt từ đáy (cùng kiểu hộp thoại .responsive-dialog) với nút xem kết quả dính đáy.
 */
export default function ResponsiveFilters({ summary, children, resultCount, onApply, onReset }: {
  summary: string; children: ReactNode; resultCount?: number; onApply?: () => void; onReset?: () => void
}) {
  const [open, setOpen] = useState(false)
  const isPhone = useIsPhone()
  const sheet = open && isPhone
  const id = useId()
  const titleId = `${id}-title`

  useEffect(() => {
    if (!sheet) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKeyDown) }
  }, [sheet])

  return (
    <div>
      <button type="button" aria-expanded={sheet} aria-controls={id} onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-outline-variant/20 bg-white px-4 py-3 text-left text-sm font-semibold text-primary md:hidden">
        <span className="material-symbols-outlined shrink-0" aria-hidden="true">tune</span>
        <span className="min-w-0 flex-1">Bộ lọc<span className="mt-0.5 block truncate text-xs font-normal text-outline">{summary}</span></span>
        <span className="material-symbols-outlined shrink-0" aria-hidden="true">expand_less</span>
      </button>
      <div id={id} className={sheet ? 'responsive-dialog fixed inset-0 z-50 flex' : 'max-md:hidden'}>
        {sheet && <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} aria-hidden="true" />}
        <div role={sheet ? 'dialog' : undefined} aria-modal={sheet || undefined} aria-labelledby={sheet ? titleId : undefined}
          className={sheet ? 'relative flex flex-col overflow-y-auto overscroll-contain bg-background px-4' : ''}>
          {sheet && (
            <div className="sticky top-0 z-[1] -mx-4 mb-3 flex items-center justify-between bg-background px-4 pb-2 pt-3">
              <h2 id={titleId} className="font-headline text-lg font-bold text-on-surface">Bộ lọc</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Đóng bộ lọc"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-white">
                <span className="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </div>
          )}
          {children}
          {sheet && resultCount != null && (
            <div className="dialog-footer -mx-4 flex items-center gap-3 px-4">
              <button type="button" onClick={onReset}
                className="rounded-xl border border-outline-variant/30 px-4 py-3 text-sm font-semibold text-primary">Xóa bộ lọc</button>
              <button type="button" onClick={() => { setOpen(false); onApply?.() }}
                className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white">
                Xem {resultCount} khoản học phí
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
