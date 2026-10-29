import React, { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

type Role = 'ADMIN' | 'STAFF' | 'TEACHER'

const navItems: { path: string; icon: string; label: string; roles?: Role[] }[] = [
  { path: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
  { path: '/students', icon: 'group', label: 'Học viên' },
  { path: '/classes', icon: 'calendar_month', label: 'Lịch & Lớp học' },
  { path: '/private-schedule', icon: 'person_apron', label: 'Lịch học riêng' },
  { path: '/holidays', icon: 'celebration', label: 'Lịch nghỉ lễ', roles: ['ADMIN', 'STAFF'] },
  { path: '/tuition', icon: 'payments', label: 'Học phí', roles: ['ADMIN', 'STAFF'] },
  { path: '/tuition/invoices', icon: 'receipt_long', label: 'Hóa đơn điện tử', roles: ['ADMIN', 'STAFF'] },
  { path: '/activity', icon: 'history', label: 'Lịch sử hoạt động', roles: ['ADMIN', 'STAFF'] },
]

export default function Sidebar({ open, onClose, compact }: { open: boolean; onClose: () => void; compact: boolean }) {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [expanded, setExpanded] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const dismissed = useRef(false)
  const pointerInside = useRef(false)
  const cancelTimer = () => { clearTimeout(timer.current); timer.current = undefined }
  const collapse = () => { cancelTimer(); setExpanded(false) }
  useEffect(() => { collapse(); dismissed.current = false }, [compact, pathname])
  useEffect(() => () => clearTimeout(timer.current), [])
  const showNames = () => {
    cancelTimer()
    if (compact && !dismissed.current) setExpanded(true)
  }
  const leave = () => {
    pointerInside.current = false
    if (!sidebarRef.current?.contains(document.activeElement)) dismissed.current = false
    cancelTimer()
    timer.current = setTimeout(() => {
      timer.current = undefined
      if (!sidebarRef.current?.contains(document.activeElement)) {
        dismissed.current = false
        setExpanded(false)
      }
    }, 250)
  }
  useEffect(() => {
    if (!compact || !expanded) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); dismissed.current = true; collapse()
      }
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [compact, expanded])
  const sidebarRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const main = document.getElementById('main-content')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    main?.setAttribute('inert', '')
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key !== 'Tab') return
      const controls = sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
      if (!controls?.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      main?.removeAttribute('inert')
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus()
    }
  }, [open, onClose])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <>
    {open && <div className="fixed inset-0 z-[70] bg-slate-950/40 lg:hidden" onClick={onClose} aria-hidden="true" />}
    <aside data-expanded={expanded} onPointerEnter={event => {
      if (event.pointerType === 'touch') return
      pointerInside.current = true
      cancelTimer()
      if (compact && !dismissed.current) timer.current = setTimeout(showNames, 150)
    }} onPointerMove={event => {
      if (event.pointerType !== 'touch' && compact && !expanded && !dismissed.current && !timer.current) {
        pointerInside.current = true
        timer.current = setTimeout(showNames, 150)
      }
    }} onPointerLeave={leave}
      onFocusCapture={event => { if (!(event.target as HTMLElement).closest('[data-sidebar-toggle]')) showNames() }}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          if (!pointerInside.current) { dismissed.current = false; collapse() }
        }
      }}
      ref={sidebarRef} id="main-navigation" role={open ? 'dialog' : undefined} aria-modal={open ? true : undefined} aria-label="Menu chính"
      className={`app-sidebar h-screen w-64 fixed left-0 top-0 z-50 max-lg:z-[80] max-lg:h-[100dvh] max-lg:max-w-[calc(100vw-2rem)] ${open ? 'flex' : 'hidden lg:flex'} flex-col py-6 tonal-shift-right`}>
      <button ref={closeRef} type="button" onClick={onClose} aria-label="Đóng menu"
        className="absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-white/60 focus-visible:ring-2 focus-visible:ring-primary lg:hidden">
        <span className="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
      {compact && <button data-sidebar-toggle type="button" aria-label={expanded ? 'Thu gọn menu' : 'Mở rộng menu'} aria-expanded={expanded}
        onClick={() => { cancelTimer(); dismissed.current = expanded; setExpanded(value => !value) }}
        className="sidebar-expand mx-auto mb-3 hidden h-9 w-11 items-center justify-center rounded-lg text-primary hover:bg-white/60">
        <span className="material-symbols-outlined" aria-hidden="true">{expanded ? 'chevron_left' : 'chevron_right'}</span>
      </button>}
      {/* Logo */}
      <div className="sidebar-brand px-6 mb-8">
        <div className="flex items-center gap-3">
          <div className="sidebar-brand-icon w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-on-primary">
            <span className="material-symbols-outlined">functions</span>
          </div>
          <div className="sidebar-label">
            <h1 className="text-lg font-black tracking-widest text-blue-700 font-headline leading-tight">
              MATH CENTER
            </h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-tighter">Logic of Clarity</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav aria-label="Điều hướng chính" className="flex-1 px-2 space-y-1 max-lg:min-h-0 max-lg:overflow-y-auto">
        {navItems.filter(item => !item.roles || (user && item.roles.includes(user.role))).map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => { dismissed.current = true; collapse(); onClose() }}
            aria-label={item.label}
            end={item.path === '/tuition'}
            className={({ isActive }) =>
              isActive
                ? 'sidebar-link flex items-center gap-3 px-4 py-3 text-sm font-medium text-blue-600 bg-white shadow-sm rounded-lg mx-2 transition-all duration-200'
                : 'sidebar-link flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:text-blue-500 hover:bg-blue-50/50 rounded-lg transition-all duration-200'
            }
          >
            <span className="material-symbols-outlined text-xl" aria-hidden="true">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User & Logout */}
      <div className="sidebar-footer px-4 mt-auto space-y-2">
        {user && (
          <div className="sidebar-user px-4 py-3 rounded-lg bg-white/50" aria-label={`${user.fullName} (${user.role})`}>
            <span className="sidebar-avatar hidden h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary" aria-hidden="true">{user.fullName?.charAt(0)}</span>
            <div className="sidebar-label">
            <p className="text-xs font-bold text-on-surface truncate">{user.fullName}</p>
            <p className="text-[10px] text-outline uppercase tracking-widest">{user.role}</p>
            </div>
          </div>
        )}
        <NavLink
          to="/settings"
          onClick={() => { dismissed.current = true; collapse(); onClose() }}
          aria-label="Cài đặt"
          className={({ isActive }) => `sidebar-logout w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all ${
            isActive ? 'text-blue-600 bg-white shadow-sm' : 'text-slate-600 hover:text-blue-500 hover:bg-blue-50/50'}`}
        >
          <span className="material-symbols-outlined text-xl" aria-hidden="true">settings</span>
          <span className="sidebar-label">Cài đặt</span>
        </NavLink>
        <button
          aria-label="Đăng xuất"
          onClick={handleLogout}
          className="sidebar-logout w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
        >
          <span className="material-symbols-outlined text-xl">logout</span>
          <span className="sidebar-label">Đăng xuất</span>
        </button>
      </div>
    </aside>
    </>
  )
}
