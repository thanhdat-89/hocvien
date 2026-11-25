import React, { useRef, useState } from 'react'

interface AgendaItem {
  id: string
  date: string
  title: string
  startTime?: string
  endTime?: string
  subtitle?: string
  status: string
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function shiftKey(key: string, days: number) {
  const [y, m, d] = key.split('-').map(Number)
  return dateKey(new Date(y, m - 1, d + days))
}

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const SWIPE_MIN = 60

/**
 * Lịch tuần trên điện thoại: một ngày một lúc, cùng dữ liệu với lịch tuần trên máy tính.
 * Đổi ngày bằng dải thứ hoặc vuốt ngang; đi quá đầu/cuối tuần thì tự chuyển tuần.
 */
export default function MobileWeekAgenda({ days, items, loading, onSelect, onPrevWeek, onNextWeek, onToday }: {
  days: Date[]
  items: AgendaItem[]
  loading: boolean
  onSelect: (id: string) => void
  onPrevWeek: () => void
  onNextWeek: () => void
  onToday: () => void
}) {
  const [selectedDate, setSelectedDate] = useState('')
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const today = dateKey(new Date())
  const keys = days.map(dateKey)
  const activeDate = keys.includes(selectedDate) ? selectedDate : keys.includes(today) ? today : keys[0]
  const countByDate = items.reduce<Record<string, number>>((acc, item) => {
    if (item.status !== 'CANCELLED') acc[item.date] = (acc[item.date] ?? 0) + 1
    return acc
  }, {})
  const dailyItems = items.filter(item => item.date === activeDate)
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '', 'vi', { numeric: true }))
  const activeDay = days.find(day => dateKey(day) === activeDate)
  const first = days[0]
  const last = days[days.length - 1]
  const range = first && last
    ? `${first.getDate()}/${first.getMonth() + 1} – ${last.getDate()}/${last.getMonth() + 1}/${last.getFullYear()}`
    : ''

  const goWeek = (direction: -1 | 1) => {
    setSelectedDate(shiftKey(activeDate, direction * 7))
    if (direction < 0) onPrevWeek(); else onNextWeek()
  }
  const goDay = (direction: -1 | 1) => {
    const next = shiftKey(activeDate, direction)
    setSelectedDate(next)
    if (!keys.includes(next)) { if (direction < 0) onPrevWeek(); else onNextWeek() }
  }
  const goToday = () => { setSelectedDate(today); if (!keys.includes(today)) onToday() }

  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
  }
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    // Chỉ nhận vuốt ngang rõ ràng để không cản cuộn dọc.
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(touch.clientY - start.y) * 1.5) return
    goDay(dx < 0 ? 1 : -1)
  }

  const navButton = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low'

  return (
    <section className="space-y-3 md:hidden" aria-label="Lịch học theo ngày">
      <div className="rounded-2xl bg-surface-container-lowest p-2 shadow-sm">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => goWeek(-1)} aria-label="Tuần trước" className={navButton}>
            <span className="material-symbols-outlined" aria-hidden="true">chevron_left</span>
          </button>
          <p className="min-w-0 flex-1 text-center text-sm font-semibold tabular-nums text-on-surface" aria-live="polite">{range}</p>
          <button type="button" onClick={() => goWeek(1)} aria-label="Tuần sau" className={navButton}>
            <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
          </button>
          <button type="button" onClick={goToday} disabled={activeDate === today}
            className="h-9 shrink-0 rounded-full bg-primary/10 px-3 text-xs font-semibold text-primary disabled:opacity-40">
            Hôm nay
          </button>
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1" role="group" aria-label="Chọn ngày trong tuần">
          {days.map((day, index) => {
            const key = dateKey(day)
            const active = activeDate === key
            const count = countByDate[key] ?? 0
            return <button key={key} type="button" aria-pressed={active}
              aria-label={`${day.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' })}, ${count} buổi`}
              onClick={() => setSelectedDate(key)}
              className={`min-w-0 rounded-xl py-1.5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                active ? 'bg-primary text-on-primary' : key === today ? 'bg-blue-50 text-primary' : 'text-on-surface-variant'}`}>
              <span className="block text-[10px] font-medium">{WEEKDAYS[index]}</span>
              <span className="block text-base font-bold leading-6">{day.getDate()}</span>
              <span className="flex h-1.5 items-center justify-center gap-0.5" aria-hidden="true">
                {Array.from({ length: Math.min(count, 3) }, (_, i) => (
                  <span key={i} className={`h-1 w-1 rounded-full ${active ? 'bg-on-primary' : 'bg-primary/60'}`} />
                ))}
              </span>
            </button>
          })}
        </div>
      </div>

      <div className="min-h-[40vh] rounded-2xl border border-outline-variant/15 bg-white p-4" aria-busy={loading}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <h3 className="mb-3 flex items-baseline justify-between gap-2 text-sm font-semibold text-on-surface">
          <span className="first-letter:uppercase">{activeDay?.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</span>
          {!loading && <span className="text-xs font-normal text-outline">{dailyItems.length} buổi</span>}
        </h3>
        {loading ? <p role="status" className="py-6 text-center text-sm text-outline">Đang tải lịch học…</p>
          : dailyItems.length === 0 ? <p className="py-6 text-center text-sm text-outline">Không có buổi học trong ngày này</p>
          : <div className="space-y-2">{dailyItems.map(item => <button key={item.id} type="button" onClick={() => onSelect(item.id)}
            className={`flex w-full items-start gap-3 rounded-xl border border-outline-variant/15 p-3 text-left hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${item.status === 'CANCELLED' ? 'bg-slate-50' : ''}`}>
            <span className="w-12 shrink-0 text-sm font-semibold tabular-nums text-primary">
              {item.startTime || '—'}
              {item.endTime && <span className="mt-1 block text-xs font-normal text-outline">{item.endTime}</span>}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block break-words text-sm font-semibold text-on-surface ${item.status === 'CANCELLED' ? 'line-through' : ''}`}>{item.title}</span>
              {item.subtitle && <span className="mt-1 block break-words text-xs text-outline">{item.subtitle}</span>}
              <span className={`mt-1.5 block text-xs font-medium ${item.status === 'CANCELLED' ? 'text-error' : item.status === 'COMPLETED' ? 'text-secondary' : 'text-primary'}`}>
                {item.status === 'CANCELLED' ? 'Đã hủy' : item.status === 'COMPLETED' ? 'Hoàn thành' : 'Đã xếp lịch'}
              </span>
            </span>
            <span className="material-symbols-outlined shrink-0 text-lg text-outline" aria-hidden="true">chevron_right</span>
          </button>)}</div>}
        {!loading && <p className="mt-4 text-center text-[11px] text-outline">Vuốt ngang để xem ngày trước/sau</p>}
      </div>
    </section>
  )
}
