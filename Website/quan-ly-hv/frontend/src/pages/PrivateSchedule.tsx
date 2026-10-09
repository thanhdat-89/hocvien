import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Student } from '../types'
import { useAuth } from '../hooks/useAuth'
import { PrivateScheduleModal } from './StudentProfile'
import TopBar from '../components/TopBar'
import { useConfirm } from '../components/ConfirmDialog'
import api from '../services/api'

// ─── Helpers ────────────────────────────────────────────────────────────────

function getWeekStart(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, n: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toISO(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

const STUDENT_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-500', text: 'text-blue-900', badge: 'text-blue-600' },
  { bg: 'bg-purple-50', border: 'border-purple-500', text: 'text-purple-900', badge: 'text-purple-600' },
  { bg: 'bg-orange-50', border: 'border-orange-400', text: 'text-orange-900', badge: 'text-orange-600' },
  { bg: 'bg-pink-50', border: 'border-pink-400', text: 'text-pink-900', badge: 'text-pink-600' },
  { bg: 'bg-teal-50', border: 'border-teal-500', text: 'text-teal-900', badge: 'text-teal-600' },
  { bg: 'bg-green-50', border: 'border-green-500', text: 'text-green-900', badge: 'text-green-600' },
]

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
  notes?: string
}

// ─── Session Detail Modal ───────────────────────────────────────────────────

