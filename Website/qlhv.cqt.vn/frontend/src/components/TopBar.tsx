import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useMobileNavigation } from './MobileNavigation'
import WorkspaceSwitcher from './WorkspaceSwitcher'

interface Props {
  title?: string
  onSearch?: (q: string) => void
}

export default function TopBar({ title = 'MathFlow Logic', onSearch }: Props) {
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const { open, toggle } = useMobileNavigation()

  return (
    <header className="app-topbar sticky top-0 w-full z-40 bg-white/80 backdrop-blur-md shadow-sm flex justify-between items-center px-8 py-3 max-lg:flex-wrap max-lg:gap-2 max-lg:px-4">
      <button type="button" onClick={toggle} aria-label="Mở menu" aria-controls="main-navigation" aria-expanded={open}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary lg:hidden">
        <span className="material-symbols-outlined" aria-hidden="true">menu</span>
      </button>
      <div className="flex items-center gap-6 flex-1 max-lg:contents">
        <h2 className="text-xl font-bold text-slate-800 font-headline whitespace-nowrap max-lg:min-w-0 max-lg:flex-1 max-lg:whitespace-normal max-lg:text-base">{title}</h2>
        {onSearch && (
          <div className="relative max-w-md w-full max-lg:order-last max-lg:max-w-none max-lg:basis-full">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">
              search
            </span>
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); onSearch(e.target.value) }}
              className="w-full bg-surface-container-low border-none rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-slate-400"
              placeholder="Tìm kiếm học viên, lớp học..."
              aria-label="Tìm kiếm học viên, lớp học"
            />
          </div>
        )}
      </div>

      <div className="mr-4 min-w-0 max-lg:order-last max-lg:mr-0 max-lg:basis-full">
        <WorkspaceSwitcher />
      </div>

      <div className="flex items-center gap-4 max-lg:gap-1 max-lg:shrink-0">
        <button aria-label="Thông báo" className="p-2 text-slate-500 hover:bg-slate-50 transition-colors rounded-full relative max-lg:hidden">
          <span className="material-symbols-outlined">notifications</span>
          <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full"></span>
        </button>
        <Link to="/settings" aria-label="Cài đặt" title="Cài đặt" className="p-2 text-slate-500 hover:bg-slate-50 transition-colors rounded-full max-lg:hidden">
          <span className="material-symbols-outlined" aria-hidden="true">settings</span>
        </Link>
        <div className="h-8 w-px bg-slate-200 mx-2 max-lg:hidden"></div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden lg:block">
            <p className="text-sm font-semibold text-slate-800">{user?.fullName ?? 'Admin'}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest">{user?.role ?? ''}</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary font-bold text-sm">
            {user?.fullName?.charAt(0) ?? 'A'}
          </div>
        </div>
      </div>
    </header>
  )
}
