import { useEffect, useRef, useState } from 'react'
import { btn } from '@components/staff/ui'

/**
 * A full-screen cover over a signed-in /staff, with nothing of the roster
 * behind it on screen (the console renders only this while it is up).
 *
 * - `kiosk`: /staff came back while a family had the iPad for the waiver
 *   (a Back swipe, the Back button, a restored page). "Hand the iPad back to
 *   the crew" until the crew tap their own name (crew review C1).
 * - `idle`: nobody has touched the shared iPad for a while. "Still Sam?" so
 *   the next person's refunds and comps aren't logged under Sam (M8).
 *
 * The tap re-checks the sign-in with the server (`onContinue`); if it has
 * lapsed, the console drops to the passcode screen.
 */
export default function HandbackCover({
  mode,
  name,
  onContinue,
  onSwitch,
}: {
  mode: 'kiosk' | 'idle'
  name: string
  onContinue: () => Promise<void>
  onSwitch: () => void
}) {
  const [busy, setBusy] = useState(false)
  const first = firstName(name)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { buttonRef.current?.focus() }, [])

  async function go() {
    if (busy) return
    setBusy(true)
    try { await onContinue() } finally { setBusy(false) }
  }

  const big = (primary = false) => ({ ...btn(primary), minHeight: '3.25rem', fontSize: '1.05rem', width: '100%' })
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="handback-title"
      data-testid="handback-cover"
      style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'var(--color-surface, #fff)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
    >
      <div style={{ width: '100%', maxWidth: '24rem', display: 'grid', gap: '0.8rem', textAlign: 'center' }}>
        <p aria-hidden="true" style={{ margin: 0, fontSize: '2.5rem' }}>{mode === 'kiosk' ? '🙌' : '👋'}</p>
        <h2 id="handback-title" style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.5rem', color: 'var(--color-dark)' }}>
          {mode === 'kiosk' ? 'Hand the iPad back to the crew' : `Still ${first}?`}
        </h2>
        <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-muted)', lineHeight: 1.5 }}>
          {mode === 'kiosk'
            ? 'Thanks! The studio team takes it from here.'
            : 'Nobody has used the iPad for a while. Tap your name so everything you do is saved under you.'}
        </p>
        <button ref={buttonRef} type="button" disabled={busy} onClick={go} style={big(true)}>
          {busy ? 'Checking…' : mode === 'kiosk' ? `I’m ${first}, continue` : `Yes, I’m ${first}`}
        </button>
        <button type="button" disabled={busy} onClick={onSwitch} style={big()}>
          {mode === 'kiosk' ? `Not ${first}? Switch person` : 'Switch person'}
        </button>
      </div>
    </div>
  )
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] || n
