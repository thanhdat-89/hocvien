import React, { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import NotificationBell from './NotificationBell'
import GlobalSearch from './GlobalSearch'

interface Props {
  title?: string
  onSearch?: (q: string) => void
  /** Trang chi tiết: hiện nút quay lại trên điện thoại (app cài ra màn hình chính không có nút Back của trình duyệt). */
  backTo?: string
}

export default function TopBar({ title = 'MathFlow Logic', onSearch, backTo }: Props) {
  const navigate = useNavigate()
  const { user, canSeeFinance } = useAuth()
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const closeSearch = useCallback(() => setSearching(false), [])

  return (
    <header className="app-topbar sticky top-0 w-full z-40 bg-white/80 backdrop-blur-md shadow-sm flex justify-between items-center px-8 py-3 max-lg:flex-wrap max-lg:gap-x-1 max-lg:gap-y-2 max-lg:px-4 max-lg:py-2">
      {backTo && <button type="button" aria-label="Quay lại"
        onClick={() => { if (window.history.state?.idx > 0) navigate(-1); else navigate(backTo) }}
        className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 lg:hidden">
        <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>}
      <div className="flex items-center gap-6 flex-1 max-lg:contents">
        <h2 className="text-xl font-bold text-slate-800 font-headline whitespace-nowrap max-lg:min-w-0 max-lg:flex-1 max-lg:truncate max-lg:text-lg">{title}</h2>
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

      <div className="mr-4 min-w-0 max-lg:hidden">
        <WorkspaceSwitcher />
      </div>

      <div className="flex items-center gap-4 max-lg:gap-1 max-lg:shrink-0">
        {!onSearch && <button type="button" onClick={() => setSearching(true)} aria-label="Tìm học viên"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 lg:hidden">
          <span className="material-symbols-outlined" aria-hidden="true">search</span>
        </button>}
        {canSeeFinance && <NotificationBell />}
        <Link to="/settings" aria-label="Cài đặt" title="Cài đặt" className="p-2 text-slate-500 hover:bg-slate-50 transition-colors rounded-full max-lg:hidden">
          <span className="material-symbols-outlined" aria-hidden="true">settings</span>
        </Link>
        <div className="h-8 w-px bg-slate-200 mx-2 max-lg:hidden"></div>
        <div className="flex items-center gap-3 max-lg:hidden">
          <div className="text-right hidden lg:block">
            <p className="text-sm font-semibold text-slate-800">{user?.fullName ?? 'Admin'}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest">{user?.role ?? ''}</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary font-bold text-sm">
            {user?.fullName?.charAt(0) ?? 'A'}
          </div>
        </div>
      </div>
      {searching && <GlobalSearch onClose={closeSearch} />}
    </header>
  )
}
