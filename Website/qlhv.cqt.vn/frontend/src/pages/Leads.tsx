import React, { useState, useEffect, useCallback } from 'react'
import api from '../services/api'
import Toast, { ToastMessage } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'

// ─── Types ────────────────────────────────────────────────────

type LeadStatus = 'NEW' | 'COLLECTING' | 'COMPLETED' | 'CONTACTED' | 'ENROLLED' | 'LOST'

interface Lead {
  id: string
  zaloUserId: string
  parentName?: string
  studentName?: string
  gradeLevel?: string
  phone?: string
  status: LeadStatus
  chatStep: number
  note?: string
  source?: string
  createdAt: string
  updatedAt: string
}

interface Stats {
  total: number
  new: number
  completed: number
  contacted: number
  enrolled: number
  lost: number
}

// ─── Constants ────────────────────────────────────────────────

const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; icon: string }> = {
  NEW:        { label: 'Mới', color: 'bg-blue-100 text-blue-700', icon: 'fiber_new' },
  COLLECTING: { label: 'Đang thu thập', color: 'bg-amber-100 text-amber-700', icon: 'hourglass_top' },
  COMPLETED:  { label: 'Đã có thông tin', color: 'bg-green-100 text-green-700', icon: 'check_circle' },
  CONTACTED:  { label: 'Đã liên hệ', color: 'bg-purple-100 text-purple-700', icon: 'phone_callback' },
  ENROLLED:   { label: 'Đã đăng ký', color: 'bg-emerald-100 text-emerald-700', icon: 'how_to_reg' },
  LOST:       { label: 'Không quan tâm', color: 'bg-gray-100 text-gray-500', icon: 'person_off' },
}

const NEXT_ACTIONS: Partial<Record<LeadStatus, LeadStatus>> = {
  COMPLETED: 'CONTACTED',
  CONTACTED: 'ENROLLED',
}

// ─── Component ────────────────────────────────────────────────

