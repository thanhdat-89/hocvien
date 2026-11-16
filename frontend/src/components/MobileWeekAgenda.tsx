import React, { useState } from 'react'

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

/** A presentation-only view of the same weekly sessions as the desktop calendar. */
export default function MobileWeekAgenda({ days, items, loading, onSelect }: {
  days: Date[]
  items: AgendaItem[]
  loading: boolean
  onSelect: (id: string) => void
}) {
  const [selectedDate, setSelectedDate] = useState('')
  const today = dateKey(new Date())
  const keys = days.map(dateKey)
  const activeDate = keys.includes(selectedDate) ? selectedDate : keys.includes(today) ? today : keys[0]
  const dailyItems = items.filter(item => item.date === activeDate)
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '', 'vi', { numeric: true }))
  const activeDay = days.find(day => dateKey(day) === activeDate)

  return (
    <section className="space-y-3 md:hidden" aria-label="Lịch học theo ngày">
      <div className="grid grid-cols-7 gap-1" role="group" aria-label="Chọn ngày trong tuần">
        {days.map((day, index) => {
          const key = dateKey(day)
          return <button key={key} type="button" aria-pressed={activeDate === key}
            aria-label={day.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' })}
            onClick={() => setSelectedDate(key)}
            className={`min-w-0 rounded-xl py-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${activeDate === key ? 'bg-primary text-on-primary' : key === today ? 'bg-blue-50 text-primary' : 'bg-white text-on-surface-variant'}`}>
            <span className="block text-[10px] font-medium">{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][index]}</span>
            <span className="mt-1 block text-base font-bold">{day.getDate()}</span>
          </button>
        })}
      </div>
      <div className="rounded-2xl border border-outline-variant/15 bg-white p-4" aria-busy={loading}>
        <h3 className="mb-3 text-sm font-semibold text-on-surface">
          {activeDay?.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}
        </h3>
        {loading ? <p role="status" className="py-6 text-center text-sm text-outline">Đang tải lịch học…</p>
          : dailyItems.length === 0 ? <p className="py-6 text-center text-sm text-outline">Không có buổi học trong ngày này</p>
          : <div className="space-y-3">{dailyItems.map(item => <button key={item.id} type="button" onClick={() => onSelect(item.id)}
            className={`flex w-full items-start gap-3 rounded-xl border border-outline-variant/15 p-3 text-left hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${item.status === 'CANCELLED' ? 'bg-slate-50' : ''}`}>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">
              {item.startTime || 'Chưa xếp giờ'}
              {item.endTime && <span className="mt-1 block text-xs font-normal text-outline">{item.endTime}</span>}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block break-words text-sm font-semibold text-on-surface ${item.status === 'CANCELLED' ? 'line-through' : ''}`}>{item.title}</span>
              {item.subtitle && <span className="mt-1 block break-words text-xs text-outline">{item.subtitle}</span>}
              <span className={`mt-2 block text-xs font-medium ${item.status === 'CANCELLED' ? 'text-error' : item.status === 'COMPLETED' ? 'text-secondary' : 'text-primary'}`}>
                {item.status === 'CANCELLED' ? 'Đã hủy' : item.status === 'COMPLETED' ? 'Hoàn thành' : 'Đã xếp lịch'}
              </span>
            </span>
            <span className="material-symbols-outlined shrink-0 text-lg text-outline" aria-hidden="true">chevron_right</span>
          </button>)}</div>}
      </div>
    </section>
  )
}
