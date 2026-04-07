import React, { useEffect, useState, useCallback } from 'react'
import TopBar from '../components/TopBar'
import Toast, { ToastMessage } from '../components/Toast'
import api from '../services/api'
import { Session, Class } from '../types'

// ─── Helpers ────────────────────────────────────────────────────────────────

function getWeekStart(date: Date) {
  const d = new Date(date)
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day // shift to Monday
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
const CLASS_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-500', text: 'text-blue-900', badge: 'text-blue-600' },
  { bg: 'bg-secondary-container/20', border: 'border-secondary', text: 'text-on-secondary-container', badge: 'text-secondary' },
  { bg: 'bg-tertiary-container/20', border: 'border-tertiary', text: 'text-tertiary-dim', badge: 'text-tertiary' },
  { bg: 'bg-orange-50', border: 'border-orange-400', text: 'text-orange-900', badge: 'text-orange-600' },
  { bg: 'bg-pink-50', border: 'border-pink-400', text: 'text-pink-900', badge: 'text-pink-600' },
]

// ─── Attendance Modal ────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { cls: string; label: string; icon: string }> = {
  PRESENT: { cls: 'bg-secondary-container/40 text-secondary border-secondary/20', label: 'Có mặt', icon: 'check_circle' },
  ABSENT:  { cls: 'bg-error-container/20 text-error border-error/20',             label: 'Vắng',    icon: 'cancel' },
}

