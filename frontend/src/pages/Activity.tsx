import React, { useEffect, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import { useWorkspace } from '../hooks/useWorkspace'
import api from '../services/api'

interface ActivityLog {
  id: string
  createdAt: string
  userId: string
  userName: string
  userRole: string
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  resourceType: string
  resourceId?: string
  description: string
  method: string
  path: string
  statusCode: number
  ip?: string
  before?: unknown
  after?: unknown
}

const ACTION_TONE: Record<ActivityLog['action'], { label: string; cls: string; icon: string }> = {
  CREATE: { label: 'Thêm', cls: 'bg-emerald-50 text-emerald-700', icon: 'add_circle' },
  UPDATE: { label: 'Sửa',  cls: 'bg-amber-50 text-amber-700',     icon: 'edit' },
  DELETE: { label: 'Xoá',  cls: 'bg-rose-50 text-rose-700',       icon: 'delete' },
}

const RESOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: '',              label: 'Tất cả loại' },
  { value: 'students',      label: 'Học viên' },
  { value: 'classes',       label: 'Lớp học' },
  { value: 'schedules',     label: 'Lịch học' },
  { value: 'sessions',      label: 'Buổi học' },
  { value: 'attendance',    label: 'Điểm danh' },
  { value: 'tuition',       label: 'Học phí' },
  { value: 'teachers',      label: 'Giáo viên' },
  { value: 'subjects',      label: 'Môn học' },
  { value: 'parents',       label: 'Phụ huynh' },
  { value: 'leads',         label: 'Lead' },
  { value: 'reviews',       label: 'Nhận xét' },
  { value: 'monthly-scores', label: 'Điểm kiểm tra' },
  { value: 'materials',     label: 'Tài liệu' },
  { value: 'notifications', label: 'Thông báo' },
]

