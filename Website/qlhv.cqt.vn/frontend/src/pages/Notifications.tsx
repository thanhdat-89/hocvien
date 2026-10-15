import React, { useState, useEffect, useCallback } from 'react'
import api from '../services/api'
import Toast, { ToastMessage } from '../components/Toast'

// ─── Types ────────────────────────────────────────────────────

type NotificationType = 'GENERAL' | 'PAYMENT_DUE' | 'SCHEDULE_CHANGE' | 'EXAM_REMINDER'
type NotificationTarget = 'ALL' | 'CLASS' | 'STUDENT'

interface Notification {
  id: string
  title: string
  content: string
  type: NotificationType
  targetType: NotificationTarget
  targetId?: string
  sendViaZalo: boolean
  sentAt?: string
  createdAt: string
}

// ─── Constants ────────────────────────────────────────────────

const TYPE_LABELS: Record<NotificationType, string> = {
  GENERAL:         'Chung',
  PAYMENT_DUE:     'Học phí',
  SCHEDULE_CHANGE: 'Lịch học',
  EXAM_REMINDER:   'Kiểm tra',
}

const TYPE_COLORS: Record<NotificationType, string> = {
  GENERAL:         'bg-surface-container text-on-surface-variant',
  PAYMENT_DUE:     'bg-error-container text-on-error-container',
  SCHEDULE_CHANGE: 'bg-tertiary-container text-on-tertiary-container',
  EXAM_REMINDER:   'bg-secondary-container text-on-secondary-container',
}

const TARGET_LABELS: Record<NotificationTarget, string> = {
  ALL:     'Tất cả',
  CLASS:   'Lớp học',
  STUDENT: 'Học viên',
}

// ─── Component ────────────────────────────────────────────────

