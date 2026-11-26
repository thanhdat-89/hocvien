import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Class } from '../types'
import { gradeOfClass } from '../lib/classGrade'

/** Một khung giờ học trong tuần của lớp (lịch đang hiệu lực). */
export interface ClassSlot { dayOfWeek: string; startTime: string; endTime: string }
export type ClassEditSection = 'name' | 'schedule' | 'rate'

const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const DAY_LABEL: Record<string, string> = { MONDAY: 'T2', TUESDAY: 'T3', WEDNESDAY: 'T4', THURSDAY: 'T5', FRIDAY: 'T6', SATURDAY: 'T7', SUNDAY: 'CN' }
const money = (n: number) => `${n.toLocaleString('vi-VN')}đ`

/** Gom các thứ cùng giờ: [{ days: ['T3','T7'], time: '18:00–19:30' }] — thường cả lớp học một khung giờ. */
export function groupSlots(slots: ClassSlot[]) {
  const groups = new Map<string, string[]>()
  for (const s of [...slots].sort((a, b) => DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek))) {
    const time = s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : ''
    groups.set(time, [...(groups.get(time) ?? []), DAY_LABEL[s.dayOfWeek] ?? s.dayOfWeek])
  }
  return [...groups].map(([time, days]) => ({ time, days }))
}

/** Lịch học: nhãn thứ + giờ; khác giờ thì mỗi khung một dòng. */
export function ScheduleCell({ slots, compact = false }: { slots: ClassSlot[]; compact?: boolean }) {
  if (!slots.length) return <span className="text-sm text-outline">Chưa có lịch</span>
  return (
    <div className={compact ? 'flex flex-wrap gap-x-3 gap-y-1' : 'space-y-1'}>
      {groupSlots(slots).map(({ time, days }) => (
        <div key={time} className="flex items-center gap-2">
          <span className="flex gap-1">
            {days.map(day => <span key={day} className="inline-flex h-6 min-w-[2rem] items-center justify-center rounded-md bg-primary/[0.08] px-1.5 text-xs font-semibold text-primary">{day}</span>)}
          </span>
          {time && <span className="whitespace-nowrap text-sm tabular-nums text-on-surface-variant">{time}</span>}
        </div>
      ))}
    </div>
  )
}

