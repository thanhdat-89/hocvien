import React, { useCallback, useEffect, useState } from 'react'
import { Outlet, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Sidebar from './Sidebar'
import { MobileNavigationContext } from './MobileNavigation'
import TopBar from './TopBar'
import { WorkspaceProvider, useWorkspace } from '../hooks/useWorkspace'
import { useCompactSidebar } from '../hooks/useCompactSidebar'

export default function Layout() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const { compact, contentRef } = useCompactSidebar(pathname)
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])

  useEffect(closeMenu, [pathname, closeMenu])
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const onResize = () => { if (desktop.matches) closeMenu() }
    desktop.addEventListener('change', onResize)
    return () => desktop.removeEventListener('change', onResize)
  }, [closeMenu])
  if (!user) return <Navigate to="/login" replace />

  return (
    <WorkspaceProvider>
    <MobileNavigationContext.Provider value={{ open: menuOpen, toggle: () => setMenuOpen(open => !open) }}>
    <div data-compact-sidebar={compact} className="app-shell flex bg-background min-h-screen font-body text-on-background antialiased">
      <Sidebar open={menuOpen} onClose={closeMenu} compact={compact} />
      <main ref={contentRef} id="main-content" className="app-content flex-1 min-w-0 lg:ml-64 min-h-screen">
        {['/notifications', '/leads'].includes(pathname) && (
          <div className="sticky top-0 z-40 lg:hidden"><TopBar title={pathname === '/leads' ? 'Khách tiềm năng' : 'Thông báo'} /></div>
        )}
        <YearBanner />
        <Outlet />
      </main>
    </div>
    </MobileNavigationContext.Provider>
    </WorkspaceProvider>
  )
}

/** Đang xem năm học khác năm hiện tại: nhắc rõ, năm đã đóng chỉ xem */
function YearBanner() {
  const { year, years, setYear } = useWorkspace()
  const current = years.find(y => y.status === 'CURRENT')
  if (!year || year.status === 'CURRENT') return null
  return (
    <div role="status" className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-sm font-medium ${year.status === 'CLOSED' ? 'bg-amber-100 text-amber-900' : 'bg-primary/10 text-primary'}`}>
      <span className="material-symbols-outlined text-lg" aria-hidden="true">{year.status === 'CLOSED' ? 'lock' : 'event_upcoming'}</span>
      <span>Đang xem năm học <b>{year.name}</b>{year.status === 'CLOSED' ? ' (đã đóng, chỉ xem: không ghi danh hay tạo lớp mới)' : ' (sắp tới)'}</span>
      {current && <button type="button" className="underline font-semibold" onClick={() => setYear(current.id)}>Về năm {current.name}</button>}
    </div>
  )
}
