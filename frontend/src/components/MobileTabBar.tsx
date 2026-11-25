import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useMobileNavigation } from './MobileNavigation'

type Tab = { path: string; icon: string; label: string }

const COMMON: Tab[] = [
  { path: '/dashboard', icon: 'dashboard', label: 'Tổng quan' },
  { path: '/students', icon: 'group', label: 'Học viên' },
  { path: '/classes', icon: 'calendar_month', label: 'Lịch học' },
]
const FINANCE: Tab = { path: '/tuition', icon: 'payments', label: 'Học phí' }
const PRIVATE: Tab = { path: '/private-schedule', icon: 'person_apron', label: 'Học riêng' }

const tabClass = (active: boolean) =>
  `flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
    active ? 'text-primary' : 'text-slate-500'}`

/** Điều hướng chính trên điện thoại: các trang tra cứu hay dùng, còn lại nằm trong "Thêm". */
export default function MobileTabBar() {
  const { canSeeFinance } = useAuth()
  const { open, toggle } = useMobileNavigation()
  const { pathname } = useLocation()
  const tabs = [...COMMON, canSeeFinance ? FINANCE : PRIVATE]
  const onTab = tabs.some(tab => pathname === tab.path || pathname.startsWith(`${tab.path}/`))

  return (
    <nav aria-label="Điều hướng nhanh"
      className="mobile-tabbar fixed inset-x-0 bottom-0 z-50 border-t border-outline-variant/20 bg-white/95 backdrop-blur-md lg:hidden">
      <div className="mx-auto grid max-w-xl grid-cols-5 gap-1 px-2 pt-1">
        {tabs.map(tab => (
          <NavLink key={tab.path} to={tab.path} className={({ isActive }) => tabClass(isActive)}>
            {({ isActive }) => <>
              <span className={`material-symbols-outlined flex h-7 w-14 items-center justify-center rounded-full text-[22px] ${isActive ? 'bg-primary/10' : ''}`}
                style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined} aria-hidden="true">{tab.icon}</span>
              <span className="max-w-full truncate">{tab.label}</span>
            </>}
          </NavLink>
        ))}
        <button type="button" onClick={toggle} aria-label="Thêm trang khác" aria-controls="main-navigation" aria-expanded={open}
          className={tabClass(open || !onTab)}>
          <span className={`material-symbols-outlined flex h-7 w-14 items-center justify-center rounded-full text-[22px] ${open || !onTab ? 'bg-primary/10' : ''}`} aria-hidden="true">menu</span>
          <span>Thêm</span>
        </button>
      </div>
    </nav>
  )
}
