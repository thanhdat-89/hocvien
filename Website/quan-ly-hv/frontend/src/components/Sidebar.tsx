import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

type Role = 'ADMIN' | 'STAFF' | 'TEACHER'

const navItems: { path: string; icon: string; label: string; roles?: Role[] }[] = [
  { path: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
  { path: '/students', icon: 'group', label: 'Học viên' },
  { path: '/classes', icon: 'calendar_month', label: 'Lịch & Lớp học' },
  { path: '/private-schedule', icon: 'person_apron', label: 'Lịch học riêng' },
  { path: '/exams', icon: 'quiz', label: 'Điểm kiểm tra' },
  { path: '/reviews', icon: 'rate_review', label: 'Nhận xét học viên' },
  { path: '/teachers', icon: 'badge', label: 'Giáo viên', roles: ['ADMIN'] },
  { path: '/tuition', icon: 'payments', label: 'Học phí', roles: ['ADMIN', 'STAFF'] },
]

export default function Sidebar() {
  const { logout, user } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="h-screen w-64 fixed left-0 top-0 z-50 flex flex-col py-6 tonal-shift-right">
      {/* Logo */}
      <div className="px-6 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-on-primary">
            <span className="material-symbols-outlined">functions</span>
          </div>
          <div>
            <h1 className="text-lg font-black tracking-widest text-blue-700 font-headline leading-tight">
              MATH CENTER
            </h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-tighter">Logic of Clarity</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 space-y-1">
        {navItems.filter(item => !item.roles || (user && item.roles.includes(user.role))).map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              isActive
                ? 'flex items-center gap-3 px-4 py-3 text-sm font-medium text-blue-600 bg-white shadow-sm rounded-lg mx-2 transition-all duration-200'
                : 'flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:text-blue-500 hover:bg-blue-50/50 rounded-lg transition-all duration-200'
            }
          >
            <span className="material-symbols-outlined text-xl">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User & Logout */}
      <div className="px-4 mt-auto space-y-2">
        {user && (
          <div className="px-4 py-3 rounded-lg bg-white/50">
            <p className="text-xs font-bold text-on-surface truncate">{user.fullName}</p>
            <p className="text-[10px] text-outline uppercase tracking-widest">{user.role}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
        >
          <span className="material-symbols-outlined text-xl">logout</span>
          <span>Đăng xuất</span>
        </button>
      </div>
    </aside>
  )
}
