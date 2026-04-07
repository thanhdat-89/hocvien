import React, { useEffect } from 'react'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastMessage {
  id: number
  message: string
  type: ToastType
}

interface ToastProps {
  toasts: ToastMessage[]
  onDismiss: (id: number) => void
}

const ICONS: Record<ToastType, string> = {
  success: 'check_circle',
  error: 'error',
  info: 'info',
}

const STYLES: Record<ToastType, string> = {
  success: 'bg-secondary-container/90 text-on-secondary-container border-secondary/30',
  error: 'bg-error-container/90 text-on-error-container border-error/30',
  info: 'bg-surface-container-highest text-on-surface border-outline-variant/30',
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 4000)
    return () => clearTimeout(t)
  }, [toast.id, onDismiss])

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm text-sm font-medium transition-all ${STYLES[toast.type]}`}>
      <span className="material-symbols-outlined text-[18px] shrink-0">{ICONS[toast.type]}</span>
      <span className="flex-1">{toast.message}</span>
      <button onClick={() => onDismiss(toast.id)} className="opacity-60 hover:opacity-100 transition-opacity ml-1">
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  )
}

export default function Toast({ toasts, onDismiss }: ToastProps) {
  if (!toasts.length) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 min-w-[300px] max-w-sm">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
