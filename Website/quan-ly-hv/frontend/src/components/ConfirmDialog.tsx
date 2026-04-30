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

interface PromptOptions {
  title?: string
  message: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  inputType?: 'text' | 'password'
}

interface DialogContextValue {
  confirm: (opts: ConfirmOptions | string) => Promise<boolean>
  alert: (opts: AlertOptions | string) => Promise<void>
  prompt: (opts: PromptOptions | string) => Promise<string | null>
}

const DialogContext = createContext<DialogContextValue | null>(null)

type DialogMode = 'confirm' | 'alert' | 'prompt'

interface DialogState {
  open: boolean
  mode: DialogMode
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  danger: boolean
  placeholder?: string
  inputType: 'text' | 'password'
  resolver?: (value: any) => void
}

const initialState: DialogState = {
  open: false, mode: 'confirm', title: '', message: '', confirmLabel: 'OK',
  cancelLabel: 'Huỷ', danger: false, inputType: 'text',
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState>(initialState)
  const [inputValue, setInputValue] = useState('')

  const confirm = useCallback((opts: ConfirmOptions | string): Promise<boolean> => {
    const o: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts
    return new Promise<boolean>((resolve) => {
      setState({
        open: true, mode: 'confirm',
        title: o.title ?? 'Xác nhận',
        message: o.message,
        confirmLabel: o.confirmLabel ?? 'Xác nhận',
        cancelLabel: o.cancelLabel ?? 'Huỷ',
        danger: o.danger ?? false,
        inputType: 'text',
        resolver: resolve,
      })
    })
  }, [])

  const alert = useCallback((opts: AlertOptions | string): Promise<void> => {
    const o: AlertOptions = typeof opts === 'string' ? { message: opts } : opts
    return new Promise<void>((resolve) => {
      setState({
        open: true, mode: 'alert',
        title: o.title ?? 'Thông báo',
        message: o.message,
        confirmLabel: o.confirmLabel ?? 'Đã hiểu',
        cancelLabel: undefined,
        danger: false,
        inputType: 'text',
        resolver: () => resolve(),
      })
    })
  }, [])

  const prompt = useCallback((opts: PromptOptions | string): Promise<string | null> => {
    const o: PromptOptions = typeof opts === 'string' ? { message: opts } : opts
    setInputValue('')
    return new Promise<string | null>((resolve) => {
      setState({
        open: true, mode: 'prompt',
        title: o.title ?? 'Nhập thông tin',
        message: o.message,
        confirmLabel: o.confirmLabel ?? 'OK',
        cancelLabel: o.cancelLabel ?? 'Huỷ',
        danger: false,
        placeholder: o.placeholder,
        inputType: o.inputType ?? 'text',
        resolver: resolve,
      })
    })
  }, [])

  const handleClose = (ok: boolean) => {
    if (state.mode === 'prompt') {
      state.resolver?.(ok ? inputValue : null)
    } else {
      state.resolver?.(ok)
    }
    setState(s => ({ ...s, open: false }))
  }

  return (
    <DialogContext.Provider value={{ confirm, alert, prompt }}>
      {children}
      {state.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => state.mode !== 'alert' && handleClose(false)}
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
            {state.mode === 'prompt' && (
              <input
                type={state.inputType}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleClose(true)
                  if (e.key === 'Escape') handleClose(false)
                }}
                placeholder={state.placeholder}
                autoFocus
                className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            )}
            <div className="flex gap-3 justify-end pt-1">
              {state.mode !== 'alert' && (
                <button
                  onClick={() => handleClose(false)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors"
                >
                  {state.cancelLabel}
                </button>
              )}
              <button
                onClick={() => handleClose(true)}
                autoFocus={state.mode !== 'prompt'}
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

export function usePrompt() {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('usePrompt must be used within ConfirmDialogProvider')
  return ctx.prompt
}
