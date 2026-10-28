import React, { useCallback, useEffect, useState } from 'react'
import { Outlet, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Sidebar from './Sidebar'
import { MobileNavigationContext } from './MobileNavigation'
import TopBar from './TopBar'
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
    <MobileNavigationContext.Provider value={{ open: menuOpen, toggle: () => setMenuOpen(open => !open) }}>
    <div data-compact-sidebar={compact} className="app-shell flex bg-background min-h-screen font-body text-on-background antialiased">
      <Sidebar open={menuOpen} onClose={closeMenu} compact={compact} />
      <main ref={contentRef} id="main-content" className="app-content flex-1 min-w-0 lg:ml-64 min-h-screen">
        {['/notifications', '/leads'].includes(pathname) && (
          <div className="sticky top-0 z-40 lg:hidden"><TopBar title={pathname === '/leads' ? 'Khách tiềm năng' : 'Thông báo'} /></div>
        )}
        <Outlet />
      </main>
    </div>
    </MobileNavigationContext.Provider>
  )
}
