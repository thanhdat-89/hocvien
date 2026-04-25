import React, { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

interface Props {
  title?: string
  onSearch?: (q: string) => void
}

export default function TopBar({ title = 'MathFlow Logic', onSearch }: Props) {
  const { user } = useAuth()
  const [q, setQ] = useState('')

  return (
    <header className="sticky top-0 w-full z-40 bg-white/80 backdrop-blur-md shadow-sm flex justify-between items-center px-8 py-3">
      <div className="flex items-center gap-6 flex-1">
        <h2 className="text-xl font-bold text-slate-800 font-headline whitespace-nowrap">{title}</h2>
        {onSearch && (
          <div className="relative max-w-md w-full">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">
              search
            </span>
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); onSearch(e.target.value) }}
              className="w-full bg-surface-container-low border-none rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-slate-400"
              placeholder="Tìm kiếm học viên, lớp học..."
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button className="p-2 text-slate-500 hover:bg-slate-50 transition-colors rounded-full relative">
          <span className="material-symbols-outlined">notifications</span>
          <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full"></span>
        </button>
        <button className="p-2 text-slate-500 hover:bg-slate-50 transition-colors rounded-full">
          <span className="material-symbols-outlined">settings</span>
        </button>
        <div className="h-8 w-px bg-slate-200 mx-2"></div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
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
