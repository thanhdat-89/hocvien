import React from 'react'
import { useAuth } from '../hooks/useAuth'
import { useWorkspace } from '../hooks/useWorkspace'

const STATUS_SUFFIX = { CURRENT: '', UPCOMING: ' · sắp tới', CLOSED: ' · đã đóng' } as const
const selectClass = 'h-9 max-w-[13rem] min-w-0 rounded-full border-none bg-surface-container-low pl-3 pr-8 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/20 max-lg:max-w-none max-lg:flex-1'

/** Chọn cơ sở và năm học đang xem (thanh trên cùng) */
export default function WorkspaceSwitcher() {
  const { isAdmin } = useAuth()
  const { branches, years, branchId, year, setBranch, setYear } = useWorkspace()
  const active = branches.filter(b => b.isActive)
  const many = isAdmin || active.length > 1

  return (
    <div className="flex min-w-0 items-center gap-2">
      {many ? (
        <select aria-label="Cơ sở đang xem" className={selectClass} value={branchId} onChange={e => setBranch(e.target.value)}>
          <option value="">{isAdmin ? 'Tất cả cơ sở' : 'Các cơ sở của tôi'}</option>
          {active.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      ) : active[0] && (
        <span className="inline-flex h-9 items-center gap-1 rounded-full bg-surface-container-low px-3 text-sm font-semibold text-slate-700 max-lg:text-xs">
          <span className="material-symbols-outlined text-base text-primary" aria-hidden="true">apartment</span>{active[0].name}
        </span>
      )}
      {years.length > 0 && (
        <select aria-label="Năm học đang xem" className={selectClass} value={year?.id ?? ''} onChange={e => setYear(e.target.value)}>
          {years.map(y => <option key={y.id} value={y.id}>{y.name}{STATUS_SUFFIX[y.status]}</option>)}
        </select>
      )}
    </div>
  )
}