/** Sĩ số: số học viên đang học / tối đa, thanh đầy dần; đầy lớp → cam. */
export function EnrollmentCell({ cls }: { cls: Class }) {
  const count = cls.activeStudentCount ?? 0
  const max = cls.maxStudents ?? null
  const full = max !== null && count >= max
  return (
    <div className="min-w-0">
      <span className={`text-sm tabular-nums ${count === 0 ? 'text-outline' : full ? 'font-semibold text-amber-700' : 'text-on-surface'}`}>
        {count}{max !== null ? <span className="text-outline">/{max}</span> : ''} <span className="text-outline">học viên</span>
      </span>
      {max !== null && max > 0 && (
        <div className="mt-1.5 h-1 w-20 overflow-hidden rounded-full bg-surface-container-high" aria-hidden="true">
          <div className={`h-full rounded-full ${full ? 'bg-amber-500' : 'bg-primary/60'}`} style={{ width: `${Math.min(100, (count / max) * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

/** Học phí đang áp dụng + đơn giá mới sắp áp dụng (nếu có). */
function RateCell({ cls, rate }: { cls: Class; rate: number }) {
  const thisMonth = new Date().toISOString().slice(0, 7)
  const upcoming = cls.tuitionRateEffectiveMonth && cls.tuitionRateEffectiveMonth > thisMonth
  return (
    <div className="text-right">
      <span className="text-sm font-semibold tabular-nums text-on-surface">{money(rate)}</span>
      {upcoming && <div className="mt-0.5 text-xs tabular-nums text-outline">Từ {cls.tuitionRateEffectiveMonth!.slice(5)}/{cls.tuitionRateEffectiveMonth!.slice(0, 4)}: {money(cls.tuitionRate)}</div>}
    </div>
  )
}

interface MenuItem { label: string; icon: string; onSelect: () => void; danger?: boolean; dividerBefore?: boolean }

/** Nút "⋯" mở menu thao tác. Menu gắn vào <body> (portal), vị trí theo nút: không bị khung cuộn của bảng cắt
 * hay khung cha có transform làm lệch. */
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !button.current) return
    const r = button.current.getBoundingClientRect()
    const height = menu.current?.offsetHeight ?? 220
    const below = r.bottom + 4 + height <= window.innerHeight
    setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - height), right: window.innerWidth - r.right })
  }, [open])

  // Menu đã có vị trí (hiện ra) mới đưa focus vào mục đầu, để dùng bàn phím ngay
  useEffect(() => { if (open && pos) menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }) }, [open, pos])

  useEffect(() => {
    if (!open) { setPos(null); return }
    const close = () => setOpen(false)
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); button.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <button ref={button} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className={`rounded-lg p-1.5 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${open ? 'bg-surface-container-high text-on-surface' : ''}`}>
        <span className="material-symbols-outlined text-xl leading-none">more_horiz</span>
      </button>
      {open && createPortal(
        <div ref={menu} role="menu" aria-label={label} style={pos ? { position: 'fixed', top: pos.top, right: pos.right } : { position: 'fixed', visibility: 'hidden' }}
          className="z-50 w-56 rounded-xl border border-outline-variant/20 bg-surface-container-lowest py-1.5 text-left shadow-xl"
          onKeyDown={e => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const all = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
            const i = all.indexOf(document.activeElement as HTMLButtonElement)
            all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus()
          }}>
          {items.map(item => (
            <div key={item.label}>
              {item.dividerBefore && <div className="my-1.5 h-px bg-outline-variant/20" />}
              <button type="button" role="menuitem" onClick={() => { setOpen(false); item.onSelect() }}
                className={`flex w-full items-center gap-3 px-3.5 py-2 text-sm outline-none transition-colors focus-visible:bg-surface-container-low ${item.danger ? 'text-error hover:bg-error/[0.06]' : 'text-on-surface hover:bg-surface-container-low'}`}>
                <span className={`material-symbols-outlined text-[18px] ${item.danger ? '' : 'text-outline'}`}>{item.icon}</span>{item.label}
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

/** Nhóm lớp theo khối (khối tăng dần, "Chưa có khối" cuối); trong nhóm: đang học trước, rồi theo tên. */
export function groupByGrade(classes: Class[]) {
  const groups = new Map<number | null, Class[]>()
  for (const cls of classes) {
    const grade = gradeOfClass(cls)
    groups.set(grade, [...(groups.get(grade) ?? []), cls])
  }
  return [...groups]
    .sort(([a], [b]) => (a ?? 99) - (b ?? 99))
    .map(([grade, list]) => ({
      grade,
      classes: list.sort((a, b) => (a.status === b.status ? 0 : a.status === 'ACTIVE' ? -1 : 1) || a.name.localeCompare(b.name, 'vi', { numeric: true })),
    }))
}

/** Bảng danh sách lớp (máy tính): nhóm theo khối, thao tác gom vào menu "⋯". */
export default function ClassListTable({ classes, slotsByClass, rateOf, canManage, onEdit, onEnd, onCopyId }: {
  classes: Class[]
  slotsByClass: Record<string, ClassSlot[]>
  rateOf: (cls: Class) => number
  canManage: boolean
  onEdit: (cls: Class, section: ClassEditSection) => void
  onEnd: (cls: Class) => void
  onCopyId: (cls: Class) => void
}) {
  const head = 'px-4 py-3 text-xs font-semibold text-on-surface-variant'
  return (
    <table className="w-full min-w-[760px] table-fixed border-collapse text-left text-sm">
      <colgroup><col className="w-[28%]" /><col className="w-[32%]" /><col className="w-[18%]" /><col className="w-[16%]" /><col className="w-[6%]" /></colgroup>
      <thead className="border-b border-outline-variant/15 bg-surface-container-low/40">
        <tr>
          <th scope="col" className={`${head} pl-6`}>Tên lớp</th>
          <th scope="col" className={head}>Lịch học</th>
          <th scope="col" className={head}>Sĩ số</th>
          <th scope="col" className={`${head} text-right`}>Học phí / buổi</th>
          <th scope="col" className={head}><span className="sr-only">Thao tác</span></th>
        </tr>
      </thead>
      {groupByGrade(classes).map(({ grade, classes: list }) => (
        <tbody key={grade ?? 'none'}>
          <tr>
            <th scope="rowgroup" colSpan={5} className="border-b border-outline-variant/10 bg-surface-container-low/60 px-6 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              {grade !== null ? `Khối ${grade}` : 'Chưa có khối'} <span className="ml-1 font-semibold normal-case tracking-normal text-outline">· {list.length} lớp</span>
            </th>
          </tr>
          {list.map(cls => {
            const active = cls.status === 'ACTIVE'
            const items: MenuItem[] = [
              ...(canManage ? [{ label: 'Đổi tên lớp', icon: 'edit', onSelect: () => onEdit(cls, 'name') }] : []),
              ...(canManage && active ? [
                { label: 'Sửa lịch học', icon: 'calendar_month', onSelect: () => onEdit(cls, 'schedule') },
                { label: 'Sửa học phí', icon: 'payments', onSelect: () => onEdit(cls, 'rate') },
              ] : []),
              { label: 'Sao chép ID lớp', icon: 'content_copy', onSelect: () => onCopyId(cls), dividerBefore: canManage },
              ...(canManage ? [{ label: 'Kết thúc hoặc xoá lớp…', icon: 'event_busy', onSelect: () => onEnd(cls), danger: true, dividerBefore: true }] : []),
            ]
            return (
              <tr key={cls.id} className={`border-b border-outline-variant/10 transition-colors last:border-b-0 hover:bg-primary/[0.03] ${active ? '' : 'text-outline'}`}>
                <td className="py-3 pl-6 pr-4 align-middle">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`truncate font-semibold ${active ? 'text-on-surface' : 'text-on-surface-variant'}`} title={cls.name}>{cls.name}</span>
                    {!active && <span className="shrink-0 rounded-full bg-surface-container-high px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">Đã đóng</span>}
                  </div>
                  {(cls.room || cls.teacherName) && <div className="mt-0.5 truncate text-xs text-outline">{[cls.room ? `Phòng ${cls.room}` : '', cls.teacherName].filter(Boolean).join(' · ')}</div>}
                </td>
                <td className={`px-4 py-3 align-middle ${active ? '' : 'opacity-60'}`}><ScheduleCell slots={slotsByClass[cls.id] ?? []} /></td>
                <td className={`px-4 py-3 align-middle ${active ? '' : 'opacity-60'}`}><EnrollmentCell cls={cls} /></td>
                <td className={`px-4 py-3 align-middle ${active ? '' : 'opacity-60'}`}><RateCell cls={cls} rate={rateOf(cls)} /></td>
                <td className="py-3 pl-2 pr-4 text-right align-middle"><RowMenu label={`Thao tác lớp ${cls.name}`} items={items} /></td>
              </tr>
            )
          })}
        </tbody>
      ))}
    </table>
  )
}
