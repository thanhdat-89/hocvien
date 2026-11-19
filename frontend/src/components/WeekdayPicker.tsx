import { useEffect, useState } from 'react'
import api from '../services/api'

// Lịch cố định trong tuần của học viên trong một lớp (học một phần số buổi của lớp).
// Học phí chỉ tính các buổi của lớp rơi vào những thứ được chọn.

export const WEEKDAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const
export const WEEKDAY_LABELS: Record<string, string> = {
  MONDAY: 'T2', TUESDAY: 'T3', WEDNESDAY: 'T4', THURSDAY: 'T5', FRIDAY: 'T6', SATURDAY: 'T7', SUNDAY: 'CN',
}
export const weekdayLabel = (days: string[]) => WEEKDAY_ORDER.filter(d => days.includes(d)).map(d => WEEKDAY_LABELS[d]).join(', ')

export interface ClassSlot { dayOfWeek: string; startTime: string; endTime: string }

/** Các buổi trong tuần của lớp còn hiệu lực từ ngày `from` (mỗi thứ một dòng, theo thứ tự T2 → CN). */
export function useClassSlots(classId: string | undefined, from: string) {
  const [slots, setSlots] = useState<ClassSlot[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!classId) { setSlots(null); return }
    let cancelled = false
    setSlots(null); setError(false)
    api.get(`/classes/${classId}`)
      .then(r => {
        if (cancelled) return
        const byDay = new Map<string, ClassSlot>()
        for (const s of (r.data?.schedules ?? []) as (ClassSlot & { effectiveTo?: string | null })[]) {
          if (s.effectiveTo && s.effectiveTo < from) continue
          if (!byDay.has(s.dayOfWeek)) byDay.set(s.dayOfWeek, s)
        }
        setSlots(WEEKDAY_ORDER.filter(d => byDay.has(d)).map(d => byDay.get(d)!))
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [classId, from])
  return { slots, error }
}

/** Ô chọn buổi học trong tuần; `value` là danh sách thứ đang chọn. */
export default function WeekdayPicker({ slots, error, value, onChange }: {
  slots: ClassSlot[] | null; error?: boolean; value: string[]; onChange: (days: string[]) => void
}) {
  if (error) return <p className="text-xs text-rose-600">Không tải được lịch của lớp.</p>
  if (!slots) return <p className="text-xs text-slate-500">Đang tải lịch lớp...</p>
  if (!slots.length) return <p className="text-xs text-slate-500">Lớp chưa có lịch học trong tuần.</p>
  const toggle = (day: string) => onChange(value.includes(day) ? value.filter(d => d !== day) : [...value, day])
  const chosen = slots.filter(s => value.includes(s.dayOfWeek)).length
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {slots.map(s => {
          const on = value.includes(s.dayOfWeek)
          return (
            <button key={s.dayOfWeek} type="button" onClick={() => toggle(s.dayOfWeek)} aria-pressed={on}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'border-primary bg-blue-50 text-primary' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'}`}>
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{on ? 'check_box' : 'check_box_outline_blank'}</span>
              <span className="font-semibold">{WEEKDAY_LABELS[s.dayOfWeek]}</span>
              <span className="text-xs opacity-75">{s.startTime}–{s.endTime}</span>
            </button>
          )
        })}
      </div>
      <p className={`mt-2 text-xs ${chosen ? 'text-slate-500' : 'text-rose-600'}`}>
        {chosen === 0 ? 'Cần chọn ít nhất một buổi.'
          : chosen === slots.length ? `Học đủ ${chosen} buổi/tuần của lớp.`
          : `Chỉ học ${chosen}/${slots.length} buổi/tuần — học phí chỉ tính các buổi đã chọn.`}
      </p>
    </div>
  )
}
