import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
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
    studentsWithPaymentThisMonth: number | null
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

interface GradeData {
  gradeLevel: number
  count: number
}

interface RevenueMonth {
  year: number
  month: number
  revenue: number
}

const GRADE_COLORS = ['#0050d4', '#006947', '#8e3a8a', '#b31b25', '#c77700', '#0e7490', '#6d28d9']

function formatVND(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
}

function formatFullVND(n: number) {
  return n.toLocaleString('vi-VN') + 'đ'
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { canSeeFinance } = useAuth()
  const today = new Date()
  const monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(today)
  const monthLabel = `${Number(monthKey.slice(5))}/${monthKey.slice(0, 4)}`

  const dashQuery = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(r => r.data),
  })
  const revenueQuery = useQuery<RevenueMonth[]>({
    queryKey: ['dashboard', 'revenue'],
    queryFn: () => api.get('/dashboard/revenue').then(r => r.data),
    enabled: canSeeFinance,
    staleTime: 5 * 60_000, // revenue ít thay đổi, cache 5 phút
  })
  const gradeQuery = useQuery<GradeData[]>({
    queryKey: ['dashboard', 'students-by-grade'],
    queryFn: () => api.get('/dashboard/students-by-grade').then(r => r.data),
    staleTime: 5 * 60_000,
  })


  const data = dashQuery.data ?? null
  const revenue = revenueQuery.data ?? []
  const grades = gradeQuery.data ?? []
  const loading = dashQuery.isLoading

  const stats = data?.stats

  const revenueChartData = revenue.map(r => ({
    label: `T${r.month}`,
    revenue: r.revenue,
  }))

  const gradeChartData = grades.map(g => ({
    name: `Lớp ${g.gradeLevel}`,
    value: g.count,
  }))

  const dateDisplay = today.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

  if (loading) {
    return (
      <div>
        <TopBar title="Math Center" />
        <div className="p-8 max-w-7xl mx-auto flex items-center justify-center h-[60vh]">
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
      <div className="p-8 max-w-7xl mx-auto space-y-8">
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
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
            className="group w-full text-left bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/15 hover:border-tertiary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tertiary transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="p-3 rounded-xl bg-tertiary/10 text-tertiary">
                <span className="material-symbols-outlined">event_busy</span>
              </div>
              <span className="text-xs font-semibold text-on-surface-variant bg-surface-container-low px-3 py-1.5 rounded-full">tháng {monthLabel}</span>
            </div>
            <div className="mt-5 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-headline font-bold text-on-surface">Học viên chưa có lịch học riêng — tháng {monthLabel}</h2>
                <p className="text-sm text-on-surface-variant mt-1">Chưa được xếp buổi học riêng trong tháng này</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-4xl font-headline font-black text-on-surface">{stats?.unscheduledPrivateStudentsThisMonth ?? '—'}</span>
                <span className="material-symbols-outlined text-outline group-hover:text-tertiary transition-colors">chevron_right</span>
              </div>
            </div>
          </button>

          {canSeeFinance && (
            <button
              type="button"
              onClick={() => navigate('/tuition')}
              className="group w-full text-left bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/15 hover:border-secondary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="p-3 rounded-xl bg-secondary/10 text-secondary">
                  <span className="material-symbols-outlined">payments</span>
                </div>
                <span className="text-xs font-semibold text-on-surface-variant bg-surface-container-low px-3 py-1.5 rounded-full">tháng {monthLabel}</span>
              </div>
              <div className="mt-5 flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-lg font-headline font-bold text-on-surface">Học viên thanh toán học phí — tháng {monthLabel}</h2>
                  <p className="text-sm text-on-surface-variant mt-1">Số học viên có ghi nhận thanh toán trong tháng</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-4xl font-headline font-black text-on-surface">{stats?.studentsWithPaymentThisMonth ?? '—'}</span>
                  <span className="material-symbols-outlined text-outline group-hover:text-secondary transition-colors">chevron_right</span>
                </div>
              </div>
            </button>
          )}
        </section>

        {/* Charts */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {canSeeFinance && (
            <div className="lg:col-span-2 bg-surface-container-lowest rounded-2xl p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-headline font-bold text-on-surface">Doanh thu theo tháng</h3>
                <span className="text-xs text-on-surface-variant">12 tháng gần nhất</span>
              </div>
              <div className="h-56">
                {revenueChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenueChartData} barSize={20}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e7e6ff" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#555881' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#555881' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatVND(v)} />
                      <Tooltip
                        formatter={(v: number) => [formatFullVND(v), 'Doanh thu']}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
                      />
                      <Bar dataKey="revenue" fill="#0050d4" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-outline text-sm">Chưa có dữ liệu doanh thu</div>
                )}
              </div>
            </div>
          )}

            {/* Students by grade */}
            <div className={`${canSeeFinance ? 'lg:col-span-1' : 'lg:col-span-3'} bg-surface-container-lowest rounded-2xl p-6`}>
              <h3 className="text-lg font-headline font-bold text-on-surface mb-4">Phân bố theo khối</h3>
              {gradeChartData.length > 0 ? (
                <>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={gradeChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={70}
                          dataKey="value"
                          paddingAngle={3}
                        >
                          {gradeChartData.map((_, i) => (
                            <Cell key={i} fill={GRADE_COLORS[i % GRADE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => [`${v} HV`, 'Số lượng']} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {gradeChartData.map((g, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: GRADE_COLORS[i % GRADE_COLORS.length] }} />
                        <span className="text-on-surface-variant">{g.name}</span>
                        <span className="font-bold text-on-surface ml-auto">{g.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-outline text-sm">Chưa có dữ liệu</div>
              )}
            </div>
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
      className={`bg-surface-container-lowest p-5 rounded-2xl flex flex-col gap-4 ${onClick ? 'cursor-pointer hover:shadow-md transition-all' : ''}`}
      onClick={onClick}
    >
      <div className={`p-3 ${iconBg} rounded-xl w-fit`}>
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
