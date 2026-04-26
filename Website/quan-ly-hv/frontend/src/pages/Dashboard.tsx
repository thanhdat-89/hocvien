import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import TopBar from '../components/TopBar'
import api from '../services/api'

interface DashboardData {
  stats: {
    totalActiveStudents: number
    totalActiveClasses: number
    newStudentsThisMonth: number
    revenueThisMonth: number
    overdueCount: number
    sessionsTodayCount: number
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

interface PrivateSession {
  id: string
  studentId: string
  studentName: string
  sessionDate: string
  startTime?: string
  endTime?: string
  teacherName?: string
  ratePerSession: number
  status: string
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
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  const dashQuery = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(r => r.data),
  })
  const revenueQuery = useQuery<RevenueMonth[]>({
    queryKey: ['dashboard', 'revenue'],
    queryFn: () => api.get('/dashboard/revenue').then(r => r.data),
    staleTime: 5 * 60_000, // revenue ít thay đổi, cache 5 phút
  })
  const gradeQuery = useQuery<GradeData[]>({
    queryKey: ['dashboard', 'students-by-grade'],
    queryFn: () => api.get('/dashboard/students-by-grade').then(r => r.data),
    staleTime: 5 * 60_000,
  })
  const privateQuery = useQuery<PrivateSession[]>({
    queryKey: ['private-sessions', todayStr],
    queryFn: () => api.get(`/students/private-sessions/all?fromDate=${todayStr}&toDate=${todayStr}`).then(r => r.data),
  })

  const data = dashQuery.data ?? null
  const revenue = revenueQuery.data ?? []
  const grades = gradeQuery.data ?? []
  const privateSessions = privateQuery.data ?? []
  const loading = dashQuery.isLoading

  const stats = data?.stats
  const sessionsToday = data?.sessionsToday ?? []
  const recentPayments = data?.recentPayments ?? []

  const totalSessionsToday = (stats?.sessionsTodayCount ?? 0) + privateSessions.length
  const scheduledSessions = sessionsToday.filter(s => s.status === 'SCHEDULED')
  const completedSessions = sessionsToday.filter(s => s.status === 'COMPLETED')

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
            value={totalSessionsToday}
            label="Buổi học hôm nay"
            sub={privateSessions.length > 0 ? `${stats?.sessionsTodayCount ?? 0} lớp + ${privateSessions.length} riêng` : undefined}
          />
          <StatCard
            icon="person_add"
            iconColor="text-primary"
            iconBg="bg-primary/10"
            value={stats?.newStudentsThisMonth ?? 0}
            label="HV mới tháng này"
          />
        </section>

        {/* Main Grid */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Today's schedule */}
            <div className="bg-surface-container-lowest rounded-2xl p-6">
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-lg font-headline font-bold text-on-surface">Lịch học hôm nay</h3>
                <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-secondary/10 text-secondary rounded-full font-semibold">
                    {completedSessions.length} hoàn thành
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full font-semibold">
                    {scheduledSessions.length} sắp tới
                  </span>
                </div>
              </div>

              {sessionsToday.length === 0 && privateSessions.length === 0 ? (
                <div className="text-center py-10 text-outline">
                  <span className="material-symbols-outlined text-4xl mb-2 block">event_available</span>
                  <p className="text-sm">Không có buổi học nào hôm nay</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sessionsToday.map((s) => (
                    <div key={s.id} className="flex items-center justify-between p-4 bg-surface-container-low rounded-xl hover:shadow-md transition-all group">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex flex-col items-center justify-center">
                          <span className="text-[11px] font-bold text-primary">{s.startTime}</span>
                          <span className="text-[9px] text-primary/60">{s.endTime}</span>
                        </div>
                        <div>
                          <h4 className="font-bold text-on-surface text-sm">{s.className}</h4>
                          <p className="text-xs text-on-surface-variant">GV. {s.teacherName}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                          s.status === 'COMPLETED' ? 'bg-secondary/10 text-secondary' :
                          s.status === 'CANCELLED' ? 'bg-error/10 text-error' :
                          'bg-primary/10 text-primary'
                        }`}>
                          {s.status === 'COMPLETED' ? 'Xong' : s.status === 'CANCELLED' ? 'Huỷ' : 'Sắp tới'}
                        </span>
                      </div>
                    </div>
                  ))}

                  {privateSessions.map((ps) => (
                    <div key={ps.id} className="flex items-center justify-between p-4 bg-tertiary/5 rounded-xl hover:shadow-md transition-all">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-tertiary/10 flex flex-col items-center justify-center">
                          <span className="text-[11px] font-bold text-tertiary">{ps.startTime || '—'}</span>
                          <span className="text-[9px] text-tertiary/60">{ps.endTime || ''}</span>
                        </div>
                        <div>
                          <h4 className="font-bold text-on-surface text-sm">{ps.studentName}</h4>
                          <div className="flex items-center gap-2">
                            {ps.teacherName && <p className="text-xs text-on-surface-variant">GV. {ps.teacherName}</p>}
                            <span className="text-[10px] px-2 py-0.5 bg-tertiary/10 text-tertiary rounded-full font-semibold">Dạy riêng</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Revenue Chart */}
            <div className="bg-surface-container-lowest rounded-2xl p-6">
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
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Students by grade */}
            <div className="bg-surface-container-lowest rounded-2xl p-6">
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

            {/* Recent payments */}
            <div className="bg-surface-container-lowest rounded-2xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-headline font-bold text-on-surface">Thanh toán gần đây</h3>
                <button className="text-primary font-semibold text-xs hover:underline" onClick={() => navigate('/tuition')}>
                  Xem tất cả
                </button>
              </div>
              {recentPayments.length === 0 ? (
                <div className="text-center py-6 text-outline text-sm">Chưa có giao dịch</div>
              ) : (
                <div className="space-y-3">
                  {recentPayments.slice(0, 5).map((p) => (
                    <div key={p.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center">
                          <span className="material-symbols-outlined text-secondary text-sm">paid</span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-on-surface">{p.studentName || 'Học viên'}</p>
                          <p className="text-[10px] text-on-surface-variant">{p.paymentDate}</p>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-secondary">+{formatVND(p.amount)}đ</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick links */}
            <div className="bg-surface-container-lowest rounded-2xl p-6">
              <h3 className="text-lg font-headline font-bold text-on-surface mb-4">Truy cập nhanh</h3>
              <div className="space-y-2">
                {[
                  { icon: 'person_add', label: 'Thêm học viên', path: '/students?new=1', color: 'text-primary' },
                  { icon: 'add_circle', label: 'Tạo lớp mới', path: '/classes?new=1', color: 'text-secondary' },
                  { icon: 'event_note', label: 'Lịch dạy riêng', path: '/private-schedule', color: 'text-tertiary' },
                  { icon: 'notifications', label: 'Gửi thông báo', path: '/notifications', color: 'text-primary' },
                ].map((link) => (
                  <button
                    key={link.path}
                    onClick={() => navigate(link.path)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-surface-container-low transition-colors text-left"
                  >
                    <span className={`material-symbols-outlined ${link.color}`}>{link.icon}</span>
                    <span className="text-sm font-medium text-on-surface">{link.label}</span>
                    <span className="material-symbols-outlined text-outline text-sm ml-auto">chevron_right</span>
                  </button>
                ))}
              </div>
            </div>
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