export default function Notifications() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    title: '',
    content: '',
    type: 'GENERAL' as NotificationType,
    targetType: 'ALL' as NotificationTarget,
    targetId: '' as string,
    sendViaZalo: false,
  })

  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [students, setStudents] = useState<{ id: string; fullName: string }[]>([])
  const [targetsLoaded, setTargetsLoaded] = useState(false)

  const addToast = useCallback((message: string, type: ToastMessage['type']) => {
    setToasts(prev => [...prev, { id: Date.now(), message, type }])
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get<{ data: Notification[] }>('/notifications?limit=20')
      setNotifications(res.data.data)
    } catch {
      // Không hiển thị lỗi khi load lần đầu
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchNotifications() }, [fetchNotifications])

  useEffect(() => {
    if (targetsLoaded) return
    api.get<{ classes: { id: string; name: string }[]; students: { id: string; fullName: string }[] }>('/notifications/targets')
      .then(res => {
        setClasses(res.data.classes)
        setStudents(res.data.students)
        setTargetsLoaded(true)
      })
      .catch(() => {})
  }, [targetsLoaded])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.content.trim()) return

    setSubmitting(true)
    try {
      await api.post('/notifications', {
        title: form.title,
        content: form.content,
        type: form.type,
        targetType: form.targetType,
        targetId: form.targetType !== 'ALL' ? form.targetId : undefined,
        sendViaZalo: form.sendViaZalo,
      })
      addToast(form.sendViaZalo ? 'Đã tạo thông báo và gửi qua Zalo OA' : 'Đã tạo thông báo thành công', 'success')
      setForm({ title: '', content: '', type: 'GENERAL', targetType: 'ALL', targetId: '', sendViaZalo: false })
      fetchNotifications()
    } catch {
      addToast('Không thể tạo thông báo. Vui lòng thử lại.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <Toast toasts={toasts} onDismiss={dismissToast} />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Thông báo</h1>
        <p className="text-sm text-on-surface-variant mt-1">Gửi thông báo đến phụ huynh và học viên</p>
      </div>

      {/* Form tạo thông báo */}
      <div className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30">
        <h2 className="text-base font-semibold text-on-surface mb-4">Tạo thông báo mới</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tiêu đề */}
          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1">
              Tiêu đề <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Nhập tiêu đề thông báo..."
              className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              required
            />
          </div>

          {/* Nội dung */}
          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1">
              Nội dung <span className="text-error">*</span>
            </label>
            <textarea
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              placeholder="Nhập nội dung thông báo..."
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              required
            />
          </div>

          {/* Loại & Đối tượng */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-on-surface-variant mb-1">Loại thông báo</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as NotificationType }))}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                {(Object.keys(TYPE_LABELS) as NotificationType[]).map(t => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-on-surface-variant mb-1">Đối tượng</label>
              <select
                value={form.targetType}
                onChange={e => setForm(f => ({ ...f, targetType: e.target.value as NotificationTarget, targetId: '' }))}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                {(Object.keys(TARGET_LABELS) as NotificationTarget[]).map(t => (
                  <option key={t} value={t}>{TARGET_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Chọn lớp hoặc học viên cụ thể */}
          {form.targetType === 'CLASS' && (
            <div>
              <label className="block text-sm font-medium text-on-surface-variant mb-1">Chọn lớp</label>
              <select
                value={form.targetId}
                onChange={e => setForm(f => ({ ...f, targetId: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                required
              >
                <option value="">-- Chọn lớp --</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {form.targetType === 'STUDENT' && (
            <div>
              <label className="block text-sm font-medium text-on-surface-variant mb-1">Chọn học viên</label>
              <select
                value={form.targetId}
                onChange={e => setForm(f => ({ ...f, targetId: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                required
              >
                <option value="">-- Chọn học viên --</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
              </select>
            </div>
          )}

          {/* Toggle gửi qua Zalo OA */}
          <label className={`flex items-center gap-3 py-3 px-4 rounded-lg border cursor-pointer transition-colors ${form.sendViaZalo ? 'bg-primary/5 border-primary/40' : 'bg-surface-container border-outline-variant/30'}`}>
            <input
              type="checkbox"
              checked={form.sendViaZalo}
              onChange={e => setForm(f => ({ ...f, sendViaZalo: e.target.checked }))}
              className="w-4 h-4 rounded border-outline-variant accent-primary"
            />
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">send</span>
            <span className="text-sm font-medium text-on-surface-variant flex-1">Gửi qua Zalo OA</span>
            {form.sendViaZalo && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-white bg-secondary px-2 py-0.5 rounded-full">
                Sẽ gửi Zalo
              </span>
            )}
          </label>

          {/* Submit */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !form.title.trim() || !form.content.trim() || (form.targetType !== 'ALL' && !form.targetId)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-on-primary text-sm font-medium hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                  Đang gửi...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">send</span>
                  Gửi thông báo
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Danh sách thông báo */}
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 overflow-hidden">
        <div className="px-6 py-4 border-b border-outline-variant/20">
          <h2 className="text-base font-semibold text-on-surface">Thông báo gần đây</h2>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-on-surface-variant">
            <span className="material-symbols-outlined text-[24px] animate-spin mr-2">progress_activity</span>
            Đang tải...
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant gap-2">
            <span className="material-symbols-outlined text-[40px] opacity-30">notifications_off</span>
            <p className="text-sm">Chưa có thông báo nào</p>
          </div>
        ) : (
          <ul className="divide-y divide-outline-variant/20">
            {notifications.map(n => (
              <li key={n.id} className="px-6 py-4 hover:bg-surface-container/50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-on-surface truncate">{n.title}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${TYPE_COLORS[n.type]}`}>
                        {TYPE_LABELS[n.type]}
                      </span>
                      <span className="text-[10px] text-outline">• {TARGET_LABELS[n.targetType]}</span>
                    </div>
                    <p className="text-sm text-on-surface-variant line-clamp-2">{n.content}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-outline">
                      <span>{new Date(n.createdAt).toLocaleString('vi-VN')}</span>
                      {n.sendViaZalo && (
                        <span className={`flex items-center gap-1 ${n.sentAt ? 'text-secondary' : 'text-outline'}`}>
                          <span className="material-symbols-outlined text-[12px]">
                            {n.sentAt ? 'check_circle' : 'schedule'}
                          </span>
                          {n.sentAt ? 'Đã gửi Zalo' : 'Chờ gửi Zalo'}
                        </span>
                      )}
                    </div>
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
