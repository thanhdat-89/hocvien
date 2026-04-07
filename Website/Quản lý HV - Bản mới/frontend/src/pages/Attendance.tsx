import React, { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import api from '../services/api'
import { Session } from '../types'

interface SalarySummary {
  teacherId: string
  teacherName: string
  salaryRate: number
  sessions: number
  totalSalary: number
}

export default function Attendance() {
  const [tab, setTab] = useState<'sessions' | 'salary'>('salary')
  const [salary, setSalary] = useState<SalarySummary[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(false)

  const load = async (m = month, y = year) => {
    setLoading(true)
    try {
      // Load salary summary
      const salaryRes = await api.get(`/attendance/teacher/summary?month=${m}&year=${y}`)
      setSalary(salaryRes.data ?? [])

      // Load sessions for the month
      const from = `${y}-${String(m).padStart(2, '0')}-01`
      const lastDay = new Date(y, m, 0).getDate()
      const to = `${y}-${String(m).padStart(2, '0')}-${lastDay}`
      const sessRes = await api.get(`/sessions?fromDate=${from}&toDate=${to}`)
      setSessions(Array.isArray(sessRes.data) ? sessRes.data : [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleMonthChange = (m: number, y: number) => {
    setMonth(m); setYear(y); load(m, y)
  }

  const handleCompleteSession = async (session: Session) => {
    if (!confirm(`Hoàn thành buổi học "${session.className}" ngày ${session.sessionDate}?`)) return
    await api.put(`/sessions/${session.id}/complete`, {})
    load()
  }

  const handleCancelSession = async (session: Session) => {
    const reason = prompt('Lý do huỷ:')
    if (reason === null) return
    await api.put(`/sessions/${session.id}/cancel`, { cancelReason: reason })
    load()
  }

  const totalSalary = salary.reduce((s, r) => s + r.totalSalary, 0)
  const totalSessions = salary.reduce((s, r) => s + r.sessions, 0)
  const completedSessions = sessions.filter((s) => s.status === 'COMPLETED').length

  return (
    <div>
      <TopBar title="Chấm công Giáo viên" />
      <div className="px-8 py-8 space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <span className="text-[11px] font-bold text-primary tracking-[0.2em] uppercase mb-2 block">Nhân sự</span>
            <h2 className="text-4xl font-black text-on-surface font-headline tracking-tight">Chấm công Giáo viên</h2>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={month}
              onChange={(e) => handleMonthChange(Number(e.target.value), year)}
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>Tháng {i + 1}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => handleMonthChange(month, Number(e.target.value))}
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {[2024, 2025, 2026].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {loading && <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4">
              <span className="material-symbols-outlined">payments</span>
            </div>
            <p className="text-sm text-outline font-medium">Tổng lương tháng</p>
            <p className="text-3xl font-black text-primary mt-1">{(totalSalary / 1_000_000).toFixed(1)}M đ</p>
          </div>
          <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary mb-4">
              <span className="material-symbols-outlined">assignment_turned_in</span>
            </div>
            <p className="text-sm text-outline font-medium">Buổi đã dạy (có lương)</p>
            <p className="text-3xl font-black text-secondary mt-1">{totalSessions} buổi</p>
          </div>
          <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
            <div className="w-10 h-10 rounded-lg bg-tertiary/10 flex items-center justify-center text-tertiary mb-4">
              <span className="material-symbols-outlined">event_available</span>
            </div>
            <p className="text-sm text-outline font-medium">Buổi hoàn thành / Tổng</p>
            <p className="text-3xl font-black text-on-surface mt-1">
              {completedSessions}
              <span className="text-lg font-medium text-outline">/{sessions.length}</span>
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-outline-variant/20">
          {[
            { key: 'salary', label: 'Tổng lương tháng' },
            { key: 'sessions', label: 'Buổi dạy trong tháng' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key as any)}
              className={`px-6 py-3 text-sm font-semibold border-b-2 transition-all ${tab === key ? 'border-primary text-primary' : 'border-transparent text-outline hover:text-on-surface'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Salary Tab */}
        {tab === 'salary' && (
          <div className="bg-surface-container-lowest rounded-3xl overflow-hidden shadow-sm border border-outline-variant/10">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low/50">
                    <th className="table-header">Giáo viên</th>
                    <th className="table-header">Buổi đã dạy</th>
                    <th className="table-header">Lương/buổi</th>
                    <th className="table-header text-right">Tổng lương</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {salary.map((s) => (
                    <tr key={s.teacherId} className="hover:bg-surface-container-low/30 transition-colors">
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                            {s.teacherName.split(' ').slice(-1)[0]?.[0]?.toUpperCase() ?? '?'}
                          </div>
                          <span className="font-semibold text-on-surface">{s.teacherName}</span>
                        </div>
                      </td>
                      <td className="table-cell">
                        <span className="text-2xl font-black text-secondary">{s.sessions}</span>
                        <span className="text-sm text-outline ml-1">buổi</span>
                      </td>
                      <td className="table-cell text-sm text-on-surface-variant">
                        {s.salaryRate.toLocaleString('vi-VN')}đ
                      </td>
                      <td className="table-cell text-right">
                        <span className="text-xl font-black text-primary">{s.totalSalary.toLocaleString('vi-VN')}đ</span>
                      </td>
                    </tr>
                  ))}
                  {salary.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-16 text-center text-outline">
                        <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">assignment_turned_in</span>
                        Chưa có dữ liệu chấm công tháng {month}/{year}
                        <p className="text-xs mt-2">Cần hoàn thành buổi học để tạo dữ liệu chấm công</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Sessions Tab */}
        {tab === 'sessions' && (
          <div className="bg-surface-container-lowest rounded-3xl overflow-hidden shadow-sm border border-outline-variant/10">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low/50">
                    <th className="table-header">Giáo viên</th>
                    <th className="table-header">Lớp</th>
                    <th className="table-header">Ngày dạy</th>
                    <th className="table-header">Giờ</th>
                    <th className="table-header">Trạng thái</th>
                    <th className="table-header text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {sessions.map((s) => (
                    <tr key={s.id} className="hover:bg-surface-container-low/30 transition-colors group">
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                            {s.teacherName?.split(' ').slice(-1)[0]?.[0]?.toUpperCase() ?? '?'}
                          </div>
                          <span className="font-semibold text-on-surface text-sm">{s.teacherName}</span>
                        </div>
                      </td>
                      <td className="table-cell text-sm text-on-surface-variant">{s.className}</td>
                      <td className="table-cell text-sm text-on-surface-variant">
                        {new Date(s.sessionDate).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                      </td>
                      <td className="table-cell text-sm text-on-surface-variant">{s.startTime} – {s.endTime}</td>
                      <td className="table-cell">
                        {s.status === 'COMPLETED' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary-container/30 text-secondary text-[11px] font-bold uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>Hoàn thành
                          </span>
                        )}
                        {s.status === 'CANCELLED' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-error-container/10 text-error text-[11px] font-bold uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-error"></span>Đã huỷ
                          </span>
                        )}
                        {s.status === 'SCHEDULED' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-container/20 text-primary text-[11px] font-bold uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>Dự kiến
                          </span>
                        )}
                      </td>
                      <td className="table-cell text-right">
                        {s.status === 'SCHEDULED' && (
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleCompleteSession(s)}
                              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-secondary text-on-secondary hover:bg-secondary/90 transition-all"
                            >
                              Hoàn thành
                            </button>
                            <button
                              onClick={() => handleCancelSession(s)}
                              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-error/10 text-error hover:bg-error/20 transition-all"
                            >
                              Huỷ
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-16 text-center text-outline">
                        <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">event_busy</span>
                        Không có buổi học nào tháng {month}/{year}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
