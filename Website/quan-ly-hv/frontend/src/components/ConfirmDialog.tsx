import React, { createContext, useCallback, useContext, useState } from 'react'

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
        <div className="flex items-start gap-3">
          {danger && (
            <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-error">warning</span>
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-base font-bold font-headline text-on-surface">{title}</h3>
            <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={danger
              ? 'px-5 py-2 bg-error text-on-error font-semibold rounded-xl hover:opacity-90 transition-all shadow-sm active:scale-95 text-sm'
              : 'px-5 py-2 bg-primary text-on-primary font-semibold rounded-xl hover:bg-primary-dim transition-all shadow-sm active:scale-95 text-sm'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────
// Imperative API: useConfirm() / useAlert() via Provider
// ───────────────────────────────────────────────────────────────────

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface AlertOptions {
  title?: string
  message: string
  confirmLabel?: string
}

interface DialogContextValue {
  confirm: (opts: ConfirmOptions | string) => Promise<boolean>
  alert: (opts: AlertOptions | string) => Promise<void>
}

const DialogContext = createContext<DialogContextValue | null>(null)

interface DialogState {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  danger: boolean
  isAlert: boolean
  resolver?: (value: boolean) => void
}

const initialState: DialogState = {
  open: false, title: '', message: '', confirmLabel: 'OK',
  cancelLabel: 'Huỷ', danger: false, isAlert: false,
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState>(initialState)

  const confirm = useCallback((opts: ConfirmOptions | string): Promise<boolean> => {
    const o: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts
    return new Promise<boolean>((resolve) => {
      setState({
        open: true,
        title: o.title ?? 'Xác nhận',
        message: o.message,
        confirmLabel: o.confirmLabel ?? 'Xác nhận',
        cancelLabel: o.cancelLabel ?? 'Huỷ',
        danger: o.danger ?? false,
        isAlert: false,
        resolver: resolve,
      })
    })
  }, [])

  const alert = useCallback((opts: AlertOptions | string): Promise<void> => {
    const o: AlertOptions = typeof opts === 'string' ? { message: opts } : opts
    return new Promise<void>((resolve) => {
      setState({
        open: true,
        title: o.title ?? 'Thông báo',
        message: o.message,
        confirmLabel: o.confirmLabel ?? 'Đã hiểu',
        cancelLabel: undefined,
        danger: false,
        isAlert: true,
        resolver: () => resolve(),
      })
    })
  }, [])

  const handleClose = (result: boolean) => {
    state.resolver?.(result)
    setState(s => ({ ...s, open: false }))
  }

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {state.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !state.isAlert && handleClose(false)}
          />
          <div className="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
            <div className="flex items-start gap-3">
              {state.danger && (
                <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-error">warning</span>
                </div>
              )}
              <div className="flex-1">
                <h3 className="text-base font-bold font-headline text-on-surface">{state.title}</h3>
                <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line mt-1">{state.message}</p>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-1">
              {!state.isAlert && (
                <button
                  onClick={() => handleClose(false)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors"
                >
                  {state.cancelLabel}
                </button>
              )}
              <button
                onClick={() => handleClose(true)}
                autoFocus
                className={state.danger
                  ? 'px-5 py-2 bg-error text-on-error font-semibold rounded-xl hover:opacity-90 transition-all shadow-sm active:scale-95 text-sm'
                  : 'px-5 py-2 bg-primary text-on-primary font-semibold rounded-xl hover:bg-primary-dim transition-all shadow-sm active:scale-95 text-sm'}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmDialogProvider')
  return ctx.confirm
}

export function useAlert() {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useAlert must be used within ConfirmDialogProvider')
  return ctx.alert
}
