import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import '../../styles/booking-panel.css'

/**
 * The shell both booking flows sit in (parties and workshops), so they look
 * and behave the same:
 *
 *   ┌ title ─────────────────────── × ┐   fixed
 *   │ ← Back  STEP NAME     Step 1 of 3│
 *   │ summary (one line on phones)     │
 *   ├──────────────────────────────────┤
 *   │ step content                     │   scrolls
 *   ├──────────────────────────────────┤
 *   │ [ primary button ]               │   fixed
 *   └──────────────────────────────────┘
 *
 * - Rendered at the end of <body>, so it sits above the site header and
 *   everything else. The rest of the page is made inert while it is open:
 *   nothing behind it can be clicked or reached with the keyboard.
 * - Solid surface. Nothing behind it shows through.
 * - On phones it is a bottom sheet that never exceeds the visible window.
 * - Changing step starts at the top and moves focus to the step's heading.
 * - Focus returns to whatever opened the panel when it closes.
 * - Escape asks to close. With the leave prompt up, Escape dismisses the prompt.
 * - Honours "reduce motion".
 */
export interface BookingPanelProps {
  /** Shown at the top on every step, and announced as the dialog's name. */
  title: string
  /** The customer asked to close (×, Escape, tap outside). The flow decides whether to ask first. */
  onRequestClose: () => void
  /** Changes when the step changes: resets scroll and moves focus. */
  stepKey: string
  /** "Date & time". Omit on the confirmation screen. */
  stepName?: string
  /** 1-based. With stepCount, shows "Step 2 of 3" and the progress bar. */
  stepNumber?: number
  stepCount?: number
  /** What has been chosen so far. Stays in view on every step. */
  summary?: ReactNode
  /** Omit on the first step and on the confirmation screen: no Back button then. */
  onBack?: () => void
  /** Pinned to the bottom: the primary button and anything that belongs with it. */
  footer?: ReactNode
  /** Wide suits a two-column picker; narrow suits a form. */
  width?: 'wide' | 'narrow'
  /** The leave prompt, when the flow wants one shown. */
  leavePrompt?: {
    title: string
    body: string
    keepLabel?: string
    leaveLabel?: string
    onKeep: () => void
    onLeave: () => void
  } | null
  /**
   * A payment is going through. Close requests (×, Escape, tapping outside)
   * don't close the panel: they show this note with a single OK, and leaving
   * or reloading the page asks the browser to confirm first.
   */
  busy?: { title: string; body: string } | null
  children: ReactNode
}