const fmtDateTime = (iso: string): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yy} ${hh}:${mi}`
}

const startOfDayIso = (yyyymmdd: string) => yyyymmdd ? new Date(`${yyyymmdd}T00:00:00`).toISOString() : ''
const endOfDayIso   = (yyyymmdd: string) => yyyymmdd ? new Date(`${yyyymmdd}T23:59:59.999`).toISOString() : ''

interface ActivityPage { data: ActivityLog[]; nextCursor: string | null }
const PAGE_SIZE = 10

export default function Activity({ embedded = false }: { embedded?: boolean }) {
  const { branches, branchId } = useWorkspace()
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [pageIndex, setPageIndex] = useState(0)
  const pages = useRef<ActivityPage[]>([])
  const latestRequest = useRef(0)
  const activeRequest = useRef<AbortController | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [action, setAction] = useState<'' | ActivityLog['action']>('')
  const [resourceType, setResourceType] = useState('')
  const [search, setSearch] = useState('')

  // Detail modal
  const [detail, setDetail] = useState<ActivityLog | null>(null)

  const fetchPage = async (cursor: string | undefined, signal: AbortSignal) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
    if (cursor) params.set('cursor', cursor)
    if (from) params.set('from', startOfDayIso(from))
    if (to) params.set('to', endOfDayIso(to))
    if (action) params.set('action', action)
    if (resourceType) params.set('resourceType', resourceType)
    const res = await api.get(`/activity?${params.toString()}`, { signal, timeout: 15_000 })
    return res.data as ActivityPage
  }

  const showPage = (index: number, result: ActivityPage) => {
    setLogs(result.data)
    setNextCursor(result.nextCursor)
    setPageIndex(index)
  }

  const loadPage = async (index: number, refresh = false) => {
    const request = ++latestRequest.current
    activeRequest.current?.abort()
    setError(null)
    if (refresh) {
      pages.current = []
      setLogs([])
      setNextCursor(null)
      setPageIndex(0)
    }
    const cached = pages.current[index]
    if (cached) { showPage(index, cached); setLoading(false); return }
    const controller = new AbortController()
    activeRequest.current = controller
    setLoading(true)
    try {
      const result = await fetchPage(index === 0 ? undefined : pages.current[index - 1]?.nextCursor ?? undefined, controller.signal)
      if (request !== latestRequest.current) return
      pages.current[index] = result
      showPage(index, result)
    } catch (e: any) {
      if (request === latestRequest.current && !controller.signal.aborted) {
        setError(e?.response?.data?.message ?? 'Không tải được lịch sử. Vui lòng thử lại.')
      }
    } finally {
      if (request === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    setLogs([])
    setNextCursor(null)
    setPageIndex(0)
    setDetail(null)
    void loadPage(0, true)
    return () => { latestRequest.current++; activeRequest.current?.abort() }
  }, [from, to, action, resourceType])

  const visible = search.trim()
    ? logs.filter(l => {
        const q = search.trim().toLowerCase()
        return l.userName.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)
      })
    : logs

  const resetFilters = () => { setFrom(''); setTo(''); setAction(''); setResourceType(''); setSearch('') }
  const hasFilter = !!(from || to || action || resourceType || search)

  return (
    <div className="space-y-6">
      {!embedded && <TopBar title="Lịch sử hoạt động" />}

      <div className={embedded ? 'bg-surface rounded-3xl p-6 md:p-8 shadow-sm' : 'page-content bg-surface rounded-3xl p-6 md:p-8 shadow-sm'}>
        <p className="text-[10px] uppercase tracking-widest text-primary font-bold mb-1">Audit log</p>
        <h2 className="font-headline text-2xl font-bold text-on-surface mb-6">
          Thay đổi tại {branches.find(b => b.id === branchId)?.name ?? 'cơ sở đang làm việc'}
        </h2>

        {/* Filter bar */}
        <div className="activity-filters grid grid-cols-1 md:grid-cols-[auto_auto_1fr_1fr_auto] gap-3 mb-6 items-end">
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1">Từ ngày</label>
            <input aria-label="Từ ngày" type="date" value={from} onChange={e => setFrom(e.target.value)} className="input" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1">Đến ngày</label>
            <input aria-label="Đến ngày" type="date" value={to} onChange={e => setTo(e.target.value)} className="input" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1">Loại</label>
            <select aria-label="Loại hoạt động" value={resourceType} onChange={e => setResourceType(e.target.value)} className="input">
              {RESOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1">Tìm kiếm</label>
            <input aria-label="Tìm trong trang hiện tại" type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Tìm tên / nội dung trong trang này..." className="input" />
          </div>
          {hasFilter && (
            <button onClick={resetFilters}
              className="px-3 py-2 rounded-xl text-sm font-semibold text-outline hover:text-on-surface hover:bg-surface-container-low transition-colors whitespace-nowrap">
              Xoá lọc
            </button>
          )}
        </div>

        {/* Action pills */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {([['', 'Tất cả'], ['CREATE', 'Thêm'], ['UPDATE', 'Sửa'], ['DELETE', 'Xoá']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setAction(v as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                action === v
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-low text-outline hover:bg-surface-container'
              }`}>
              {label}
            </button>
          ))}
        </div>

        <p aria-live="polite" className="mb-3 text-xs text-outline">Mỗi trang tối đa 10 thay đổi mới nhất. Tìm kiếm áp dụng trong trang hiện tại.</p>
        <div className="overflow-x-auto" aria-busy={loading}>
          <table aria-label="Lịch sử hoạt động" className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low/50">
                <th className="table-header w-44">Ngày tháng</th>
                <th className="table-header">Nội dung thay đổi</th>
                <th className="table-header w-56">Người thay đổi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {loading ? (
                <tr>
                  <td colSpan={3} className="py-16 text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={3} className="py-16 text-center text-error text-sm">{error}</td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-16 text-center text-outline">
                    <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">history</span>
                    {search.trim() ? 'Không có kết quả tìm kiếm trong trang này' : hasFilter ? 'Không có hoạt động khớp với bộ lọc' : 'Chưa có hoạt động nào được ghi nhận'}
                  </td>
                </tr>
              ) : visible.map(log => {
                const tone = ACTION_TONE[log.action]
                return (
                  <tr key={log.id}
                    onClick={() => setDetail(log)}
                    className="hover:bg-surface-container-low/30 transition-colors align-top cursor-pointer">
                    <td className="table-cell text-sm text-outline whitespace-nowrap">{fmtDateTime(log.createdAt)}</td>
                    <td className="table-cell">
                      <div className="flex items-start gap-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider shrink-0 ${tone.cls}`}>
                          <span className="material-symbols-outlined text-[14px]">{tone.icon}</span>
                          {tone.label}
                        </span>
                        <p className="text-sm text-on-surface">{log.description}</p>
                      </div>
                    </td>
                    <td className="table-cell">
                      <p className="text-sm font-semibold text-on-surface">{log.userName}</p>
                      <p className="text-[11px] text-outline uppercase tracking-wider">{log.userRole}</p>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <nav aria-label="Phân trang lịch sử" className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className="text-sm text-outline">
            Trang {pageIndex + 1} · {visible.length}{search.trim() ? `/${logs.length}` : ''} thay đổi
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { setSearch(''); void loadPage(0, true) }} disabled={loading}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10 disabled:opacity-40">Tải mới nhất</button>
            <button onClick={() => void loadPage(pageIndex - 1)} disabled={loading || pageIndex === 0}
              className="rounded-xl bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20 disabled:opacity-40">Trang trước</button>
            <button onClick={() => void loadPage(pageIndex + 1)} disabled={loading || !nextCursor}
              className="rounded-xl bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20 disabled:opacity-40">Trang sau</button>
            {error && <button onClick={() => void loadPage(0, true)} disabled={loading}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-error">Thử lại từ đầu</button>}
          </div>
        </nav>
      </div>

      {detail && <ActivityDetailModal log={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function ActivityDetailModal({ log, onClose }: { log: ActivityLog; onClose: () => void }) {
  const tone = ACTION_TONE[log.action]
  const fmtJson = (v: unknown): string => {
    if (v == null) return '—'
    try { return JSON.stringify(v, null, 2) } catch { return String(v) }
  }
  return (
    <div className="responsive-dialog fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-surface rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="p-6 border-b border-outline-variant/10 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider ${tone.cls}`}>
                <span className="material-symbols-outlined text-[14px]">{tone.icon}</span>{tone.label}
              </span>
              <span className="text-[11px] text-outline uppercase tracking-wider">{log.resourceType}</span>
            </div>
            <h3 className="font-headline text-lg font-bold text-on-surface">{log.description}</h3>
            <p className="text-xs text-outline mt-1">
              {fmtDateTime(log.createdAt)} · {log.userName} ({log.userRole})
              {log.ip ? ` · IP ${log.ip}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-container-low text-outline hover:text-on-surface rounded-lg shrink-0">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <Field label="Method" value={`${log.method} ${log.path}`} mono />
            <Field label="Status" value={String(log.statusCode)} mono />
            {log.resourceId && <Field label="Resource ID" value={log.resourceId} mono />}
          </div>

          {(log.before !== undefined || log.after !== undefined) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-1.5">Trước</p>
                <pre className="bg-surface-container-low rounded-xl p-3 text-[11px] leading-relaxed overflow-auto max-h-80 whitespace-pre-wrap break-words">{fmtJson(log.before)}</pre>
              </div>
              <div>
                <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-1.5">Sau</p>
                <pre className="bg-surface-container-low rounded-xl p-3 text-[11px] leading-relaxed overflow-auto max-h-80 whitespace-pre-wrap break-words">{fmtJson(log.after)}</pre>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-outline-variant/10 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors">
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-sm text-on-surface break-all ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}
