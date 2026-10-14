import React, { useEffect, useState, useCallback } from 'react'
import TopBar from '../components/TopBar'
import Toast, { ToastMessage } from '../components/Toast'
import { useConfirm, useAlert } from '../components/ConfirmDialog'
import api from '../services/api'
import { Session, Class } from '../types'
import { useAuth } from '../hooks/useAuth'
import { gradeOfClass } from '../lib/classGrade'

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
const SCHEDULE_DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const SCHEDULE_DAY_LABELS: Record<string, string> = {
  MONDAY: 'T2', TUESDAY: 'T3', WEDNESDAY: 'T4', THURSDAY: 'T5',
  FRIDAY: 'T6', SATURDAY: 'T7', SUNDAY: 'CN',
}
const CLASS_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-500', text: 'text-blue-900', badge: 'text-blue-600' },
  { bg: 'bg-secondary-container/20', border: 'border-secondary', text: 'text-on-secondary-container', badge: 'text-secondary' },
  { bg: 'bg-tertiary-container/20', border: 'border-tertiary', text: 'text-tertiary-dim', badge: 'text-tertiary' },
  { bg: 'bg-orange-50', border: 'border-orange-400', text: 'text-orange-900', badge: 'text-orange-600' },
  { bg: 'bg-pink-50', border: 'border-pink-400', text: 'text-pink-900', badge: 'text-pink-600' },
]

// ─── Session details ───────────────────────────────────────────────────────

