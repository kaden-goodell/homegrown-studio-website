import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react'
import type { Sheet } from './router'

/**
 * What a sheet can ask of the shell. There is only ever one sheet: `open`
 * from inside a sheet replaces it. `close` and `open` both check the leave
 * prompt first when the sheet's form has unsaved changes.
 */
export interface SheetApi {
  open: (s: Sheet, data?: unknown) => void
  close: () => void
  /** The sheet's form has changes that aren't saved. */
  setDirty: (dirty: boolean) => void
  /** The leave prompt is showing. */
  leaving: boolean
  keepEditing: () => void
  leave: () => void
  /** On an iPad the panel sits beside a page you can still use: not modal there. */
  modal: boolean
  /** Whatever the opener handed over (a calendar item), so the sheet needn't fetch it again. */
  data: unknown
}

const SheetContext = createContext<SheetApi | null>(null)
export const SheetProvider = SheetContext.Provider

export function useSheet(): SheetApi {
  const api = useContext(SheetContext)
  if (!api) throw new Error('useSheet outside a sheet')
  return api
}

/** Report unsaved changes; cleared when the sheet goes. */
export function useSheetDirty(dirty: boolean) {
  const { setDirty } = useSheet()
  useEffect(() => { setDirty(dirty) }, [dirty])
  useEffect(() => () => setDirty(false), [])
}

/** "Leave without saving? [Keep editing] [Leave]", in the sheet, never a browser dialog. */
function LeavePrompt() {
  const { keepEditing, leave } = useSheet()
  const keep = useRef<HTMLButtonElement>(null)
  useEffect(() => { keep.current?.focus() }, [])
  return (
    <div className="adm-panel" role="group" aria-label="Leave without saving?">
      <b>Leave without saving?</b>
      <div className="adm-two">
        <button ref={keep} type="button" className="adm-btn is-ghost" onClick={keepEditing}>Keep editing</button>
        <button type="button" className="adm-btn is-danger" onClick={leave}>Leave</button>
      </div>
    </div>
  )
}

/**
 * The chrome of every sheet: a pinned header (title, subtitle, ×), a body
 * that scrolls, and a pinned footer. While the leave prompt shows, it takes
 * the footer's place.
 */
export function SheetFrame({ title, subtitle, footer, tall, children }: {
  title: string
  subtitle?: ReactNode
  footer?: ReactNode
  /** Opens to full height on a phone (long lists and forms). */
  tall?: boolean
  children: ReactNode
}) {
  const api = useSheet()
  const id = useId()
  return (
    <div className={`adm-sheet${tall ? ' is-tall' : ''}`} role="dialog" aria-modal={api.modal} aria-labelledby={id}>
      <div className="adm-sheet-head">
        <div className="adm-tt">
          <h2 id={id}>{title}</h2>
          {subtitle && <small>{subtitle}</small>}
        </div>
        <button type="button" className="adm-x" aria-label="Close" data-sheet-close="" onClick={api.close}>×</button>
      </div>
      <div className="adm-sheet-body">{children}</div>
      {api.leaving
        ? <div className="adm-sheet-foot"><LeavePrompt /></div>
        : footer
          ? <div className="adm-sheet-foot">{footer}</div>
          : null}
    </div>
  )
}
