import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface ToastOptions {
  /** Shows an Undo button; runs when tapped. */
  undo?: () => void
}
type ShowToast = (text: string, opts?: ToastOptions) => void

const ToastContext = createContext<ShowToast>(() => {})

/** The one toast for /admin: near the bottom, above the tab bar. */
export const useToast = () => useContext(ToastContext)

export const TOAST_MS = 4000
/** What a failed save says, everywhere. */
export const DIDNT_SAVE = "Didn't save. Try again."

/**
 * One toast region (role=status, always in the page so screen readers hear
 * each new message). A toast lasts 4 seconds; a newer one replaces it.
 */
export function ToastHost({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; text: string; undo?: () => void } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  const show = useCallback<ShowToast>((text, opts) => {
    if (timer.current) clearTimeout(timer.current)
    seq.current += 1
    setToast({ id: seq.current, text, undo: opts?.undo })
    timer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function undo() {
    const fn = toast?.undo
    if (timer.current) clearTimeout(timer.current)
    setToast(null)
    fn?.()
  }

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="adm-toasts" role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className="adm-toast">
            <span>{toast.text}</span>
            {toast.undo && <button type="button" onClick={undo}>Undo</button>}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}