function SessionModal({ session, onClose, onDone, onSessionUpdate }: {
  session: Session
  onClose: () => void
  onDone: () => void
  onSessionUpdate?: (patch: Partial<Session>) => void
}) {
  const [sessionStatus, setSessionStatus] = useState(session.status)
  const [teachers, setTeachers] = useState<any[]>([])
  const [teacherId, setTeacherId] = useState(session.teacherId ?? '')
  const [savingTeacher, setSavingTeacher] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  const [error, setError] = useState('')
  const { canManageClasses } = useAuth()
  const todayLocal = toISO(new Date())
  const isPast = session.sessionDate <= todayLocal
  const isCancelled = sessionStatus === 'CANCELLED'

  useEffect(() => {
    api.get('/teachers')
      .then(r => setTeachers(Array.isArray(r.data) ? r.data : (r.data?.data ?? [])))
      .catch(() => setTeachers([]))
  }, [])

  const handleTeacherChange = async (newTeacherId: string) => {
    setSavingTeacher(true)
    setError('')
    try {
      await api.put(`/sessions/${session.id}`, { teacherId: newTeacherId || null })
      const teacherName = teachers.find(t => t.id === newTeacherId)?.fullName ?? ''
      setTeacherId(newTeacherId)
      onSessionUpdate?.({ teacherId: newTeacherId || undefined, teacherName })
    } catch {
      setError('Không thể cập nhật giáo viên. Vui lòng thử lại.')
    } finally {
      setSavingTeacher(false)
    }
  }

  const handleComplete = async () => {
    setSavingStatus(true)
    setError('')
    try {
      await api.put(`/sessions/${session.id}/complete`, {})
      setSessionStatus('COMPLETED')
      onSessionUpdate?.({ status: 'COMPLETED' })
    } catch {
      setError('Không thể hoàn thành buổi học. Vui lòng thử lại.')
    } finally {
      setSavingStatus(false)
    }
  }

  const handleCancel = async () => {
    const reason = prompt('Lý do huỷ buổi học:')
    if (reason === null) return
    setSavingStatus(true)
    setError('')
    try {
      await api.put(`/sessions/${session.id}/cancel`, { cancelReason: reason })
      onDone()
    } catch {
      setError('Không thể huỷ buổi học. Vui lòng thử lại.')
      setSavingStatus(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="session-modal-title" className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl">
        <div className="border-b border-outline-variant/15 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 id="session-modal-title" className="font-headline text-lg font-bold text-on-surface">{session.className}</h3>
              <p className="mt-1 text-sm text-outline">
                {new Date(session.sessionDate + 'T12:00:00').toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                {' • '}{session.startTime} – {session.endTime}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Đóng chi tiết buổi học" className="rounded-lg p-1.5 text-outline hover:bg-surface-container-low">
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-on-surface-variant">Trạng thái buổi học</span>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isCancelled ? 'bg-error/10 text-error' : sessionStatus === 'COMPLETED' ? 'bg-secondary-container/30 text-secondary' : 'bg-primary/10 text-primary'}`}>
              {isCancelled ? 'Đã huỷ' : sessionStatus === 'COMPLETED' ? 'Hoàn thành' : 'Dự kiến'}
            </span>
          </div>
          {isCancelled ? (
            <p className="rounded-xl bg-error/5 p-3 text-sm text-on-surface-variant">{session.cancelReason ? `Lý do huỷ: ${session.cancelReason}` : 'Buổi học đã bị huỷ và không tính học phí.'}</p>
          ) : (
            <div>
              <label htmlFor="session-teacher" className="mb-1.5 block text-sm font-medium text-on-surface">Giáo viên phụ trách</label>
              <select id="session-teacher" value={teacherId} onChange={e => handleTeacherChange(e.target.value)} disabled={savingTeacher || savingStatus}
                className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60">
                <option value="">Chưa phân công</option>
                {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
              </select>
              {savingTeacher && <p className="mt-1 text-xs text-outline">Đang lưu giáo viên...</p>}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
        </div>

        {!isCancelled && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-outline-variant/15 px-6 py-4">
            {canManageClasses && <button type="button" onClick={handleCancel} disabled={savingStatus} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-error hover:bg-error/10 disabled:opacity-50">Huỷ buổi học</button>}
            {sessionStatus === 'SCHEDULED' && isPast && <button type="button" onClick={handleComplete} disabled={savingStatus} className="btn-primary disabled:opacity-50">{savingStatus ? 'Đang lưu...' : 'Đánh dấu hoàn thành'}</button>}
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
  const [schedulesLoaded, setSchedulesLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/teachers').then((r) => setTeachers(Array.isArray(r.data) ? r.data : r.data?.data ?? [])).catch(() => {})
    api.get(`/schedules?classId=${cls.id}`).then((r) => {
      const list = Array.isArray(r.data) ? r.data : r.data?.data ?? []
      const existing: Record<string, DaySchedule> = {}
      for (const s of list.filter((s: any) => s.effectiveFrom <= todayLocal && (!s.effectiveTo || s.effectiveTo >= todayLocal))) {
        existing[s.dayOfWeek] = { startTime: s.startTime, endTime: s.endTime }
      }
      setDaySchedules(existing)
      setSchedulesLoaded(true)
    }).catch(() => setError('Không tải được lịch học. Vui lòng mở lại để thử lại.'))
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
    if (!schedulesLoaded) { setError('Lịch học chưa tải xong. Vui lòng thử lại.'); return }
    setSaving(true); setError('')
    try {
      const oldRes = await api.get(`/schedules?classId=${cls.id}`)
      const oldList = Array.isArray(oldRes.data) ? oldRes.data : oldRes.data?.data ?? []
      const activeOld = oldList.filter((s: any) => s.effectiveFrom <= todayLocal && (!s.effectiveTo || s.effectiveTo >= todayLocal))
      const oldDays = activeOld.map((s: any) => `${s.dayOfWeek}:${s.startTime}-${s.endTime}`).sort()
      const newDays = Object.entries(daySchedules).map(([day, time]) => `${day}:${time.startTime}-${time.endTime}`).sort()
      const scheduleChanged = JSON.stringify(oldDays) !== JSON.stringify(newDays)
        || form.endDate !== (cls.endDate ?? '')
        || form.startDate !== (cls.startDate ?? todayLocal)
      const updates: Record<string, unknown> = { name: form.name }
      if (form.teacherId) updates.teacherId = form.teacherId
      if (form.tuitionRate) updates.tuitionRate = Number(form.tuitionRate)
      if (form.startDate) updates.startDate = form.startDate
      if (form.endDate) updates.endDate = form.endDate
      await api.put(`/classes/${cls.id}`, updates)

      // Chỉ xây lại buổi học khi lịch thực sự đổi. Đổi tên lớp không ảnh hưởng học phí.
      if (scheduleChanged) {
        await api.delete(`/sessions/scheduled?classId=${encodeURIComponent(cls.id)}&fromDate=${form.effectiveDate}`)
        await Promise.all(activeOld.map((s: any) => api.delete(`/schedules/${s.id}`)))
        const days = Object.entries(daySchedules)
        await Promise.all(days.map(([dayOfWeek, { startTime, endTime }]) =>
          api.post('/schedules', {
            classId: cls.id, dayOfWeek, startTime, endTime,
            effectiveFrom: form.effectiveDate,
            ...(form.endDate && { effectiveTo: form.endDate }),
          })
        ))
        // Generate từ effectiveDate đến hết tháng sau
        const eff = new Date(`${form.effectiveDate}T00:00:00`)
        const nxt = new Date(eff); nxt.setMonth(nxt.getMonth() + 1)
        await Promise.all([
          api.post('/schedules/generate-month', { classId: cls.id, month: eff.getMonth() + 1, year: eff.getFullYear() }),
          api.post('/schedules/generate-month', { classId: cls.id, month: nxt.getMonth() + 1, year: nxt.getFullYear() }),
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
            <button type="submit" disabled={saving || !schedulesLoaded} className="flex-1 btn-primary justify-center disabled:opacity-60">
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

// ─── Complete past sessions without attendance ───────────────────────────────

function CompletePastSessionsBtn({ onDone }: { onDone: () => void }) {
  const confirm = useConfirm()
  const alert = useAlert()
  const [loading, setLoading] = useState(false)

  const run = async () => {
    const ok = await confirm({
      title: 'Hoàn thành các buổi đã qua',
      message: 'Đánh dấu hoàn thành tất cả buổi học đã qua còn ở trạng thái Dự kiến?',
      confirmLabel: 'Hoàn thành',
    })
    if (!ok) return
    setLoading(true)
    try {
      const res = await api.post('/sessions/complete-past')
      onDone()
      await alert(res.data.message)
    } catch {
      await alert('Có lỗi xảy ra')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button onClick={run} disabled={loading} className="btn-secondary disabled:opacity-60 flex items-center gap-2">
      <span className="material-symbols-outlined text-base">{loading ? 'hourglass_empty' : 'auto_fix_high'}</span>
      {loading ? 'Đang xử lý...' : 'Hoàn thành buổi đã qua'}
    </button>
  )
}

// ─── Main Classes Page ───────────────────────────────────────────────────────

export default function Classes() {
  const [tab, setTab] = useState<'schedule' | 'classes'>('schedule')
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [sessions, setSessions] = useState<Session[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [classSearch, setClassSearch] = useState('')
  const [classStatus, setClassStatus] = useState<'ALL' | 'ACTIVE' | 'CLOSED'>('ALL')
  const [classGrade, setClassGrade] = useState('ALL')
  const [schedulesByClass, setSchedulesByClass] = useState<Record<string, string[]>>({})
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [showClassModal, setShowClassModal] = useState(false)
  const [editingClass, setEditingClass] = useState<Class | null>(null)
  const [deletingClass, setDeletingClass] = useState<Class | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const { canManageClasses } = useAuth()
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

  const loadSchedules = () =>
    api.get('/schedules').then((r) => {
      const list: Array<{ classId: string; dayOfWeek: string }> = Array.isArray(r.data) ? r.data : []
      const map: Record<string, string[]> = {}
      for (const s of list) {
        if (!map[s.classId]) map[s.classId] = []
        if (!map[s.classId].includes(s.dayOfWeek)) map[s.classId].push(s.dayOfWeek)
      }
      setSchedulesByClass(map)
    }).catch(() => {})

  useEffect(() => {
    loadSessions(weekStart)
    loadClasses()
    loadSchedules()
  }, [])

  const prevWeek = () => { const ws = addDays(weekStart, -7); setWeekStart(ws); loadSessions(ws) }
  const nextWeek = () => { const ws = addDays(weekStart, 7); setWeekStart(ws); loadSessions(ws) }
  const goToday = () => { const ws = getWeekStart(new Date()); setWeekStart(ws); loadSessions(ws) }

  // Build week days (Mon–Sun)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const todayStr = toISO(new Date())

  // Collect unique time slots sorted
  const timeSlots = [...new Set(sessions.map((s) => s.startTime))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }))

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

  const classGrades = [...new Set(classes.map(gradeOfClass).filter((grade): grade is number => grade !== null))].sort((a, b) => a - b)
  const visibleClasses = classes
    .filter((cls) => {
      const matchesSearch = `${cls.name} ${cls.teacherName ?? ''}`.toLocaleLowerCase('vi-VN').includes(classSearch.trim().toLocaleLowerCase('vi-VN'))
      return matchesSearch && (classStatus === 'ALL' || cls.status === classStatus)
        && (classGrade === 'ALL' || gradeOfClass(cls) === Number(classGrade))
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1
      return (gradeOfClass(a) ?? 99) - (gradeOfClass(b) ?? 99) || a.name.localeCompare(b.name, 'vi')
    })

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
      <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <span className="text-[11px] font-bold text-primary tracking-[0.2em] uppercase mb-2 block">Lịch Đào Tạo</span>
            <h2 className="text-4xl font-black text-on-surface font-headline tracking-tight">Quản Lý Lịch & Lớp Học</h2>
          </div>
          <div className="flex gap-2">
            {canManageClasses && <CompletePastSessionsBtn onDone={() => loadSessions(weekStart)} />}
            {canManageClasses && (
              <button onClick={() => setShowClassModal(true)} className="btn-primary">
                <span className="material-symbols-outlined">add</span>Tạo lớp mới
              </button>
            )}
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

            {/* Days run vertically; start times run horizontally. Keep the day label visible while scrolling. */}
            <div className="overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface-container-lowest shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed border-collapse" style={{ minWidth: Math.max(700, 136 + timeSlots.length * 190) }}>
                  <colgroup>
                    <col style={{ width: 136 }} />
                    {timeSlots.map(time => <col key={time} />)}
                  </colgroup>
                  <thead>
                    <tr className="bg-surface-container-low/70">
                      <th scope="col" className="sticky left-0 z-20 border-r border-outline-variant/15 bg-surface-container-low px-4 py-3.5 text-left text-xs font-semibold text-on-surface-variant">Thứ / ngày</th>
                      {timeSlots.map(time => (
                        <th scope="col" key={time} className="border-r border-outline-variant/10 px-3 py-3.5 text-left text-sm font-bold tabular-nums text-on-surface last:border-r-0">
                          {time}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/15">
                    {timeSlots.length === 0 ? (
                      <tr>
                        <td className="py-16 text-center text-outline">
                          <span className="material-symbols-outlined mb-2 block text-4xl opacity-30">event_busy</span>
                          <p className="text-sm font-medium">Không có buổi học trong tuần này</p>
                          <p className="mt-1 text-xs">Chọn tuần khác hoặc tạo buổi học từ tab "Danh sách lớp học"</p>
                        </td>
                      </tr>
                    ) : weekDays.map((day, i) => {
                      const iso = toISO(day)
                      const isToday = iso === todayStr
                      const dayCount = sessions.filter(s => s.sessionDate === iso).length
                      return (
                        <tr key={iso} className={isToday ? 'bg-primary/[0.025]' : ''}>
                          <th scope="row" className={`sticky left-0 z-10 border-r border-outline-variant/15 px-4 py-4 text-left align-top ${isToday ? 'bg-blue-50' : 'bg-surface-container-lowest'}`}>
                            <span className={`block text-xs font-semibold ${isToday ? 'text-primary' : 'text-on-surface-variant'}`}>{DAY_LABELS[i]}</span>
                            <span className={`mt-1 block font-headline text-xl font-bold tabular-nums ${isToday ? 'text-primary' : 'text-on-surface'}`}>{day.getDate()}/{day.getMonth() + 1}</span>
                            <span className="mt-1 block text-[11px] font-normal text-outline">{dayCount} buổi học</span>
                          </th>
                          {timeSlots.map(time => {
                            const daySessions = grid[iso]?.[time] ?? []
                            return (
                              <td key={time} className="border-r border-outline-variant/10 px-2.5 py-3 align-top last:border-r-0">
                                <div className="flex flex-col gap-2">
                                  {daySessions.map(s => {
                                    const color = classColorMap[s.classId] ?? CLASS_COLORS[0]
                                    const isCancelled = s.status === 'CANCELLED'
                                    return (
                                      <button key={s.id} type="button" onClick={() => setSelectedSession(s)}
                                        className={`w-full rounded-xl border-l-4 p-2.5 text-left transition-all hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${color.bg} ${color.border} ${isCancelled ? 'opacity-50' : ''}`}
                                      >
                                        <span className={`block text-xs font-bold leading-snug ${color.text} ${isCancelled ? 'line-through' : ''}`}>{s.className}</span>
                                        <span className={`mt-1.5 flex items-center justify-between gap-1 text-[11px] ${color.badge}`}>
                                          <span>{s.startTime}–{s.endTime}</span>
                                          {s.status === 'COMPLETED' && <span className="material-symbols-outlined text-sm text-secondary" title="Hoàn thành">check_circle</span>}
                                          {isCancelled && <span className="material-symbols-outlined text-sm text-error" title="Đã huỷ">cancel</span>}
                                        </span>
                                        {s.teacherName && <span className={`mt-1 block truncate text-[11px] ${color.badge}`}>{s.teacherName}</span>}
                                      </button>
                                    )
                                  })}
                                  {daySessions.length === 0 && <span className="py-3 text-center text-sm text-outline/40" aria-label="Không có buổi học">—</span>}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {timeSlots.length > 2 && <p className="border-t border-outline-variant/10 px-4 py-2 text-xs text-outline lg:hidden">Vuốt ngang để xem các khung giờ khác.</p>}
            </div>
          </div>
        )}

        {/* ── Tab: Danh sách lớp học ── */}
        {tab === 'classes' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-outline-variant/15 bg-surface-container-lowest px-5 py-3.5 text-sm">
              <span className="font-semibold text-on-surface">{classes.length} lớp học</span>
              <span className="hidden sm:block h-4 w-px bg-outline-variant/30" />
              <span className="flex items-center gap-2 text-on-surface-variant"><span className="h-2 w-2 rounded-full bg-secondary" />{classes.filter(c => c.status === 'ACTIVE').length} đang hoạt động</span>
              <span className="flex items-center gap-2 text-on-surface-variant"><span className="h-2 w-2 rounded-full bg-outline" />{classes.filter(c => c.status !== 'ACTIVE').length} đã đóng</span>
            </div>

            <section className="overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface-container-lowest shadow-sm" aria-label="Danh sách lớp học">
              <div className="flex flex-col gap-4 border-b border-outline-variant/15 px-5 py-5 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h3 className="font-headline text-lg font-bold text-on-surface">Danh sách lớp học</h3>
                  <p className="mt-0.5 text-sm text-on-surface-variant">{visibleClasses.length} lớp phù hợp</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <label className="relative min-w-0 sm:w-60">
                    <span className="sr-only">Tìm lớp hoặc giáo viên</span>
                    <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-outline">search</span>
                    <input value={classSearch} onChange={e => setClassSearch(e.target.value)} placeholder="Tìm lớp, giáo viên..." className="h-10 w-full rounded-xl border border-outline-variant/25 bg-white pl-10 pr-3 text-sm text-on-surface outline-none placeholder:text-outline focus:border-primary focus:ring-2 focus:ring-primary/10" />
                  </label>
                  <label>
                    <span className="sr-only">Lọc theo khối</span>
                    <select value={classGrade} onChange={e => setClassGrade(e.target.value)} className="h-10 w-full rounded-xl border border-outline-variant/25 bg-white px-3 text-sm text-on-surface focus:border-primary focus:outline-none sm:w-auto">
                      <option value="ALL">Tất cả khối</option>
                      {classGrades.map(grade => <option key={grade} value={grade}>Khối {grade}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">Lọc theo trạng thái</span>
                    <select value={classStatus} onChange={e => setClassStatus(e.target.value as 'ALL' | 'ACTIVE' | 'CLOSED')} className="h-10 w-full rounded-xl border border-outline-variant/25 bg-white px-3 text-sm text-on-surface focus:border-primary focus:outline-none sm:w-auto">
                      <option value="ALL">Mọi trạng thái</option>
                      <option value="ACTIVE">Đang hoạt động</option>
                      <option value="CLOSED">Đã đóng</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] table-fixed text-left text-sm">
                  <colgroup>
                    <col className="w-[25%]" /><col className="w-[17%]" /><col className="w-[17%]" />
                    <col className="w-[17%]" /><col className="w-[13%]" /><col className="w-[11%]" />
                  </colgroup>
                  <thead className="bg-surface-container-low/50 text-xs font-semibold text-on-surface-variant">
                    <tr>
                      <th scope="col" className="px-5 py-3.5">Lớp học</th>
                      <th scope="col" className="px-4 py-3.5">Giáo viên</th>
                      <th scope="col" className="px-4 py-3.5">Lịch học</th>
                      <th scope="col" className="px-4 py-3.5">Học phí / buổi</th>
                      <th scope="col" className="px-4 py-3.5">Trạng thái</th>
                      <th scope="col" className="px-4 py-3.5 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/15">
                    {visibleClasses.map(cls => {
                      const days = [...(schedulesByClass[cls.id] ?? [])].sort((a, b) => SCHEDULE_DAY_ORDER.indexOf(a) - SCHEDULE_DAY_ORDER.indexOf(b))
                      const grade = gradeOfClass(cls)
                      return (
                        <tr key={cls.id} className="transition-colors hover:bg-primary/[0.035]">
                          <td className="px-5 py-4 align-middle">
                            <div className="font-semibold leading-5 text-on-surface">{cls.name}</div>
                            <div className="mt-1 text-xs text-outline">{grade ? `Khối ${grade}` : 'Chưa có khối'}{cls.room ? ` · Phòng ${cls.room}` : ''}</div>
                          </td>
                          <td className="px-4 py-4 align-middle text-on-surface-variant">{cls.teacherName || <span className="text-outline">Chưa phân công</span>}</td>
                          <td className="px-4 py-4 align-middle">
                            <span className={days.length ? 'font-medium text-primary' : 'text-outline'}>{days.length ? days.map(day => SCHEDULE_DAY_LABELS[day] ?? day).join(', ') : 'Chưa có lịch'}</span>
                            {!!cls.sessionsPerMonth && <div className="mt-1 text-xs text-outline">{cls.sessionsPerMonth} buổi/tháng</div>}
                          </td>
                          <td className="px-4 py-4 align-middle font-semibold tabular-nums text-on-surface">{(cls.tuitionRate ?? 0).toLocaleString('vi-VN')}đ</td>
                          <td className="px-4 py-4 align-middle">
                            <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${cls.status === 'ACTIVE' ? 'bg-secondary-container/25 text-secondary' : 'bg-surface-container-low text-on-surface-variant'}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${cls.status === 'ACTIVE' ? 'bg-secondary' : 'bg-outline'}`} />
                              {cls.status === 'ACTIVE' ? 'Đang học' : 'Đã đóng'}
                            </span>
                          </td>
                          <td className="px-4 py-4 align-middle text-right">
                            {canManageClasses && <div className="flex justify-end gap-1">
                              <button type="button" onClick={() => setEditingClass(cls)} className="rounded-lg p-2 text-outline transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" title={`Chỉnh sửa ${cls.name}`} aria-label={`Chỉnh sửa ${cls.name}`}><span className="material-symbols-outlined text-xl">edit</span></button>
                              <button type="button" onClick={() => handleDeleteClass(cls)} className="rounded-lg p-2 text-outline transition-colors hover:bg-error/10 hover:text-error focus-visible:outline focus-visible:outline-2 focus-visible:outline-error" title={`Kết thúc hoặc xóa ${cls.name}`} aria-label={`Kết thúc hoặc xóa ${cls.name}`}><span className="material-symbols-outlined text-xl">more_horiz</span></button>
                            </div>}
                          </td>
                        </tr>
                      )
                    })}
                    {visibleClasses.length === 0 && <tr><td colSpan={6} className="px-5 py-14 text-center">
                      <span className="material-symbols-outlined text-3xl text-outline/60">{classes.length ? 'search_off' : 'school'}</span>
                      <p className="mt-2 font-medium text-on-surface">{classes.length ? 'Không tìm thấy lớp phù hợp' : 'Chưa có lớp học nào'}</p>
                      <p className="mt-1 text-sm text-outline">{classes.length ? 'Thử đổi từ khóa hoặc bộ lọc.' : 'Tạo lớp đầu tiên để bắt đầu quản lý lịch học.'}</p>
                      {classes.length === 0 && canManageClasses && <button type="button" onClick={() => setShowClassModal(true)} className="btn-primary mx-auto mt-4">Tạo lớp học</button>}
                    </td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-outline-variant/10 px-5 py-3 text-xs text-outline sm:hidden">Vuốt ngang để xem đầy đủ bảng và thao tác.</div>
            </section>
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedSession && (
        <SessionModal
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