function SessionDetailModal({ session, onClose, onDeleted, onUpdated }: {
  session: PrivateSession
  onClose: () => void
  onDeleted: () => void
  onUpdated: (patch: Partial<PrivateSession>) => void
}) {
  const confirm = useConfirm()
  const [teachers, setTeachers] = useState<{ id: string; fullName: string }[]>([])
  const [teacherName, setTeacherName] = useState(session.teacherName ?? '')
  const [startTime, setStartTime] = useState(session.startTime ?? '')
  const [endTime, setEndTime] = useState(session.endTime ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    api.get('/teachers').then(r => setTeachers(Array.isArray(r.data) ? r.data : (r.data?.data ?? []))).catch(() => {})
  }, [])

  const save = async (patch: { teacherName?: string; startTime?: string; endTime?: string }) => {
    setSaving(true)
    setSaved(false)
    try {
      await api.put(`/students/${session.studentId}/private-schedule/${session.id}`, patch)
      onUpdated(patch)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  const handleTeacherChange = (name: string) => {
    setTeacherName(name)
    save({ teacherName: name })
  }

  const handleStartBlur = () => {
    if (startTime !== (session.startTime ?? '')) save({ startTime, endTime })
  }

  const handleEndBlur = () => {
    if (endTime !== (session.endTime ?? '')) save({ startTime, endTime })
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Xoá buổi học riêng',
      message: 'Bạn có chắc muốn xoá buổi học riêng này?',
      confirmLabel: 'Xoá',
      danger: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      await api.delete(`/students/${session.studentId}/private-schedule/${session.id}`)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  const dateStr = new Date(session.sessionDate + 'T12:00:00').toLocaleDateString('vi-VN', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-surface-container-lowest rounded-2xl shadow-2xl z-10 overflow-hidden">

        {/* Header */}
        <div className="p-6 border-b border-outline-variant/10">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-headline font-bold text-on-surface">{session.studentName}</h3>
              <p className="text-sm text-outline mt-0.5">{dateStr}</p>
            </div>
            <div className="flex items-center gap-2">
              {saving && <span className="material-symbols-outlined text-sm text-primary animate-spin">sync</span>}
              {saved && !saving && <span className="text-xs font-semibold text-secondary">Đã lưu</span>}
              <button onClick={onClose} className="p-1.5 hover:bg-surface-container-low rounded-lg">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          </div>
        </div>

        {/* Editable fields */}
        <div className="p-6 space-y-4">
          {/* Teacher */}
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[13px]">person</span>
              Giáo viên
            </label>
            <select
              value={teacherName}
              onChange={e => handleTeacherChange(e.target.value)}
              disabled={saving}
              className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl py-2 px-3 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            >
              <option value="">-- Chưa phân công --</option>
              {teachers.map(t => (
                <option key={t.id} value={t.fullName}>{t.fullName}</option>
              ))}
            </select>
          </div>

          {/* Time */}
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[13px]">schedule</span>
              Thời gian
            </label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                onBlur={handleStartBlur}
                className="flex-1 bg-surface-container-low border border-outline-variant/20 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <span className="text-outline text-sm">→</span>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                onBlur={handleEndBlur}
                className="flex-1 bg-surface-container-low border border-outline-variant/20 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {/* Rate */}
          <div className="flex items-center gap-3 p-3 bg-surface-container-low rounded-xl">
            <span className="material-symbols-outlined text-sm text-outline">payments</span>
            <span className="text-sm text-on-surface font-medium">
              {session.ratePerSession > 0 ? session.ratePerSession.toLocaleString('vi-VN') + 'đ / buổi' : 'Chưa có học phí'}
            </span>
          </div>

          {session.notes && (
            <div className="flex items-start gap-3 p-3 bg-surface-container-low rounded-xl">
              <span className="material-symbols-outlined text-sm text-outline mt-0.5">notes</span>
              <span className="text-sm text-on-surface-variant">{session.notes}</span>
            </div>
          )}
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="w-full py-2.5 text-sm font-bold rounded-xl bg-error/8 text-error hover:bg-error/15 transition-all border border-error/10 disabled:opacity-50"
          >
            {deleting ? 'Đang xoá...' : 'Xoá buổi học'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function PrivateSchedule() {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [sessions, setSessions] = useState<PrivateSession[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<PrivateSession | null>(null)

  const { canManageStudents } = useAuth()
  const [privateStudent, setPrivateStudent] = useState<Student | null>(null)
  const [missingStudents, setMissingStudents] = useState<Student[]>([])
  const [missingGrade, setMissingGrade] = useState<number | null>(null)
  const filteredMissingStudents = missingStudents.filter(student => missingGrade === null || student.gradeLevel === missingGrade)
  const [missingLoading, setMissingLoading] = useState(true)
  const [missingError, setMissingError] = useState('')
  const [monthKey, setMonthKey] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }))
  const [monthYear, monthNumber] = monthKey.split('-').map(Number)

  const loadMissingStudents = useCallback(async () => {
    setMissingLoading(true)
    setMissingError('')
    try {
      const lastDay = new Date(monthYear, monthNumber, 0).getDate()
      const [first, monthly] = await Promise.all([
        api.get('/students?page=1&limit=20'),
        api.get(`/students/private-sessions/all?fromDate=${monthKey}-01&toDate=${monthKey}-${lastDay}`),
      ])
      const pages = await Promise.all(Array.from({ length: first.data.totalPages - 1 }, (_, i) => api.get(`/students?page=${i + 2}&limit=20`)))
      const students: Student[] = [...first.data.data, ...pages.flatMap(r => r.data.data)]
      if (!Array.isArray(monthly.data) || students.length !== first.data.total) throw new Error('Incomplete data')
      const scheduled = new Set((monthly.data as PrivateSession[]).map(session => session.studentId))
      setMissingStudents(students.filter(student => !student.enrollments?.length && !scheduled.has(student.id)))
    } catch {
      setMissingError('Không thể tải danh sách học viên chưa có lịch. Vui lòng thử lại.')
    } finally {
      setMissingLoading(false)
    }
  }, [monthKey, monthYear, monthNumber])

  useEffect(() => { void loadMissingStudents() }, [loadMissingStudents])
  useEffect(() => {
    const refresh = () => {
      const key = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' })
      setMonthKey(key)
      if (key === monthKey) void loadMissingStudents()
    }
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 60000)
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer) }
  }, [monthKey, loadMissingStudents])

  const loadSessions = useCallback((ws: Date) => {
    setLoading(true)
    const from = toISO(ws)
    const to = toISO(addDays(ws, 6))
    api.get(`/students/private-sessions/all?fromDate=${from}&toDate=${to}`)
      .then(r => setSessions(Array.isArray(r.data) ? r.data : []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadSessions(weekStart) }, [])

  const prevWeek = () => { const ws = addDays(weekStart, -7); setWeekStart(ws); loadSessions(ws) }
  const nextWeek = () => { const ws = addDays(weekStart, 7); setWeekStart(ws); loadSessions(ws) }
  const goToday = () => { const ws = getWeekStart(new Date()); setWeekStart(ws); loadSessions(ws) }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const todayStr = toISO(new Date())

  // Collect unique time slots sorted
  const timeSlots = [...new Set(sessions.map(s => s.startTime ?? '08:00'))].sort()

  // Map: day ISO → time → sessions[]
  const grid: Record<string, Record<string, PrivateSession[]>> = {}
  for (const s of sessions) {
    const t = s.startTime ?? '08:00'
    if (!grid[s.sessionDate]) grid[s.sessionDate] = {}
    if (!grid[s.sessionDate][t]) grid[s.sessionDate][t] = []
    grid[s.sessionDate][t].push(s)
  }

  // Color by studentId
  const studentColorMap: Record<string, (typeof STUDENT_COLORS)[number]> = {}
  let colorIdx = 0
  for (const s of sessions) {
    if (!studentColorMap[s.studentId]) {
      studentColorMap[s.studentId] = STUDENT_COLORS[colorIdx % STUDENT_COLORS.length]
      colorIdx++
    }
  }

  const totalSessions = sessions.length
  const uniqueStudents = new Set(sessions.map(s => s.studentId)).size

  return (
    <div>
      <TopBar title="Lịch học riêng" />
      <div className="px-8 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <span className="text-[11px] font-bold text-primary tracking-[0.2em] uppercase mb-2 block">Lịch Đào Tạo</span>
            <h2 className="text-4xl font-black text-on-surface font-headline tracking-tight">Lịch Học Riêng</h2>
          </div>
        </div>

        {/* Calendar controls */}
        <div className="bg-surface-container-lowest p-4 rounded-2xl shadow-sm flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-headline font-bold text-on-surface">
              {weekStart.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })}
            </h3>
            <div className="flex items-center bg-surface-container-low rounded-lg p-1">
              <button onClick={prevWeek} className="p-1 hover:bg-white rounded-md transition-all">
                <span className="material-symbols-outlined text-[20px]">chevron_left</span>
              </button>
              <button onClick={goToday} className="px-3 py-1 text-xs font-semibold hover:bg-white rounded-md transition-all text-on-surface-variant">
                Hôm nay
              </button>
              <button onClick={nextWeek} className="p-1 hover:bg-white rounded-md transition-all">
                <span className="material-symbols-outlined text-[20px]">chevron_right</span>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[11px] font-bold text-outline">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-primary inline-block"></span>
              {totalSessions} buổi
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-tertiary inline-block"></span>
              {uniqueStudents} học viên
            </span>
            {loading && <span className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full inline-block"></span>}
          </div>
        </div>

        {/* Weekly grid */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-surface-container-low/60">
                <th className="p-4 text-left border-r border-outline-variant/10 w-20">
                  <span className="text-[10px] uppercase tracking-widest text-outline font-bold">Giờ</span>
                </th>
                {weekDays.map((day, i) => {
                  const iso = toISO(day)
                  const isToday = iso === todayStr
                  return (
                    <th key={iso} className={`p-3 text-center border-r border-outline-variant/10 last:border-r-0 ${isToday ? 'bg-primary/5' : ''}`}>
                      <p className={`text-[10px] font-semibold ${isToday ? 'text-primary' : 'text-outline'}`}>{DAY_LABELS[i]}</p>
                      <p className={`text-lg font-black mt-0.5 ${isToday ? 'text-primary' : 'text-on-surface'}`}>{day.getDate()}</p>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {timeSlots.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center text-outline">
                    <span className="material-symbols-outlined text-5xl block mb-3 opacity-20">person_apron</span>
                    <p className="text-sm font-medium">Không có lịch học riêng trong tuần này</p>
                    <p className="text-xs mt-1">Thêm lịch học riêng từ trang hồ sơ học viên</p>
                  </td>
                </tr>
              ) : (
                timeSlots.map((time) => (
                  <tr key={time} className="border-t border-outline-variant/10">
                    <td className="p-3 text-xs font-medium text-outline border-r border-outline-variant/10 align-top w-20">
                      {time}
                    </td>
                    {weekDays.map((day) => {
                      const iso = toISO(day)
                      const isToday = iso === todayStr
                      const daySessions = grid[iso]?.[time] ?? []
                      return (
                        <td key={iso} className={`p-2 border-r border-outline-variant/10 last:border-r-0 align-top min-w-[120px] ${isToday ? 'bg-primary/5' : ''}`}>
                          {daySessions.map((s) => {
                            const color = studentColorMap[s.studentId] ?? STUDENT_COLORS[0]
                            const isCancelled = s.status === 'CANCELLED'
                            return (
                              <button
                                key={s.id}
                                onClick={() => setSelected(s)}
                                className={`w-full text-left p-2.5 rounded-xl ${color.bg} border-l-4 ${color.border} space-y-1 mb-2 hover:shadow-md transition-all ${isCancelled ? 'opacity-50' : ''}`}
                              >
                                <p className={`text-xs font-bold ${color.text} leading-tight`}>
                                  {isCancelled ? <span className="line-through">{s.studentName}</span> : s.studentName}
                                </p>
                                {s.teacherName && (
                                  <span className={`text-[10px] ${color.badge} flex items-center gap-0.5`}>
                                    <span className="material-symbols-outlined text-[11px]">person</span>
                                    {s.teacherName.split(' ').slice(-1)[0]}
                                  </span>
                                )}
                                {s.startTime && (
                                  <p className={`text-[10px] ${color.badge}`}>
                                    {s.startTime}{s.endTime ? `–${s.endTime}` : ''}
                                  </p>
                                )}
                                {isCancelled && (
                                  <span className="material-symbols-outlined text-[14px] text-error">cancel</span>
                                )}
                              </button>
                            )
                          })}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>


        <section className="bg-surface-container-lowest rounded-3xl overflow-hidden shadow-sm border border-outline-variant/10">
          <div className="p-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-headline font-bold text-on-surface">Học viên chưa có lịch học riêng — tháng {monthNumber}/{monthYear}</h3>
              <p className="text-sm text-outline mt-1">Học viên có lớp “Học riêng” và chưa có buổi nào trong toàn bộ tháng hiện tại.</p>
            </div>
            {!missingLoading && !missingError && <span className="text-sm font-semibold text-primary">{filteredMissingStudents.length} học viên</span>}
          </div>
          <div className="px-6 pb-5">
            <p id="missing-grade-label" className="text-[10px] font-bold text-outline uppercase mb-2">Khối lớp</p>
            <div role="group" aria-labelledby="missing-grade-label" className="flex flex-wrap gap-2">
              {[null, 6, 7, 8, 9, 10, 11, 12].map(grade => (
                <button
                  key={grade ?? 'all'}
                  type="button"
                  aria-pressed={missingGrade === grade}
                  onClick={() => setMissingGrade(grade)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    missingGrade === grade
                      ? 'bg-primary text-on-primary border-primary shadow-sm'
                      : 'bg-surface text-on-surface-variant border-outline-variant/30 hover:border-primary/40 hover:text-primary'
                  }`}
                >
                  {grade === null ? 'Tất cả' : `Lớp ${grade}`}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[650px]">
              <thead><tr className="bg-surface-container-low/50">
                <th className="table-header w-12 text-center">STT</th>
                <th className="table-header">Học viên</th>
                <th className="table-header">Khối lớp</th>
                <th className="table-header">Lớp học</th>
                <th className="table-header text-right">Thao tác</th>
              </tr></thead>
              <tbody className="divide-y divide-outline-variant/10">
                {missingLoading ? <tr><td colSpan={5} className="table-cell text-center text-outline" role="status">Đang tải danh sách...</td></tr>
                  : missingError ? <tr><td colSpan={5} className="table-cell text-center text-error" role="alert">{missingError} <button className="text-primary underline ml-2" onClick={() => void loadMissingStudents()}>Thử lại</button></td></tr>
                  : filteredMissingStudents.length === 0 ? <tr><td colSpan={5} className="table-cell text-center text-outline">Không có học viên học riêng nào chưa được xếp lịch trong tháng này{missingGrade === null ? '.' : ` thuộc Lớp ${missingGrade}.`}</td></tr>
                  : filteredMissingStudents.map((student, index) => <tr key={student.id} className="hover:bg-surface-container-low/30 transition-colors group">
                    <td className="table-cell text-center text-sm text-outline font-medium">{index + 1}</td>
                    <td className="table-cell"><div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-tertiary/10 text-tertiary flex items-center justify-center text-sm font-bold shrink-0">{student.fullName.trim().split(/\s+/).slice(-2).map(word => word[0]).join('')}</div>
                      <Link to={`/students/${student.id}`} className="font-semibold text-on-surface hover:text-primary">{student.fullName}</Link>
                    </div></td>
                    <td className="table-cell"><span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-container-high text-xs font-bold text-primary">{student.gradeLevel ? `Lớp ${student.gradeLevel}` : '—'}</span></td>
                    <td className="table-cell"><span className="inline-flex items-center px-2 py-0.5 rounded-md bg-tertiary/10 text-tertiary text-xs font-medium">Học riêng</span></td>
                    <td className="table-cell"><div className="flex justify-end gap-1">
                      <Link to={`/students/${student.id}`} title="Xem hồ sơ" aria-label={`Xem hồ sơ ${student.fullName}`} className="p-2 text-outline hover:text-primary hover:bg-primary/10 rounded-lg"><span className="material-symbols-outlined text-[20px]">visibility</span></Link>
                      {canManageStudents && <button onClick={() => setPrivateStudent(student)} title="Thêm lịch học riêng" aria-label={`Thêm lịch học riêng cho ${student.fullName}`} className="p-2 text-outline hover:text-tertiary hover:bg-tertiary-container/10 rounded-lg"><span className="material-symbols-outlined text-[20px]">calendar_month</span></button>}
                    </div></td>
                  </tr>)}
              </tbody>
            </table>
          </div>
        </section>

      </div>

      {privateStudent && <PrivateScheduleModal
        studentId={privateStudent.id}
        studentName={privateStudent.fullName}
        onClose={() => setPrivateStudent(null)}
        onSaved={() => { setPrivateStudent(null); loadSessions(weekStart); void loadMissingStudents() }}
      />}

      {selected && (
        <SessionDetailModal
          session={selected}
          onClose={() => setSelected(null)}
          onDeleted={() => {
            setSelected(null)
            loadSessions(weekStart)
            void loadMissingStudents()
          }}
          onUpdated={(patch) => {
            setSessions(prev => prev.map(s => s.id === selected.id ? { ...s, ...patch } : s))
            setSelected(prev => prev ? { ...prev, ...patch } : prev)
          }}
        />
      )}
    </div>
  )
}
