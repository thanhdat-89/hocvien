import React from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Huỷ',
  onConfirm,
  onCancel,
  danger = false,
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
        <h3 className="text-base font-semibold text-on-surface">{title}</h3>
        <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line">{message}</p>
        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={onCancel}
            className="btn-secondary"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={danger
              ? 'px-5 py-2.5 bg-error text-on-error font-semibold rounded-xl hover:opacity-90 transition-all shadow-md active:scale-95 flex items-center gap-2 text-sm'
              : 'btn-primary'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
