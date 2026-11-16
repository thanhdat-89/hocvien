import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import TopBar from '../components/TopBar'
import api from '../services/api'
import { useAuth } from '../hooks/useAuth'

interface DashboardData {
  stats: {
    totalActiveStudents: number
    totalActiveClasses: number
    newStudentsThisMonth: number
    revenueThisMonth: number
    overdueCount: number
    sessionsTodayCount: number
    unscheduledPrivateStudentsThisMonth: number | null
    totalPrivateStudents: number | null
    unpaidStudentsThisMonth: number | null
    unpaidStudentsByMonth: Array<{
      year: number
      month: number
      count: number
    }>
  }
  sessionsToday: Array<{
    id: string
    classId: string
    className: string
    teacherName: string
    startTime: string
    endTime: string
    status: string
  }>
  recentPayments: Array<{
    id: string
    studentName?: string
    amount: number
    paymentDate: string
    createdAt: string
  }>
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { canSeeFinance } = useAuth()
  const today = new Date()
  const monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(today)
  const monthLabel = `${Number(monthKey.slice(5))}/${monthKey.slice(0, 4)}`

  const dashQuery = useQuery<DashboardData>({
    queryKey: ['dashboard', monthKey],
    queryFn: () => api.get('/dashboard').then(r => r.data),
    refetchOnWindowFocus: true,
  })
  const data = dashQuery.data ?? null
  const loading = dashQuery.isLoading

  const stats = data?.stats
  const unpaidMonths = (stats?.unpaidStudentsByMonth ?? []).filter(item => item.count > 0)

  const dateDisplay = today.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

  if (loading) {
    return (
      <div>
        <TopBar title="Math Center" />
        <div className="page-content p-8 max-w-7xl mx-auto flex items-center justify-center h-[60vh]">
          <div className="text-center space-y-3">
            <span className="material-symbols-outlined text-5xl text-primary animate-spin">progress_activity</span>
            <p className="text-on-surface-variant text-sm">Đang tải dữ liệu...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <TopBar title="Math Center" />
      <div className="page-content p-8 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-sm text-on-surface-variant capitalize">{dateDisplay}</p>
            <h1 className="text-3xl font-headline font-extrabold text-on-surface tracking-tight mt-1">
              Tổng quan Trung tâm
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-secondary" onClick={() => navigate('/students')}>
              <span className="material-symbols-outlined text-lg">groups</span>
              Học viên
            </button>
            <button className="btn-primary" onClick={() => navigate('/classes')}>
              <span className="material-symbols-outlined text-lg">school</span>
              Lớp học
            </button>
          </div>
        </section>

        {/* Stats Cards */}
        <section className="grid grid-cols-2 xl:grid-cols-4 gap-6">
          <StatCard
            icon="groups"
            iconColor="text-primary"
            iconBg="bg-primary/10"
            value={stats?.totalActiveStudents ?? 0}
            label="Học viên đang học"
            onClick={() => navigate('/students')}
          />
          <StatCard
            icon="school"
            iconColor="text-secondary"
            iconBg="bg-secondary/10"
            value={stats?.totalActiveClasses ?? 0}
            label="Lớp đang hoạt động"
            onClick={() => navigate('/classes')}
          />
          <StatCard
            icon="calendar_today"
            iconColor="text-tertiary"
            iconBg="bg-tertiary/10"
            value={stats?.sessionsTodayCount ?? 0}
            label="Buổi học hôm nay"
          />
          <StatCard
            icon="person_add"
            iconColor="text-primary"
            iconBg="bg-primary/10"
            value={stats?.newStudentsThisMonth ?? 0}
            label="HV mới tháng này"
          />
        </section>

        {/* Monthly student summaries */}
        <section className={`grid grid-cols-1 gap-6 ${canSeeFinance ? 'lg:grid-cols-2' : ''}`}>
          <button
            type="button"
            onClick={() => navigate('/private-schedule')}
            className="group flex min-w-0 w-full flex-col items-stretch text-left bg-surface-container-lowest rounded-2xl p-6 border border-error/25 hover:border-error/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="p-3 rounded-xl bg-error/10 text-error shrink-0 flex">
                <span className="material-symbols-outlined">event_busy</span>
              </div>
              <span className="text-xs font-semibold text-on-surface-variant bg-surface-container-low px-3 py-1.5 rounded-full">tháng {monthLabel}</span>
            </div>
            <h2 className="mt-5 text-lg font-headline font-bold text-on-surface">Học viên học riêng chưa xếp lịch</h2>
            <p className="text-sm text-on-surface-variant mt-1">Chưa có buổi học riêng trong tháng {monthLabel}</p>
            <div className="flex items-baseline gap-2 py-6">
              <span className="text-4xl font-headline font-black text-error">{stats?.unscheduledPrivateStudentsThisMonth ?? '—'}</span>
              <span className="text-sm text-on-surface-variant">học viên</span>
            </div>
            <div className="mt-auto flex items-center justify-between gap-3 border-t border-outline-variant/15 pt-4 text-sm font-semibold text-primary">
              <span>Xem danh sách và xếp lịch</span>
              <span className="material-symbols-outlined shrink-0">chevron_right</span>
            </div>
          </button>

          {canSeeFinance && (
            <div className="min-w-0 w-full bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/15">
              <div className="p-3 rounded-xl bg-secondary/10 text-secondary w-fit flex">
                <span className="material-symbols-outlined">payments</span>
              </div>
              <h2 className="mt-5 text-lg font-headline font-bold text-on-surface">Học viên chưa thanh toán học phí</h2>
              <p className="text-sm text-on-surface-variant mt-1">Học viên còn học phí phải trả theo từng tháng, kể cả chưa có phiếu</p>
              <div className="mt-4 divide-y divide-outline-variant/15">
                {unpaidMonths.map(({ year, month, count }) => (
                  <button
                    key={`${year}-${month}`}
                    type="button"
                    onClick={() => navigate(`/tuition?month=${month}&year=${year}`)}
                    className="group flex w-full items-center justify-between gap-4 rounded-lg px-3 py-3 text-left hover:bg-secondary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary transition-colors"
                  >
                    <span className="text-sm font-semibold text-on-surface-variant">Tháng {month}/{year}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-2xl font-headline font-black text-on-surface">{count}</span>
                      <span className="material-symbols-outlined text-outline group-hover:text-secondary transition-colors">chevron_right</span>
                    </span>
                  </button>
                ))}
                {unpaidMonths.length === 0 && (
                  <p className="py-3 text-sm text-on-surface-variant">
                    {stats?.unpaidStudentsThisMonth == null ? 'Chưa có dữ liệu học phí' : 'Không có học viên chưa thanh toán học phí'}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

      </div>
    </div>
  )
}

function StatCard({ icon, iconColor, iconBg, value, label, sub, onClick }: {
  icon: string
  iconColor: string
  iconBg: string
  value: number
  label: string
  sub?: string
  onClick?: () => void
}) {
  return (
    <div
      className={`min-w-0 bg-surface-container-lowest p-6 rounded-2xl flex flex-col gap-4 ${onClick ? 'cursor-pointer hover:shadow-md transition-all' : ''}`}
      onClick={onClick}
    >
      <div className={`p-3 ${iconBg} rounded-xl w-fit flex`}>
        <span className={`material-symbols-outlined ${iconColor}`}>{icon}</span>
      </div>
      <div>
        <h3 className="text-3xl font-headline font-black text-on-surface">{value}</h3>
        <p className="text-[11px] uppercase tracking-wider text-on-surface-variant mt-1 font-semibold">{label}</p>
        {sub && <p className="text-[10px] text-on-surface-variant mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
