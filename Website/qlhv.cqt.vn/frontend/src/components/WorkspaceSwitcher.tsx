import React from 'react'
import { Link } from 'react-router-dom'
import { useWorkspace } from '../hooks/useWorkspace'

const STATUS_SUFFIX = { CURRENT: '', UPCOMING: ' · sắp tới', CLOSED: ' · đã đóng' } as const
const pillClass = 'h-9 max-w-[13rem] min-w-0 rounded-full bg-surface-container-low text-sm font-semibold text-slate-700 max-lg:max-w-none max-lg:flex-1'

/** Cơ sở làm việc (đổi trong Cài đặt) và năm học đang xem (thanh trên cùng) */
export default function WorkspaceSwitcher() {
  const { branches, years, branchId, year, setYear } = useWorkspace()
  const branch = branches.find(b => b.id === branchId)

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Link to="/settings/account" title="Cơ sở làm việc — đổi trong Cài đặt → Tài khoản của tôi"
        className={`${pillClass} inline-flex items-center gap-1.5 px-3 hover:bg-primary/10`}>
        <span className="material-symbols-outlined text-base text-primary" aria-hidden="true">apartment</span>
        <span className="truncate">{branch?.name ?? (branches.length ? 'Chưa có cơ sở' : '…')}</span>
      </Link>
      {years.length > 0 && (
        <select aria-label="Năm học đang xem" className={`${pillClass} border-none pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-primary/20`}
          value={year?.id ?? ''} onChange={e => setYear(e.target.value)}>
          {years.map(y => <option key={y.id} value={y.id}>{y.name}{STATUS_SUFFIX[y.status]}</option>)}
        </select>
      )}
    </div>
  )
}