function AttendanceModal({ session, onClose, onDone, onSessionUpdate }: {
  session: Session
  onClose: () => void
  onDone: () => void
  onSessionUpdate?: (patch: Partial<Session>) => void
}) {
  const [attendances, setAttendances] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sessionStatus, setSessionStatus] = useState(session.status)
  const [teachers, setTeachers] = useState<any[]>([])
  const [teacherId, setTeacherId] = useState(session.teacherId ?? '')
  const [teacherName, setTeacherName] = useState(session.teacherName ?? '')
  const [savingTeacher, setSavingTeacher] = useState(false)
  const [savedTeacher, setSavedTeacher] = useState(false)

  // Ngày session (YYYY-MM-DD local)
  const todayLocal = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()
  const isPast = session.sessionDate <= todayLocal

  const loadAttendances = async () => {
    const r = await api.get(`/sessions/${session.id}`)
    setAttendances(r.data.studentAttendances ?? [])
    return r.data.studentAttendances ?? []
  }

  useEffect(() => {
    api.get('/teachers').then(r => setTeachers(Array.isArray(r.data) ? r.data : (r.data?.data ?? [])))
  }, [])

  const handleTeacherChange = async (newTeacherId: string) => {
    const t = teachers.find(t => t.id === newTeacherId)
    setTeacherId(newTeacherId)
    setTeacherName(t?.fullName ?? '')
    setSavingTeacher(true)
    setSavedTeacher(false)
    try {
      await api.put(`/sessions/${session.id}`, { teacherId: newTeacherId || null })
      setSavedTeacher(true)
      setTimeout(() => setSavedTeacher(false), 3000)
      onSessionUpdate?.({ teacherId: newTeacherId || undefined, teacherName: t?.fullName ?? '' })
    } finally {
      setSavingTeacher(false)
    }
  }

  useEffect(() => {
    const init = async () => {
      // Nếu đã đến ngày và còn SCHEDULED → tự động hoàn thành + khởi tạo điểm danh
      if (sessionStatus === 'SCHEDULED' && isPast) {
        try {
          await api.put(`/sessions/${session.id}/complete`, {})
          setSessionStatus('COMPLETED')
        } catch { /* ignore nếu đã complete */ }
      }
      // Retry tối đa 3 lần để tránh gọi complete 2 lần khi Firestore chưa cập nhật ngay
      for (let i = 0; i < 3; i++) {
        const atts = await loadAttendances()
        if (atts.length > 0 || !isPast) break
        if (i < 2) await new Promise(r => setTimeout(r, 600))
      }
      setLoading(false)
    }
    init()
  }, [session.id])

  const handleAttStatus = async (attId: string, newStatus: string) => {
    // Optimistic update
    setAttendances(prev => prev.map(a => a.id === attId ? { ...a, status: newStatus } : a))
    await api.put(`/attendance/${attId}`, { status: newStatus }).catch(() => loadAttendances())
  }

  const handleCancel = async () => {
    const reason = prompt('Lý do huỷ buổi học:')
    if (reason === null) return
    await api.put(`/sessions/${session.id}/cancel`, { cancelReason: reason })
    onDone()
    onClose()
  }

  const isCancelled = sessionStatus === 'CANCELLED' || session.status === 'CANCELLED'
  const presentCount = attendances.filter(a => a.status === 'PRESENT').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-container-lowest rounded-2xl shadow-2xl z-10 overflow-hidden">

        {/* Header */}
        <div className="p-6 border-b border-outline-variant/10">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-headline font-bold text-on-surface">{session.className}</h3>
              <p className="text-sm text-outline mt-0.5">
                {new Date(session.sessionDate + 'T12:00:00').toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                {' • '}{session.startTime} – {session.endTime}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                isCancelled ? 'bg-error-container/10 text-error' :
                sessionStatus === 'COMPLETED' ? 'bg-secondary-container/30 text-secondary' :
                'bg-primary-container/20 text-primary'
              }`}>
                {isCancelled ? 'Đã huỷ' : sessionStatus === 'COMPLETED' ? 'Hoàn thành' : 'Dự kiến'}
              </span>
              <button onClick={onClose} className="p-1.5 hover:bg-surface-container-low rounded-lg">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          </div>
          {/* Teacher picker */}
          <div className="flex items-center gap-2 mt-3">
            <span className="material-symbols-outlined text-sm text-outline">person</span>
            <span className="text-sm text-outline whitespace-nowrap">Giáo viên</span>
            <select
              value={teacherId}
              onChange={e => handleTeacherChange(e.target.value)}
              disabled={savingTeacher || isCancelled}
              className="flex-1 text-sm bg-surface-container-low border border-outline-variant/20 rounded-lg px-2.5 py-1.5 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            >
              <option value="">-- Chưa phân công giáo viên --</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
            </select>
            {savingTeacher && <span className="material-symbols-outlined text-sm text-primary animate-spin">sync</span>}
            {savedTeacher && !savingTeacher && <span className="text-xs font-semibold text-error whitespace-nowrap">Đã lưu giáo viên</span>}
          </div>
        </div>

        {/* Attendance list */}
        <div className="p-6 max-h-[360px] overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full"></div>
              <p className="text-xs text-outline">Đang khởi tạo điểm danh...</p>
            </div>
          ) : isCancelled ? (
            <div className="text-center py-8 text-outline">
              <span className="material-symbols-outlined text-4xl block mb-2 opacity-30">event_busy</span>
              <p className="text-sm">Buổi học đã bị huỷ</p>
              {session.cancelReason && <p className="text-xs mt-1 text-error/70">{session.cancelReason}</p>}
            </div>
          ) : !isPast ? (
            <div className="text-center py-8 text-outline">
              <span className="material-symbols-outlined text-4xl block mb-2 opacity-30">event_upcoming</span>
              <p className="text-sm font-medium">Buổi học chưa diễn ra</p>
              <p className="text-xs mt-1">Điểm danh sẽ được khởi tạo tự động khi đến ngày</p>
            </div>
          ) : attendances.length === 0 ? (
            <div className="text-center py-8 text-outline">
              <span className="material-symbols-outlined text-4xl block mb-2 opacity-30">group_off</span>
              <p className="text-sm">Chưa có học viên trong lớp</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold text-outline uppercase tracking-wider">Điểm danh học viên</p>
                <p className="text-xs font-bold text-secondary">{presentCount}/{attendances.length} có mặt</p>
              </div>
              {attendances.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between p-3 bg-surface-container-low rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
                      {a.studentName?.split(' ').slice(-1)[0]?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <span className="text-sm font-medium text-on-surface">{a.studentName}</span>
                  </div>
                  <div className="flex gap-1">
                    {(['PRESENT', 'ABSENT'] as const).map((s) => (
                      <button key={s} onClick={() => handleAttStatus(a.id, s)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                          a.status === s ? STATUS_CFG[s].cls : 'bg-transparent border-transparent text-outline hover:bg-surface-container'
                        }`}>
                        {STATUS_CFG[s].label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {!isCancelled && (
          <div className="px-6 pb-6">
            <button onClick={handleCancel}
              className="w-full py-2.5 text-sm font-bold rounded-xl bg-error/8 text-error hover:bg-error/15 transition-all border border-error/10">
              Huỷ buổi học
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Create Class Modal ──────────────────────────────────────────────────────

const DAY_OF_WEEK_OPTIONS = [
  { value: 'MONDAY',    label: 'T2' },
  { value: 'TUESDAY',   label: 'T3' },
  { value: 'WEDNESDAY', label: 'T4' },
  { value: 'THURSDAY',  label: 'T5' },
  { value: 'FRIDAY',    label: 'T6' },
  { value: 'SATURDAY',  label: 'T7' },
  { value: 'SUNDAY',    label: 'CN' },
]

interface DaySchedule {
  startTime: string
  endTime: string
}

function ClassModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [teachers, setTeachers] = useState<any[]>([])
  const [form, setForm] = useState({
    name: '',
    teacherId: '',
    tuitionRate: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    notes: '',
  })
  // Map: dayOfWeek → { startTime, endTime }
  const [daySchedules, setDaySchedules] = useState<Record<string, DaySchedule>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/teachers').then((r) => setTeachers(Array.isArray(r.data) ? r.data : r.data?.data ?? [])).catch(() => {})
  }, [])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const toggleDay = (day: string) => {
    setDaySchedules((prev) => {
      if (prev[day]) {
        const next = { ...prev }
        delete next[day]
        return next
      }
      return { ...prev, [day]: { startTime: '08:00', endTime: '10:00' } }
    })
  }

  const setDayTime = (day: string, field: 'startTime' | 'endTime', value: string) => {
    setDaySchedules((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }))
  }

  const selectedDays = DAY_OF_WEEK_OPTIONS.filter((d) => daySchedules[d.value])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name) { setError('Vui lòng nhập tên lớp'); return }
    if (!form.tuitionRate) { setError('Vui lòng nhập học phí'); return }
    setSaving(true); setError('')
    try {
      // 1. Tạo lớp học
      const classRes = await api.post('/classes', {
        name: form.name,
        ...(form.teacherId && { teacherId: form.teacherId }),
        tuitionRate: Number(form.tuitionRate),
        startDate: form.startDate,
        ...(form.endDate && { endDate: form.endDate }),
        ...(form.notes && { notes: form.notes }),
      })
      const classId = classRes.data.id

      // 2. Tạo lịch học cho từng thứ đã chọn (mỗi thứ có giờ riêng)
      const days = Object.entries(daySchedules)
      if (days.length > 0) {
        await Promise.all(
          days.map(([dayOfWeek, { startTime, endTime }]) =>
            api.post('/schedules', {
              classId,
              dayOfWeek,
              startTime,
              endTime,
              effectiveFrom: form.startDate,
              ...(form.endDate && { effectiveTo: form.endDate }),
            })
          )
        )
        // 3. Tự động tạo buổi học cho tháng hiện tại và tháng tiếp theo
        const cur = new Date()
        const nxt = new Date(); nxt.setMonth(nxt.getMonth() + 1)
        await Promise.all([
          api.post('/schedules/generate-month', { classId, month: cur.getMonth() + 1, year: cur.getFullYear() }).catch(() => {}),
          api.post('/schedules/generate-month', { classId, month: nxt.getMonth() + 1, year: nxt.getFullYear() }).catch(() => {}),
        ])
      }

      onSaved()
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Có lỗi xảy ra')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-container-lowest rounded-2xl shadow-2xl p-8 z-10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-headline font-bold text-on-surface">Tạo lớp học mới</h3>
          <button onClick={onClose} className="p-2 hover:bg-surface-container-low rounded-lg"><span className="material-symbols-outlined">close</span></button>
        </div>

        {error && <div className="mb-4 p-3 bg-error-container/10 text-error rounded-xl text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Tên lớp */}
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Tên lớp *</label>
            <input value={form.name} onChange={set('name')} required placeholder="VD: Toán 9A - Tối T2/T4/T6"
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>

          {/* Giáo viên */}
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">
              Giáo viên <span className="text-outline/50 normal-case font-normal">(có thể bổ sung sau)</span>
            </label>
            <select value={form.teacherId} onChange={set('teacherId')}
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">Chưa phân công...</option>
              {teachers.map((t: any) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
            </select>
          </div>

          {/* Học phí */}
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Học phí / buổi (đ) *</label>
            <input type="number" value={form.tuitionRate} onChange={set('tuitionRate')} required placeholder="200000" min={0}
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>

          {/* Lịch học */}
          <div className="bg-surface-container-low rounded-2xl p-4 space-y-3">
            <p className="text-[10px] font-bold text-outline uppercase tracking-wider flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px]">calendar_month</span>
              Lịch học
              <span className="text-outline/50 normal-case font-normal ml-1">— click thứ để thêm</span>
            </p>

            {/* Thứ trong tuần */}
            <div className="flex gap-2">
              {DAY_OF_WEEK_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleDay(value)}
                  className={`flex-1 h-9 rounded-xl text-xs font-bold transition-all ${
                    daySchedules[value]
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'bg-surface-container text-outline hover:bg-surface-container-high'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Giờ học theo từng thứ đã chọn */}
            {selectedDays.length > 0 && (
              <div className="space-y-2 pt-1">
                {selectedDays.map(({ value, label }) => (
                  <div key={value} className="flex items-center gap-3 bg-surface-container rounded-xl px-3 py-2">
                    <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary text-xs font-black flex items-center justify-center flex-shrink-0">{label}</span>
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="time"
                        value={daySchedules[value].startTime}
                        onChange={(e) => setDayTime(value, 'startTime', e.target.value)}
                        className="flex-1 bg-surface-container-lowest border-none rounded-lg py-1.5 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <span className="text-xs text-outline">→</span>
                      <input
                        type="time"
                        value={daySchedules[value].endTime}
                        onChange={(e) => setDayTime(value, 'endTime', e.target.value)}
                        className="flex-1 bg-surface-container-lowest border-none rounded-lg py-1.5 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <button type="button" onClick={() => toggleDay(value)} className="p-1 hover:bg-error/10 rounded-lg text-outline hover:text-error transition-colors">
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ngày bắt đầu / kết thúc */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Ngày bắt đầu *</label>
              <input type="date" value={form.startDate} onChange={set('startDate')} required
                className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">
                Ngày kết thúc <span className="text-outline/50 normal-case font-normal">(tuỳ chọn)</span>
              </label>
              <input type="date" value={form.endDate} onChange={set('endDate')}
                className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary justify-center">Huỷ</button>
            <button type="submit" disabled={saving} className="flex-1 btn-primary justify-center disabled:opacity-60">
              {saving ? 'Đang tạo...' : 'Tạo lớp học'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Edit Class Modal ────────────────────────────────────────────────────────

function EditClassModal({ cls, onClose, onSaved }: { cls: Class; onClose: () => void; onSaved: () => void }) {
  const [teachers, setTeachers] = useState<any[]>([])
  const todayLocal = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()
  const [form, setForm] = useState({
    name: cls.name,
    teacherId: cls.teacherId ?? '',
    tuitionRate: String(cls.tuitionRate ?? ''),
    startDate: cls.startDate ?? todayLocal,
    endDate: cls.endDate ?? '',
    effectiveDate: todayLocal,
  })
  const [daySchedules, setDaySchedules] = useState<Record<string, DaySchedule>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/teachers').then((r) => setTeachers(Array.isArray(r.data) ? r.data : r.data?.data ?? [])).catch(() => {})
    api.get(`/schedules?classId=${cls.id}`).then((r) => {
      const list = Array.isArray(r.data) ? r.data : r.data?.data ?? []
      const existing: Record<string, DaySchedule> = {}
      for (const s of list) existing[s.dayOfWeek] = { startTime: s.startTime, endTime: s.endTime }
      setDaySchedules(existing)
    }).catch(() => {})
  }, [cls.id])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const toggleDay = (day: string) => {
    setDaySchedules((prev) => {
      if (prev[day]) { const n = { ...prev }; delete n[day]; return n }
      return { ...prev, [day]: { startTime: '08:00', endTime: '10:00' } }
    })
  }

  const setDayTime = (day: string, field: 'startTime' | 'endTime', value: string) =>
    setDaySchedules((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }))

  const selectedDays = DAY_OF_WEEK_OPTIONS.filter((d) => daySchedules[d.value])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name) { setError('Vui lòng nhập tên lớp'); return }
    setSaving(true); setError('')
    try {
      const updates: Record<string, unknown> = { name: form.name }
      if (form.teacherId) updates.teacherId = form.teacherId
      if (form.tuitionRate) updates.tuitionRate = Number(form.tuitionRate)
      if (form.startDate) updates.startDate = form.startDate
      if (form.endDate) updates.endDate = form.endDate
      await api.put(`/classes/${cls.id}`, updates)

      // Xóa schedules cũ rồi tạo lại
      const oldRes = await api.get(`/schedules?classId=${cls.id}`)
      const oldList = Array.isArray(oldRes.data) ? oldRes.data : oldRes.data?.data ?? []
      await Promise.all(oldList.map((s: any) => api.delete(`/schedules/${s.id}`).catch(() => {})))

      // Xoá SCHEDULED sessions từ ngày áp dụng trở đi
      await api.delete(`/sessions/scheduled?classId=${cls.id}`).catch(() => {})

      const days = Object.entries(daySchedules)
      if (days.length > 0) {
        await Promise.all(days.map(([dayOfWeek, { startTime, endTime }]) =>
          api.post('/schedules', {
            classId: cls.id, dayOfWeek, startTime, endTime,
            effectiveFrom: form.effectiveDate,
            ...(form.endDate && { effectiveTo: form.endDate }),
          })
        ))
        // Generate từ effectiveDate đến hết tháng sau
        const eff = new Date(form.effectiveDate)
        const nxt = new Date(eff); nxt.setMonth(nxt.getMonth() + 1)
        await Promise.all([
          api.post('/schedules/generate-month', { classId: cls.id, month: eff.getMonth() + 1, year: eff.getFullYear() }).catch(() => {}),
          api.post('/schedules/generate-month', { classId: cls.id, month: nxt.getMonth() + 1, year: nxt.getFullYear() }).catch(() => {}),
        ])
      }
      onSaved()
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Có lỗi xảy ra')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-container-lowest rounded-2xl shadow-2xl p-8 z-10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-headline font-bold text-on-surface">Chỉnh sửa lớp học</h3>
          <button onClick={onClose} className="p-2 hover:bg-surface-container-low rounded-lg"><span className="material-symbols-outlined">close</span></button>
        </div>
        {error && <div className="mb-4 p-3 bg-error-container/10 text-error rounded-xl text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Tên lớp *</label>
            <input value={form.name} onChange={set('name')} required
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">
              Giáo viên <span className="text-outline/50 normal-case font-normal">(có thể bổ sung sau)</span>
            </label>
            <select value={form.teacherId} onChange={set('teacherId')}
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">Chưa phân công...</option>
              {teachers.map((t: any) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Học phí / buổi (đ)</label>
            <input type="number" value={form.tuitionRate} onChange={set('tuitionRate')} placeholder="200000" min={0}
              className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div className="bg-surface-container-low rounded-2xl p-4 space-y-3">
            <p className="text-[10px] font-bold text-outline uppercase tracking-wider flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px]">calendar_month</span>
              Lịch học
              <span className="text-outline/50 normal-case font-normal ml-1">— click thứ để thêm/bỏ</span>
            </p>
            <div className="flex gap-2">
              {DAY_OF_WEEK_OPTIONS.map(({ value, label }) => (
                <button key={value} type="button" onClick={() => toggleDay(value)}
                  className={`flex-1 h-9 rounded-xl text-xs font-bold transition-all ${daySchedules[value] ? 'bg-primary text-on-primary shadow-sm' : 'bg-surface-container text-outline hover:bg-surface-container-high'}`}>
                  {label}
                </button>
              ))}
            </div>
            {selectedDays.length > 0 && (
              <div className="space-y-2 pt-1">
                {selectedDays.map(({ value, label }) => (
                  <div key={value} className="flex items-center gap-3 bg-surface-container rounded-xl px-3 py-2">
                    <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary text-xs font-black flex items-center justify-center flex-shrink-0">{label}</span>
                    <div className="flex items-center gap-2 flex-1">
                      <input type="time" value={daySchedules[value].startTime} onChange={(e) => setDayTime(value, 'startTime', e.target.value)}
                        className="flex-1 bg-surface-container-lowest border-none rounded-lg py-1.5 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      <span className="text-xs text-outline">→</span>
                      <input type="time" value={daySchedules[value].endTime} onChange={(e) => setDayTime(value, 'endTime', e.target.value)}
                        className="flex-1 bg-surface-container-lowest border-none rounded-lg py-1.5 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <button type="button" onClick={() => toggleDay(value)} className="p-1 hover:bg-error/10 rounded-lg text-outline hover:text-error transition-colors">
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Ngày bắt đầu</label>
              <input type="date" value={form.startDate} onChange={set('startDate')}
                className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">
                Ngày kết thúc <span className="text-outline/50 normal-case font-normal">(tuỳ chọn)</span>
              </label>
              <input type="date" value={form.endDate} onChange={set('endDate')}
                className="w-full bg-surface-container-low border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4">
            <label className="text-[10px] font-bold text-primary uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px]">update</span>
              Ngày áp dụng lịch mới *
            </label>
            <input type="date" value={form.effectiveDate} onChange={set('effectiveDate')} required
              className="w-full bg-white border-none rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
            <p className="text-[11px] text-primary/70 mt-1.5">Các buổi học chưa diễn ra từ ngày này sẽ được tạo lại theo lịch mới. Buổi đã hoàn thành không bị ảnh hưởng.</p>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary justify-center">Huỷ</button>
            <button type="submit" disabled={saving} className="flex-1 btn-primary justify-center disabled:opacity-60">
              {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Delete Class Modal ───────────────────────────────────────────────────────

function DeleteClassModal({ cls, onClose, onDone }: {
  cls: Class
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [mode, setMode] = useState<'delete' | 'end'>('delete')
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    setSaving(true)
    setError('')
    try {
      if (mode === 'delete') {
        await api.delete(`/classes/${cls.id}`)
        onDone('Đã xóa lớp học')
      } else {
        await api.put(`/classes/${cls.id}/end`, { endDate })
        onDone('Đã kết thúc lớp học')
      }
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Có lỗi xảy ra')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface-container-lowest rounded-2xl shadow-2xl z-10 overflow-hidden">

        {/* Header */}
        <div className="p-6 border-b border-outline-variant/10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-headline font-bold text-on-surface">Quản lý lớp học</h3>
              <p className="text-sm text-outline mt-0.5">"{cls.name}"</p>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-surface-container-low rounded-lg shrink-0">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        </div>

        {/* Mode tabs */}
        <div className="px-6 pt-5">
          <div className="flex gap-2 p-1 bg-surface-container-low rounded-xl">
            <button
              onClick={() => { setMode('end'); setError('') }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all ${
                mode === 'end'
                  ? 'bg-surface text-on-surface shadow-sm'
                  : 'text-outline hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-base">event_busy</span>
              Kết thúc lớp
            </button>
            <button
              onClick={() => { setMode('delete'); setError('') }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all ${
                mode === 'delete'
                  ? 'bg-error/10 text-error shadow-sm'
                  : 'text-outline hover:text-error'
              }`}
            >
              <span className="material-symbols-outlined text-base">delete_forever</span>
              Xóa toàn bộ
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {mode === 'end' ? (
            <>
              <div>
                <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5">Ngày kết thúc</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="input w-full"
                />
              </div>
              <div className="flex items-start gap-2.5 p-3.5 bg-primary-container/10 rounded-xl">
                <span className="material-symbols-outlined text-primary text-base shrink-0 mt-0.5">info</span>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Lớp sẽ được đánh dấu <strong>Đã đóng</strong>. Lịch lặp lại, buổi học và học phí <strong>sau ngày kết thúc</strong> sẽ bị xóa. Dữ liệu lịch sử được giữ lại.
                </p>
              </div>
            </>
          ) : (
            <div className="flex items-start gap-2.5 p-3.5 bg-error-container/10 rounded-xl">
              <span className="material-symbols-outlined text-error text-base shrink-0 mt-0.5">warning</span>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                <strong className="text-error">Không thể hoàn tác.</strong> Toàn bộ dữ liệu lớp học sẽ bị xóa vĩnh viễn bao gồm lịch học, buổi học, học phí, điểm danh và thông tin đăng ký.
              </p>
            </div>
          )}

          {error && <p className="text-xs text-error">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="btn-secondary flex-1" disabled={saving}>Huỷ</button>
            <button
              onClick={handleConfirm}
              disabled={saving}
              className={`flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-60 ${
                mode === 'delete'
                  ? 'bg-error text-on-error hover:opacity-90 shadow-md'
                  : 'btn-primary'
              }`}
            >
              {saving && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              {mode === 'delete' ? 'Xóa toàn bộ' : 'Kết thúc lớp'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Auto-init attendance button ─────────────────────────────────────────────

function AutoInitAttendanceBtn() {
  const [loading, setLoading] = useState(false)

  const run = async () => {
    if (!window.confirm('Tự động khởi tạo điểm danh (mặc định Có mặt) cho tất cả buổi học đã qua chưa điểm danh?')) return
    setLoading(true)
    try {
      const res = await api.post('/sessions/auto-init-attendance')
      alert(res.data.message)
    } catch {
      alert('Có lỗi xảy ra')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button onClick={run} disabled={loading} className="btn-secondary disabled:opacity-60 flex items-center gap-2">
      <span className="material-symbols-outlined text-base">{loading ? 'hourglass_empty' : 'auto_fix_high'}</span>
      {loading ? 'Đang xử lý...' : 'Điểm danh tự động'}
    </button>
  )
}

// ─── Main Classes Page ───────────────────────────────────────────────────────

export default function Classes() {
  const [tab, setTab] = useState<'schedule' | 'classes'>('schedule')
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [sessions, setSessions] = useState<Session[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [showClassModal, setShowClassModal] = useState(false)
  const [editingClass, setEditingClass] = useState<Class | null>(null)
  const [deletingClass, setDeletingClass] = useState<Class | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const showToast = (message: string, type: ToastMessage['type'] = 'info') =>
    setToasts(prev => [...prev, { id: Date.now(), message, type }])
  const dismissToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id))
  const loadSessions = useCallback((ws: Date) => {
    setLoadingSessions(true)
    const from = toISO(ws)
    const to = toISO(addDays(ws, 6))
    api.get(`/sessions?fromDate=${from}&toDate=${to}`)
      .then((r) => setSessions(Array.isArray(r.data) ? r.data : r.data?.data ?? []))
      .finally(() => setLoadingSessions(false))
  }, [])

  const loadClasses = () =>
    api.get('/classes?limit=50').then((r) => setClasses(r.data?.data ?? r.data)).catch(() => {})

  useEffect(() => {
    loadSessions(weekStart)
    loadClasses()
  }, [])

  const prevWeek = () => { const ws = addDays(weekStart, -7); setWeekStart(ws); loadSessions(ws) }
  const nextWeek = () => { const ws = addDays(weekStart, 7); setWeekStart(ws); loadSessions(ws) }
  const goToday = () => { const ws = getWeekStart(new Date()); setWeekStart(ws); loadSessions(ws) }

  // Build week days (Mon–Sun)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const todayStr = toISO(new Date())

  // Collect unique time slots sorted
  const timeSlots = [...new Set(sessions.map((s) => s.startTime))].sort()

  // Map: day ISO → time → sessions[]
  const grid: Record<string, Record<string, Session[]>> = {}
  for (const s of sessions) {
    if (!grid[s.sessionDate]) grid[s.sessionDate] = {}
    if (!grid[s.sessionDate][s.startTime]) grid[s.sessionDate][s.startTime] = []
    grid[s.sessionDate][s.startTime].push(s)
  }

  // Color by classId
  const classColorMap: Record<string, (typeof CLASS_COLORS)[number]> = {}
  let colorIdx = 0
  for (const s of sessions) {
    if (!classColorMap[s.classId]) {
      classColorMap[s.classId] = CLASS_COLORS[colorIdx % CLASS_COLORS.length]
      colorIdx++
    }
  }

  const sessionCounts = {
    total: sessions.length,
    completed: sessions.filter((s) => s.status === 'COMPLETED').length,
    cancelled: sessions.filter((s) => s.status === 'CANCELLED').length,
  }

  const handleDeleteClass = (cls: Class) => setDeletingClass(cls)

  const [generatingAll, setGeneratingAll] = useState(false)
  const handleGenerateAll = async () => {
    setGeneratingAll(true)
    try {
      const cur = new Date()
      const nxt = new Date(); nxt.setMonth(nxt.getMonth() + 1)
      const activeClasses = classes.filter((c) => c.status === 'ACTIVE')
      await Promise.all(
        activeClasses.flatMap((c) => [
          api.post('/schedules/generate-month', { classId: c.id, month: cur.getMonth() + 1, year: cur.getFullYear() }).catch(() => {}),
          api.post('/schedules/generate-month', { classId: c.id, month: nxt.getMonth() + 1, year: nxt.getFullYear() }).catch(() => {}),
        ])
      )
      loadSessions(weekStart)
    } finally {
      setGeneratingAll(false)
    }
  }

  return (
    <div>
      <TopBar title="Lịch & Lớp học" />
      <div className="px-8 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <span className="text-[11px] font-bold text-primary tracking-[0.2em] uppercase mb-2 block">Lịch Đào Tạo</span>
            <h2 className="text-4xl font-black text-on-surface font-headline tracking-tight">Quản Lý Lịch & Lớp Học</h2>
          </div>
          <div className="flex gap-2">
            <AutoInitAttendanceBtn />
            <button onClick={() => setShowClassModal(true)} className="btn-primary">
              <span className="material-symbols-outlined">add</span>Tạo lớp mới
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-outline-variant/20">
          {[
            { key: 'schedule', label: 'Lịch học', icon: 'calendar_month' },
            { key: 'classes', label: 'Danh sách lớp học', icon: 'school' },
          ].map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key as any)}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-semibold border-b-2 transition-all ${tab === key ? 'border-primary text-primary' : 'border-transparent text-outline hover:text-on-surface'}`}
            >
              <span className="material-symbols-outlined text-[18px]">{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {/* ── Tab: Lịch học ── */}
        {tab === 'schedule' && (
          <div className="space-y-4">
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
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-4 text-[11px] font-bold text-outline">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary inline-block"></span>{sessionCounts.total} buổi</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-secondary inline-block"></span>{sessionCounts.completed} hoàn thành</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-error inline-block"></span>{sessionCounts.cancelled} huỷ</span>
                  {(loadingSessions || generatingAll) && <span className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full inline-block"></span>}
                </div>
                <button
                  onClick={handleGenerateAll}
                  disabled={generatingAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/8 text-primary text-xs font-bold hover:bg-primary/15 transition-all disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[15px]">event_sync</span>
                  Cập nhật lịch
                </button>
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
                        <span className="material-symbols-outlined text-5xl block mb-3 opacity-20">event_busy</span>
                        <p className="text-sm font-medium">Không có buổi học trong tuần này</p>
                        <p className="text-xs mt-1">Chọn tuần khác hoặc tạo buổi học từ tab "Danh sách lớp học"</p>
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
                                const color = classColorMap[s.classId] ?? CLASS_COLORS[0]
                                const isCancelled = s.status === 'CANCELLED'
                                return (
                                  <button
                                    key={s.id}
                                    onClick={() => setSelectedSession(s)}
                                    className={`w-full text-left p-2.5 rounded-xl ${color.bg} border-l-4 ${color.border} space-y-1.5 mb-2 hover:shadow-md transition-all ${isCancelled ? 'opacity-50' : ''}`}
                                  >
                                    <p className={`text-xs font-bold ${color.text} leading-tight`}>
                                      {isCancelled ? <span className="line-through">{s.className}</span> : s.className}
                                    </p>
                                    <div className="flex items-center justify-between gap-1">
                                      <span className={`text-[10px] ${color.badge} flex items-center gap-0.5`}>
                                        <span className="material-symbols-outlined text-[11px]">person</span>
                                        {s.teacherName?.split(' ').slice(-1)[0] ?? ''}
                                      </span>
                                      {s.status === 'COMPLETED' && (
                                        <span className="material-symbols-outlined text-[14px] text-secondary">check_circle</span>
                                      )}
                                      {s.status === 'CANCELLED' && (
                                        <span className="material-symbols-outlined text-[14px] text-error">cancel</span>
                                      )}
                                    </div>
                                    <p className={`text-[10px] ${color.badge}`}>{s.startTime}–{s.endTime}</p>
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
          </div>
        )}

        {/* ── Tab: Danh sách lớp học ── */}
        {tab === 'classes' && (
          <div className="space-y-6">
            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-primary text-on-primary p-5 rounded-2xl relative overflow-hidden group">
                <div className="relative z-10">
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-80 mb-1">Đang hoạt động</p>
                  <h4 className="text-4xl font-headline font-black">{classes.filter((c) => c.status === 'ACTIVE').length}</h4>
                  <p className="text-xs opacity-70 mt-1">lớp học</p>
                </div>
                <span className="material-symbols-outlined absolute -right-2 -bottom-2 text-8xl opacity-10">school</span>
              </div>
              <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-outline-variant/10">
                <p className="text-[10px] font-bold uppercase tracking-widest text-outline mb-1">Tổng lớp</p>
                <h4 className="text-4xl font-headline font-black text-on-surface">{classes.length}</h4>
                <p className="text-xs text-outline mt-1">tất cả</p>
              </div>
              <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-outline-variant/10">
                <p className="text-[10px] font-bold uppercase tracking-widest text-outline mb-1">Đã đóng</p>
                <h4 className="text-4xl font-headline font-black text-on-surface">{classes.filter((c) => c.status !== 'ACTIVE').length}</h4>
                <p className="text-xs text-outline mt-1">lớp học</p>
              </div>
              <button
                onClick={() => setShowClassModal(true)}
                className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border-2 border-dashed border-outline-variant/30 hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-2 text-outline hover:text-primary group"
              >
                <span className="material-symbols-outlined text-3xl">add_circle</span>
                <span className="text-xs font-bold">Thêm lớp mới</span>
              </button>
            </div>

            {/* Class cards grid */}
            {classes.length === 0 ? (
              <div className="py-20 text-center text-outline bg-surface-container-lowest rounded-2xl border border-outline-variant/10">
                <span className="material-symbols-outlined text-5xl block mb-3 opacity-20">school</span>
                <p className="text-sm font-medium">Chưa có lớp học nào</p>
                <button onClick={() => setShowClassModal(true)} className="btn-primary mt-4 mx-auto">
                  <span className="material-symbols-outlined">add</span>Tạo lớp học đầu tiên
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {classes.map((cls, i) => {
                  const color = CLASS_COLORS[i % CLASS_COLORS.length]
                  return (
                    <div key={cls.id} className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10 hover:border-primary/30 hover:shadow-md transition-all group">
                      {/* Card header */}
                      <div className="flex items-start justify-between mb-4">
                        <div className={`w-12 h-12 rounded-2xl ${color.bg} ${color.badge} flex items-center justify-center`}>
                          <span className="material-symbols-outlined text-xl">class</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${cls.status === 'ACTIVE' ? 'text-secondary bg-secondary-container/30' : 'text-outline bg-surface-container-high'}`}>
                            {cls.status === 'ACTIVE' ? 'Đang học' : 'Đóng'}
                          </span>
                          <button
                            onClick={() => setEditingClass(cls)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-primary/10 text-outline hover:text-primary transition-all"
                            title="Chỉnh sửa"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                          </button>
                          <button
                            onClick={() => handleDeleteClass(cls)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-error/10 text-outline hover:text-error transition-all"
                            title="Xoá lớp"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </div>
                      </div>

                      {/* Class name */}
                      <h3 className="text-base font-bold text-on-surface mb-1 leading-tight">{cls.name}</h3>

                      {/* Teacher */}
                      <p className="text-sm text-outline mb-4 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[14px]">person</span>
                        {cls.teacherName}
                      </p>

                      {/* Info chips */}
                      <div className="flex flex-wrap gap-2 mb-4">
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-on-surface-variant bg-surface-container-low px-2.5 py-1 rounded-lg">
                          <span className="material-symbols-outlined text-[13px]">payments</span>
                          {(cls.tuitionRate ?? 0).toLocaleString('vi-VN')}đ/buổi
                        </span>
                        {cls.sessionsPerMonth && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-on-surface-variant bg-surface-container-low px-2.5 py-1 rounded-lg">
                            <span className="material-symbols-outlined text-[13px]">event_repeat</span>
                            {cls.sessionsPerMonth} buổi/tháng
                          </span>
                        )}
                        {cls.room && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/5 px-2.5 py-1 rounded-lg">
                            <span className="material-symbols-outlined text-[13px]">door_open</span>
                            Phòng {cls.room}
                          </span>
                        )}
                        {cls.gradeLevel && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-on-surface-variant bg-surface-container-low px-2.5 py-1 rounded-lg">
                            <span className="material-symbols-outlined text-[13px]">grade</span>
                            Lớp {cls.gradeLevel}
                          </span>
                        )}
                      </div>

                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowClassModal(true)}
        className="fixed bottom-8 right-8 w-14 h-14 bg-primary text-on-primary rounded-2xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all z-40 group"
      >
        <span className="material-symbols-outlined text-2xl">edit_calendar</span>
        <span className="absolute right-full mr-4 bg-on-surface text-white px-3 py-1.5 rounded-lg text-xs font-bold opacity-0 group-hover:opacity-100 whitespace-nowrap transition-opacity">Tạo lớp mới</span>
      </button>

      {/* Modals */}
      {selectedSession && (
        <AttendanceModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          onDone={() => { setSelectedSession(null); loadSessions(weekStart) }}
          onSessionUpdate={(patch) => {
            setSessions(prev => prev.map(s => s.id === selectedSession.id ? { ...s, ...patch } : s))
            setSelectedSession(prev => prev ? { ...prev, ...patch } : prev)
          }}
        />
      )}
      {showClassModal && (
        <ClassModal
          onClose={() => setShowClassModal(false)}
          onSaved={() => { setShowClassModal(false); loadClasses() }}
        />
      )}
      {editingClass && (
        <EditClassModal
          cls={editingClass}
          onClose={() => setEditingClass(null)}
          onSaved={() => { setEditingClass(null); loadClasses(); loadSessions(weekStart) }}
        />
      )}
      {deletingClass && (
        <DeleteClassModal
          cls={deletingClass}
          onClose={() => setDeletingClass(null)}
          onDone={(msg) => {
            setDeletingClass(null)
            loadClasses()
            loadSessions(weekStart)
            showToast(msg, 'success')
          }}
        />
      )}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
