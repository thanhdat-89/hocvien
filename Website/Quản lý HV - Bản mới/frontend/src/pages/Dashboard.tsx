import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import TopBar from '../components/TopBar'
import api from '../services/api'
import { DashboardStats } from '../types'

const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

function formatVND(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [revenue, setRevenue] = useState<{ month: string; revenue: number }[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const today = new Date()

  useEffect(() => {
    api.get('/dashboard/stats').then((r) => setStats(r.data)).catch(() => {})
    api.get('/dashboard/revenue').then((r) => setRevenue(r.data)).catch(() => {})
    const todayStr = today.toISOString().slice(0, 10)
    api.get(`/sessions?date=${todayStr}&status=SCHEDULED`).then((r) => setSessions(r.data.slice(0, 4))).catch(() => {})
  }, [])

  const todayStr = today.toLocaleDateString('vi-VN', { day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <div>
      <TopBar title="MathFlow Logic" />
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        {/* Welcome */}
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-headline font-extrabold text-on-surface tracking-tight">
              Chào buổi sáng, Admin!
            </h1>
            <p className="text-on-surface-variant mt-1">Dưới đây là tổng quan các hoạt động của trung tâm hôm nay.</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-secondary">
              <span className="material-symbols-outlined text-lg">calendar_today</span>
              {todayStr}
            </button>
            <button className="btn-primary" onClick={() => navigate('/classes?new=1')}>
              <span className="material-symbols-outlined text-lg">add</span>
              Tạo lớp mới
            </button>
          </div>
        </section>

        {/* Stats Bento Grid */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-surface-container-lowest p-6 rounded-xl flex flex-col justify-between group hover:bg-primary transition-all duration-300 cursor-pointer">
            <div className="flex justify-between items-start">
              <div className="p-3 bg-surface-container-low rounded-lg group-hover:bg-primary-fixed/30 transition-colors">
                <span className="material-symbols-outlined text-primary group-hover:text-on-primary">person</span>
              </div>
              <span className="text-secondary font-bold text-xs bg-secondary-container px-2 py-1 rounded-full">+12%</span>
            </div>
            <div className="mt-8">
              <h3 className="text-4xl font-headline font-black text-on-surface group-hover:text-on-primary">
                {stats?.totalStudents ?? '—'}
              </h3>
              <p className="text-[11px] uppercase tracking-wider text-on-surface-variant group-hover:text-on-primary/80 mt-1">
                Tổng số học viên
              </p>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-xl flex flex-col justify-between group hover:bg-secondary transition-all duration-300 cursor-pointer">
            <div className="flex justify-between items-start">
              <div className="p-3 bg-surface-container-low rounded-lg group-hover:bg-secondary-container/30 transition-colors">
                <span className="material-symbols-outlined text-secondary group-hover:text-on-secondary">menu_book</span>
              </div>
              <span className="text-on-surface-variant font-medium text-xs bg-surface-container-high px-2 py-1 rounded-full">Hôm nay</span>
            </div>
            <div className="mt-8">
              <h3 className="text-4xl font-headline font-black text-on-surface group-hover:text-on-secondary">
                {stats?.sessionsToday ?? '—'}
              </h3>
              <p className="text-[11px] uppercase tracking-wider text-on-surface-variant group-hover:text-on-secondary/80 mt-1">
                Buổi học hôm nay
              </p>
            </div>
          </div>

          <div className="md:col-span-2 bg-surface-container-lowest p-6 rounded-xl border-l-8 border-tertiary shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-on-surface-variant">Doanh thu tháng này</p>
              <h3 className="text-4xl font-headline font-black text-on-surface mt-2">
                {stats ? formatVND(stats.monthlyRevenue) : '—'}
                <span className="text-lg font-medium text-on-surface-variant ml-1">VND</span>
              </h3>
              {stats && (
                <div className="flex items-center gap-2 mt-4">
                  <div className="h-2 w-32 bg-surface-container-low rounded-full overflow-hidden">
                    <div
                      className="h-full bg-tertiary rounded-full"
                      style={{ width: `${Math.min(100, Math.round((stats.collectedRevenue / Math.max(stats.monthlyRevenue, 1)) * 100))}%` }}
                    ></div>
                  </div>
                  <span className="text-xs font-semibold text-tertiary">
                    {Math.round((stats.collectedRevenue / Math.max(stats.monthlyRevenue, 1)) * 100)}% đã thu
                  </span>
                </div>
              )}
            </div>
            <div className="hidden sm:block opacity-20 transform -rotate-12 translate-x-4">
              <span className="material-symbols-outlined text-[100px]">payments</span>
            </div>
          </div>

          {/* Extra stats row */}
          <div className="bg-surface-container-lowest p-6 rounded-xl flex flex-col justify-between">
            <div className="p-3 bg-surface-container-low rounded-lg w-fit">
              <span className="material-symbols-outlined text-primary">school</span>
            </div>
            <div className="mt-4">
              <h3 className="text-3xl font-headline font-black text-on-surface">{stats?.activeClasses ?? '—'}</h3>
              <p className="text-[11px] uppercase tracking-wider text-on-surface-variant mt-1">Lớp đang hoạt động</p>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-xl flex flex-col justify-between">
            <div className="p-3 bg-surface-container-low rounded-lg w-fit">
              <span className="material-symbols-outlined text-secondary">person_check</span>
            </div>
            <div className="mt-4">
              <h3 className="text-3xl font-headline font-black text-on-surface">{stats?.activeStudents ?? '—'}</h3>
              <p className="text-[11px] uppercase tracking-wider text-on-surface-variant mt-1">Học viên đang học</p>
            </div>
          </div>

          <div className="md:col-span-2 bg-error/5 p-6 rounded-xl flex items-center gap-4 border border-error/10">
            <div className="p-3 bg-error/10 rounded-lg">
              <span className="material-symbols-outlined text-error">warning</span>
            </div>
            <div>
              <h3 className="text-2xl font-headline font-black text-error">{stats?.overdueCount ?? '—'}</h3>
              <p className="text-[11px] uppercase tracking-wider text-error/70 mt-0.5">Học phí quá hạn</p>
              <button
                onClick={() => navigate('/tuition?tab=overdue')}
                className="text-xs font-bold text-error hover:underline mt-1"
              >
                Xem danh sách →
              </button>
            </div>
          </div>
        </section>

        {/* Charts + Sessions */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Revenue Chart */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-surface-container-lowest p-8 rounded-xl">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-xl font-headline font-bold text-on-surface">Biểu đồ Doanh thu</h3>
                  <p className="text-sm text-on-surface-variant">6 tháng gần nhất</p>
                </div>
              </div>
              <div className="h-64">
                {revenue.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenue} barSize={24}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e7e6ff" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#555881' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#555881' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatVND(v)} />
                      <Tooltip
                        formatter={(v: number) => [`${v.toLocaleString('vi-VN')}đ`, 'Doanh thu']}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
                      />
                      <Bar dataKey="revenue" fill="#0050d4" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-outline text-sm">Chưa có dữ liệu</div>
                )}
              </div>
            </div>

            {/* Today's Sessions */}
            <div className="bg-surface-container-lowest rounded-xl p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-headline font-bold text-on-surface">Lịch học hôm nay</h3>
                <button className="text-primary font-semibold text-sm hover:underline" onClick={() => navigate('/classes')}>
                  Xem tất cả
                </button>
              </div>
              <div className="space-y-4">
                {sessions.length === 0 && (
                  <p className="text-sm text-outline text-center py-8">Không có buổi học nào hôm nay</p>
                )}
                {sessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-4 bg-surface-container-low rounded-xl group hover:shadow-md transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-surface-container-highest flex flex-col items-center justify-center text-on-surface">
                        <span className="text-[10px] font-bold uppercase">{s.startTime}</span>
                        <span className="text-[9px] font-medium text-outline">{s.endTime}</span>
                      </div>
                      <div>
                        <h4 className="font-bold text-on-surface text-sm">{s.className}</h4>
                        <p className="text-xs text-on-surface-variant">GV. {s.teacherName}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(`/classes/${s.classId}`)}
                      className="p-2 bg-white rounded-lg group-hover:bg-primary group-hover:text-on-primary transition-colors"
                    >
                      <span className="material-symbols-outlined text-lg">chevron_right</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            <div className="bg-surface-container-low rounded-xl p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-headline font-bold text-on-surface">Việc cần làm</h3>
                <button className="p-2 bg-primary rounded-lg text-on-primary shadow-sm">
                  <span className="material-symbols-outlined text-sm">add</span>
                </button>
              </div>
              <div className="space-y-3">
                {[
                  { text: 'Duyệt danh sách lớp mới', time: 'Trước 12:00', color: 'border-primary', done: false },
                  { text: 'Kiểm tra báo cáo học phí', time: 'Quan trọng', color: 'border-secondary', done: false },
                  { text: 'Gửi thông báo lớp nghỉ lễ', time: 'Hoàn thành', color: 'border-outline-variant', done: true },
                ].map((item, i) => (
                  <div key={i} className={`flex items-start gap-3 bg-white p-3 rounded-xl shadow-sm border-l-4 ${item.color} ${item.done ? 'opacity-50' : ''}`}>
                    <input type="checkbox" defaultChecked={item.done} className="mt-0.5 rounded text-primary" />
                    <div>
                      <p className={`text-sm font-bold text-on-surface ${item.done ? 'line-through' : ''}`}>{item.text}</p>
                      <p className="text-[10px] text-outline mt-0.5 uppercase tracking-wide">{item.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-surface-container-highest/30 rounded-xl p-6">
              <h3 className="text-lg font-headline font-bold text-on-surface mb-5">Thông báo mới</h3>
              <div className="space-y-4">
                {[
                  { icon: 'person_add', bg: 'bg-blue-100', color: 'text-blue-600', title: 'Đăng ký mới', body: 'Có học viên vừa đăng ký khóa học', time: '10 phút trước' },
                  { icon: 'paid', bg: 'bg-green-100', color: 'text-green-600', title: 'Học phí đã nộp', body: 'Phụ huynh vừa thanh toán học phí', time: '1 giờ trước' },
                  { icon: 'warning', bg: 'bg-red-100', color: 'text-red-600', title: 'Học phí quá hạn', body: `${stats?.overdueCount ?? 0} phiếu đã quá hạn`, time: 'Ngay bây giờ' },
                ].map((n, i) => (
                  <div key={i} className="flex gap-3">
                    <div className={`w-9 h-9 rounded-full ${n.bg} flex items-center justify-center ${n.color} flex-shrink-0`}>
                      <span className="material-symbols-outlined text-[18px]">{n.icon}</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-on-surface">{n.title}</p>
                      <p className="text-xs text-on-surface-variant mt-0.5">{n.body}</p>
                      <p className="text-[10px] text-slate-400 mt-1">{n.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
