import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

// Chuông thông báo: cảnh báo cần xử lý của cơ sở đang làm việc (/api/alerts), cho quản trị viên và nhân viên.

interface Alert { id: string; type: string; message: string; read: boolean; data: Record<string, any>; createdAt: string }

const TYPE: Record<string, { icon: string; label: string; tone: string }> = {
  sepay_unmatched: { icon: 'account_balance', label: 'Chuyển khoản chưa khớp', tone: 'text-amber-700 bg-amber-100' },
  misa_invoice_failed: { icon: 'receipt_long', label: 'Hoá đơn MISA', tone: 'text-error bg-error-container/30' },
  overdue_reminder_cap: { icon: 'schedule', label: 'Học phí quá hạn', tone: 'text-primary bg-primary/10' },
}
const POLL_MS = 60_000

/** Trang cần mở để xử lý cảnh báo */
function targetOf(alert: Alert) {
  if (alert.type === 'misa_invoice_failed') return '/tuition/invoices'
  return alert.data?.studentId ? `/students/${alert.data.studentId}` : '/tuition'
}

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (minutes < 1) return 'vừa xong'
  if (minutes < 60) return `${minutes} phút trước`
  if (minutes < 1440) return `${Math.round(minutes / 60)} giờ trước`
  return new Date(iso).toLocaleDateString('vi-VN')
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Alert[]>([])
  const [unread, setUnread] = useState(0)
  const [failed, setFailed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => api.get<{ items: Alert[]; unread: number }>('/alerts')
    .then(r => { setItems(r.data.items); setUnread(r.data.unread); setFailed(false) })
    .catch(() => setFailed(true)), [])

  useEffect(() => {
    load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [open])

  const openAlert = async (alert: Alert) => {
    setOpen(false)
    if (!alert.read) {
      setItems(list => list.map(a => a.id === alert.id ? { ...a, read: true } : a)); setUnread(n => Math.max(0, n - 1))
      api.post(`/alerts/${alert.id}/read`).catch(() => {})
    }
    navigate(targetOf(alert))
  }
  const readAll = async () => {
    await api.post('/alerts/read-all').catch(() => {})
    load()
  }

  return (
    <div ref={rootRef} className="relative">
      <button type="button" aria-label={unread ? `Thông báo, ${unread} chưa đọc` : 'Thông báo'} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => { setOpen(v => !v); if (!open) load() }}
        className="relative p-2 text-slate-500 hover:bg-slate-50 transition-colors rounded-full">
        <span className="material-symbols-outlined" aria-hidden="true">notifications</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-error text-on-error text-[10px] font-bold leading-[18px] text-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Thông báo"
          className="absolute right-0 top-12 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-outline-variant/20 bg-surface shadow-xl max-lg:fixed max-lg:right-4 max-lg:top-16">
          <div className="flex items-center justify-between border-b border-outline-variant/10 px-4 py-3">
            <p className="font-headline font-bold text-on-surface">Cần xử lý</p>
            {unread > 0 && <button type="button" onClick={readAll} className="text-xs font-semibold text-primary hover:underline">Đánh dấu tất cả đã đọc</button>}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto divide-y divide-outline-variant/10">
            {failed && <li className="px-4 py-6 text-center text-sm text-error">Không tải được thông báo.</li>}
            {!failed && !items.length && <li className="px-4 py-8 text-center text-sm text-outline">Không có việc cần xử lý.</li>}
            {items.map(alert => {
              const kind = TYPE[alert.type] ?? { icon: 'info', label: 'Thông báo', tone: 'text-slate-600 bg-slate-100' }
              return (
                <li key={alert.id}>
                  <button type="button" onClick={() => openAlert(alert)}
                    className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-container-low ${alert.read ? 'opacity-60' : ''}`}>
                    <span className={`material-symbols-outlined flex h-8 w-8 shrink-0 self-start items-center justify-center rounded-lg text-lg ${kind.tone}`} aria-hidden="true">{kind.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-xs text-outline">
                        <b className="font-semibold text-on-surface-variant">{kind.label}</b>· {timeAgo(alert.createdAt)}
                        {!alert.read && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Chưa đọc" />}
                      </span>
                      <span className="mt-0.5 block text-sm text-on-surface break-words">{alert.message}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
