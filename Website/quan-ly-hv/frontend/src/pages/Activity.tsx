import React, { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
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
}

const ACTION_TONE: Record<ActivityLog['action'], { label: string; cls: string; icon: string }> = {
  CREATE: { label: 'Thêm', cls: 'bg-emerald-50 text-emerald-700', icon: 'add_circle' },
  UPDATE: { label: 'Sửa',  cls: 'bg-amber-50 text-amber-700',     icon: 'edit' },
  DELETE: { label: 'Xoá',  cls: 'bg-rose-50 text-rose-700',       icon: 'delete' },
}

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

export default function Activity() {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchPage = async (cursor?: string) => {
    const params = new URLSearchParams({ limit: '50' })
    if (cursor) params.set('cursor', cursor)
    const res = await api.get(`/activity?${params.toString()}`)
    return res.data as { data: ActivityLog[]; nextCursor: string | null }
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetchPage()
      setLogs(r.data)
      setNextCursor(r.nextCursor)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Không tải được lịch sử')
    } finally {
      setLoading(false)
    }
  }

  const loadMore = async () => {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const r = await fetchPage(nextCursor)
      setLogs(prev => [...prev, ...r.data])
      setNextCursor(r.nextCursor)
    } catch {
      /* keep existing logs visible */
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="space-y-6">
      <TopBar title="Lịch sử hoạt động" />

      <div className="bg-surface rounded-3xl p-6 md:p-8 shadow-sm">
        <p className="text-[10px] uppercase tracking-widest text-primary font-bold mb-1">Audit log</p>
        <h2 className="font-headline text-2xl font-bold text-on-surface mb-6">
          Toàn bộ thay đổi trên hệ thống
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
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
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-16 text-center text-outline">
                    <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">history</span>
                    Chưa có hoạt động nào được ghi nhận
                  </td>
                </tr>
              ) : logs.map(log => {
                const tone = ACTION_TONE[log.action]
                return (
                  <tr key={log.id} className="hover:bg-surface-container-low/30 transition-colors align-top">
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

        {nextCursor && !loading && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-6 py-2.5 rounded-xl bg-primary/10 text-primary font-semibold text-sm hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {loadingMore ? 'Đang tải...' : 'Tải thêm'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