/** What the panel says when someone tries to leave while a payment is going through. */
export const PAYMENT_GOING_THROUGH = {
  title: 'Your payment is going through',
  body: 'Stay on this page. It only takes a moment.',
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'

function usePhoneSheet(): boolean {
  const [sheet, setSheet] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    setSheet(mq.matches)
    const onChange = (ev: MediaQueryListEvent) => setSheet(ev.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return sheet
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (ev: MediaQueryListEvent) => setReduced(ev.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export default function BookingPanel({
  title,
  onRequestClose,
  stepKey,
  stepName,
  stepNumber,
  stepCount,
  summary,
  onBack,
  footer,
  width = 'narrow',
  leavePrompt,
  busy = null,
  children,
}: BookingPanelProps) {
  const titleId = useId()
  const [host, setHost] = useState<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stepHeadingRef = useRef<HTMLParagraphElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const promptRef = useRef<HTMLDivElement>(null)
  const [busyNote, setBusyNote] = useState(false)
  const sheet = usePhoneSheet()
  const reducedMotion = useReducedMotion()

  // While a payment is going through, a close request shows the "stay here" note instead.
  const requestClose = () => {
    if (busy) setBusyNote(true)
    else onRequestClose()
  }
  useEffect(() => {
    if (!busy) setBusyNote(false)
  }, [!!busy])
  // Leaving or reloading the page mid-payment: the browser asks first.
  useEffect(() => {
    if (!busy) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [!!busy])

  // The prompt on screen: the busy note, else the leave prompt.
  const shownPrompt = busyNote && busy
    ? { title: busy.title, body: busy.body, keepLabel: 'OK', leaveLabel: undefined as string | undefined, onKeep: () => setBusyNote(false), onLeave: undefined as (() => void) | undefined }
    : leavePrompt
      ? { ...leavePrompt, leaveLabel: leavePrompt.leaveLabel ?? 'Close', onLeave: leavePrompt.onLeave as (() => void) | undefined }
      : null

  // Latest handlers, so the key listener never goes stale.
  const handlers = useRef({ requestClose, shownPrompt })
  handlers.current = { requestClose, shownPrompt }

  // Mount at the end of <body>, above everything, and make the rest inert.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const el = document.createElement('div')
    el.setAttribute('data-booking-panel', '')
    document.body.appendChild(el)
    setHost(el)

    const others = Array.from(document.body.children).filter((c) => c !== el) as HTMLElement[]
    const wasInert = others.map((c) => c.hasAttribute('inert'))
    others.forEach((c) => c.setAttribute('inert', ''))

    const previousOverflow = document.body.style.overflow
    // Also the signal the glitter uses to hold still while a panel is open.
    document.body.style.overflow = 'hidden'

    return () => {
      others.forEach((c, i) => {
        if (!wasInert[i]) c.removeAttribute('inert')
      })
      document.body.style.overflow = previousOverflow
      el.remove()
      if (opener && document.contains(opener)) opener.focus?.()
    }
  }, [])

  // Announce the dialog once it is on the page.
  useEffect(() => {
    if (host) panelRef.current?.focus()
  }, [host])

  // A new step starts at the top, with focus on its heading.
  const firstStep = useRef(true)
  useEffect(() => {
    if (!host) return
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    if (firstStep.current) {
      firstStep.current = false
      return
    }
    ;(stepHeadingRef.current ?? panelRef.current)?.focus()
  }, [stepKey, host])

  // The leave prompt takes focus on its safe choice; closing it returns focus to the panel.
  const promptOpen = !!shownPrompt
  const hadPrompt = useRef(false)
  useEffect(() => {
    if (!host) return
    if (promptOpen) keepRef.current?.focus()
    else if (hadPrompt.current) panelRef.current?.focus()
    hadPrompt.current = promptOpen
  }, [promptOpen, host])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const { requestClose: close, shownPrompt: prompt } = handlers.current
      if (e.key === 'Escape') {
        e.preventDefault()
        if (prompt) prompt.onKeep()
        else close()
        return
      }
      if (e.key !== 'Tab') return
      // With a prompt up, Tab stays inside the prompt.
      const root = prompt ? promptRef.current : panelRef.current
      if (!root) return
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      )
      if (items.length === 0) {
        e.preventDefault()
        root.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!host) return null

  const showProgress = !!stepName && !!stepNumber && !!stepCount
  const progress = showProgress ? (stepCount === 1 ? 100 : ((stepNumber! - 1) / (stepCount! - 1)) * 100) : 0
  const pad = sheet ? '1.25rem' : '2rem'
  const iconButton = {
    minWidth: '2.75rem',
    minHeight: '2.75rem',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    borderRadius: '0.5rem',
    color: 'var(--color-text)',
    cursor: 'pointer',
  } as const
  const backButton = {
    ...iconButton,
    justifyContent: 'flex-start',
    gap: '0.25rem',
    padding: '0 0.375rem 0 0',
    marginLeft: '-0.125rem',
    fontSize: '0.9375rem',
    fontFamily: 'inherit',
    flexShrink: 0,
  } as const

  return createPortal(
    <div
      className="booking-panel-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: sheet ? 'flex-end' : 'center',
        justifyContent: 'center',
        background: 'rgba(30, 22, 17, 0.5)',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="booking-panel"
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: sheet ? 'none' : width === 'wide' ? '56rem' : '34rem',
          maxHeight: sheet ? '94dvh' : 'min(90dvh, 52rem)',
          margin: sheet ? 0 : '1rem',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-line)',
          borderRadius: sheet ? '1.25rem 1.25rem 0 0' : '1.25rem',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.25)',
          outline: 'none',
          overflow: 'hidden',
        }}
      >
        {/* Fixed top: title, step, what's been chosen */}
        <div style={{ padding: `${sheet ? '0.75rem' : '1.25rem'} ${pad} 0`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
            <h2
              id={titleId}
              style={{
                margin: 0,
                fontSize: sheet ? '1.125rem' : '1.25rem',
                lineHeight: 1.25,
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                color: 'var(--color-dark)',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: sheet ? 1 : 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {title}
            </h2>
            <button type="button" onClick={requestClose} aria-label="Close" style={{ ...iconButton, fontSize: '1.75rem', lineHeight: 1, marginRight: '-0.5rem', flexShrink: 0 }}>
              <span aria-hidden="true">&times;</span>
            </button>
          </div>

          {/* UI review: Back lives up here, next to the step name, so the step itself gets the screen. */}
          {onBack && !showProgress && (
            <button type="button" onClick={onBack} style={backButton}>
              <span aria-hidden="true">&larr;</span>
              Back
            </button>
          )}
          {showProgress && (
            <div style={{ marginTop: sheet ? '0.25rem' : '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: sheet ? '0.375rem' : '0.5rem', gap: '0.75rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                {onBack && (
                  <button type="button" onClick={onBack} style={backButton}>
                    <span aria-hidden="true">&larr;</span>
                    Back
                  </button>
                )}
                <p
                  ref={stepHeadingRef}
                  tabIndex={-1}
                  style={{ margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8125rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-dark)', outline: 'none' }}
                >
                  {stepName}
                </p>
                </span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
                  {/* Phones: "2 of 3" leaves room for Back and the step name on one line. */}
                  {sheet ? `${stepNumber} of ${stepCount}` : `Step ${stepNumber} of ${stepCount}`}
                </span>
              </div>
              <div style={{ height: '3px', background: 'var(--color-line)', borderRadius: '2px', overflow: 'hidden' }}>
                <div
                  role="progressbar"
                  aria-label="Booking progress"
                  aria-valuenow={stepNumber}
                  aria-valuemin={1}
                  aria-valuemax={stepCount}
                  style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: 'var(--color-primary)',
                    transition: reducedMotion ? 'none' : 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          )}

          {summary && <div className={sheet ? 'booking-panel-summary-compact' : undefined} style={{ marginTop: sheet ? '0.5rem' : '0.75rem' }}>{summary}</div>}
          <div style={{ height: sheet ? '0.5rem' : '0.75rem' }} />
        </div>

        {/* Scrolls */}
        <div
          ref={scrollRef}
          className="booking-panel-scroll"
          style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: `0.25rem ${pad} 1.25rem` }}
        >
          {children}
        </div>

        {/* Fixed bottom: the button that moves the booking on */}
        {footer && (
          <div
            className="booking-panel-footer"
            style={{
              flexShrink: 0,
              padding: sheet ? `0.625rem ${pad} calc(0.625rem + env(safe-area-inset-bottom, 0px))` : `0.875rem ${pad} calc(0.875rem + env(safe-area-inset-bottom, 0px))`,
              borderTop: '1px solid var(--color-line)',
              background: 'var(--color-surface)',
            }}
          >
            {footer}
          </div>
        )}
      </div>

      {shownPrompt && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`${titleId}-prompt`}
          aria-describedby={`${titleId}-prompt-body`}
          onMouseDown={(e) => {
            // Tapping outside keeps the booking: the safe choice.
            if (e.target === e.currentTarget) shownPrompt.onKeep()
          }}
          style={{ position: 'fixed', inset: 0, zIndex: 1010, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(30, 22, 17, 0.45)' }}
        >
          <div
            ref={promptRef}
            style={{
              width: 'calc(100% - 3rem)',
              maxWidth: '22rem',
              padding: '1.5rem 1.5rem 1.25rem',
              borderRadius: '1rem',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-line)',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.3)',
              textAlign: 'center',
            }}
          >
            <p id={`${titleId}-prompt`} style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 600, color: 'var(--color-dark)' }}>{shownPrompt.title}</p>
            <p id={`${titleId}-prompt-body`} style={{ margin: '0.4rem 0 1.1rem', fontSize: '0.9375rem', color: 'var(--color-text)' }}>{shownPrompt.body}</p>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button ref={keepRef} type="button" className="btn btn-primary" style={{ flex: 1.4 }} onClick={shownPrompt.onKeep}>
                {shownPrompt.keepLabel ?? 'Keep booking'}
              </button>
              {shownPrompt.onLeave && (
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={shownPrompt.onLeave}>
                  {shownPrompt.leaveLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    host,
  )
}
