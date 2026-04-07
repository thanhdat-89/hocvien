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
  })

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.content.trim()) return

    setSubmitting(true)
    try {
      await api.post('/notifications', {
        ...form,
        sendViaZalo: false, // Tính năng Zalo sẽ được kích hoạt sau
      })
      addToast('Đã tạo thông báo thành công', 'success')
      setForm({ title: '', content: '', type: 'GENERAL', targetType: 'ALL' })
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
                onChange={e => setForm(f => ({ ...f, targetType: e.target.value as NotificationTarget }))}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                {(Object.keys(TARGET_LABELS) as NotificationTarget[]).map(t => (
                  <option key={t} value={t}>{TARGET_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Toggle Zalo — disabled, sắp ra mắt */}
          <div className="flex items-center gap-3 py-3 px-4 rounded-lg bg-surface-container border border-outline-variant/30 opacity-60 cursor-not-allowed select-none">
            <input
              type="checkbox"
              disabled
              className="w-4 h-4 rounded border-outline-variant cursor-not-allowed"
            />
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">send</span>
            <span className="text-sm font-medium text-on-surface-variant flex-1">Gửi qua Zalo OA</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-white bg-primary px-2 py-0.5 rounded-full">
              Sắp ra mắt
            </span>
          </div>

          {/* Submit */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !form.title.trim() || !form.content.trim()}
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