export default function Leads() {
  const confirm = useConfirm()
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<LeadStatus | ''>('')
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  const addToast = useCallback((message: string, type: ToastMessage['type']) => {
    setToasts(prev => [...prev, { id: Date.now(), message, type }])
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const fetchData = useCallback(async () => {
    try {
      const params = filter ? `?status=${filter}` : ''
      const [leadsRes, statsRes] = await Promise.all([
        api.get<{ data: Lead[] }>(`/leads${params}`),
        api.get<Stats>('/leads/stats'),
      ])
      setLeads(leadsRes.data.data)
      setStats(statsRes.data)
    } catch {
      addToast('Không thể tải dữ liệu', 'error')
    } finally {
      setLoading(false)
    }
  }, [filter, addToast])

  useEffect(() => { fetchData() }, [fetchData])

  const updateStatus = async (id: string, status: LeadStatus) => {
    try {
      await api.patch(`/leads/${id}`, { status })
      addToast(`Cập nhật thành ${STATUS_CONFIG[status].label}`, 'success')
      fetchData()
    } catch {
      addToast('Cập nhật thất bại', 'error')
    }
  }

  const saveNote = async (id: string) => {
    try {
      await api.patch(`/leads/${id}`, { note: noteText })
      setEditingNote(null)
      addToast('Đã lưu ghi chú', 'success')
      fetchData()
    } catch {
      addToast('Lưu ghi chú thất bại', 'error')
    }
  }

  const deleteLead = async (id: string) => {
    const ok = await confirm({
      title: 'Xoá lead',
      message: 'Bạn có chắc muốn xoá lead này?',
      confirmLabel: 'Xoá',
      danger: true,
    })
    if (!ok) return
    try {
      await api.delete(`/leads/${id}`)
      addToast('Đã xoá', 'success')
      fetchData()
    } catch {
      addToast('Xoá thất bại', 'error')
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Toast toasts={toasts} onDismiss={dismissToast} />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Khách tiềm năng</h1>
        <p className="text-sm text-on-surface-variant mt-1">Quản lý khách hàng từ Zalo OA</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Tổng', value: stats.total, color: 'text-on-surface', bg: 'bg-surface-container' },
            { label: 'Mới', value: stats.new, color: 'text-blue-700', bg: 'bg-blue-50' },
            { label: 'Có thông tin', value: stats.completed, color: 'text-green-700', bg: 'bg-green-50' },
            { label: 'Đã liên hệ', value: stats.contacted, color: 'text-purple-700', bg: 'bg-purple-50' },
            { label: 'Đã đăng ký', value: stats.enrolled, color: 'text-emerald-700', bg: 'bg-emerald-50' },
            { label: 'Mất', value: stats.lost, color: 'text-gray-500', bg: 'bg-gray-50' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl px-4 py-3 text-center`}>
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-[11px] text-on-surface-variant mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilter('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!filter ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}
        >
          Tất cả
        </button>
        {(Object.keys(STATUS_CONFIG) as LeadStatus[]).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === s ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}
          >
            {STATUS_CONFIG[s].label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-on-surface-variant">
            <span className="material-symbols-outlined text-[24px] animate-spin mr-2">progress_activity</span>
            Đang tải...
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant gap-2">
            <span className="material-symbols-outlined text-[40px] opacity-30">person_search</span>
            <p className="text-sm">Chưa có khách tiềm năng nào</p>
          </div>
        ) : (
          <ul className="divide-y divide-outline-variant/20">
            {leads.map(lead => (
              <li key={lead.id} className="px-6 py-4 hover:bg-surface-container/50 transition-colors">
                <div className="flex items-start gap-4">
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-on-surface">
                        {lead.parentName || 'Chưa có tên'}
                      </span>
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_CONFIG[lead.status].color}`}>
                        <span className="material-symbols-outlined text-[10px] mr-0.5 align-middle">{STATUS_CONFIG[lead.status].icon}</span>
                        {STATUS_CONFIG[lead.status].label}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-on-surface-variant">
                      {lead.studentName && (
                        <span className="flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">school</span>
                          {lead.studentName}{lead.gradeLevel ? ` — ${lead.gradeLevel}` : ''}
                        </span>
                      )}
                      {lead.phone && (
                        <span className="flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">call</span>
                          {lead.phone}
                        </span>
                      )}
                    </div>

                    {/* Note */}
                    {editingNote === lead.id ? (
                      <div className="flex gap-2 mt-2">
                        <input
                          type="text"
                          value={noteText}
                          onChange={e => setNoteText(e.target.value)}
                          placeholder="Ghi chú..."
                          className="flex-1 px-2 py-1 text-xs rounded border border-outline-variant bg-surface text-on-surface"
                          autoFocus
                          onKeyDown={e => e.key === 'Enter' && saveNote(lead.id)}
                        />
                        <button onClick={() => saveNote(lead.id)} className="text-xs text-primary font-medium">Lưu</button>
                        <button onClick={() => setEditingNote(null)} className="text-xs text-outline">Huỷ</button>
                      </div>
                    ) : lead.note ? (
                      <p className="text-xs text-outline mt-1 cursor-pointer hover:text-on-surface-variant"
                        onClick={() => { setEditingNote(lead.id); setNoteText(lead.note || '') }}>
                        📝 {lead.note}
                      </p>
                    ) : null}

                    <div className="text-[11px] text-outline mt-1">
                      {new Date(lead.createdAt).toLocaleString('vi-VN')}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Ghi chú */}
                    <button
                      onClick={() => { setEditingNote(lead.id); setNoteText(lead.note || '') }}
                      className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant"
                      title="Ghi chú"
                    >
                      <span className="material-symbols-outlined text-[18px]">edit_note</span>
                    </button>

                    {/* Next action */}
                    {NEXT_ACTIONS[lead.status] && (
                      <button
                        onClick={() => updateStatus(lead.id, NEXT_ACTIONS[lead.status]!)}
                        className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20"
                      >
                        {STATUS_CONFIG[NEXT_ACTIONS[lead.status]!].label}
                      </button>
                    )}

                    {/* Mark lost */}
                    {lead.status !== 'LOST' && lead.status !== 'ENROLLED' && (
                      <button
                        onClick={() => updateStatus(lead.id, 'LOST')}
                        className="p-1.5 rounded-lg hover:bg-error/10 text-outline hover:text-error"
                        title="Không quan tâm"
                      >
                        <span className="material-symbols-outlined text-[18px]">person_off</span>
                      </button>
                    )}

                    {/* Delete */}
                    <button
                      onClick={() => deleteLead(lead.id)}
                      className="p-1.5 rounded-lg hover:bg-error/10 text-outline hover:text-error"
                      title="Xoá"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
