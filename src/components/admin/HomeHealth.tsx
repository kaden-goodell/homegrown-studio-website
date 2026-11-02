/**
 * Emails, texts and Square on /admin (G2): the Home warning while one isn't
 * getting through, and the test buttons it shares with More › Email, texts
 * and Square. Lives on Home, not in an email, so it shows even when email is
 * the broken thing. Says nothing when all is well or it can't check.
 */
import { useEffect, useState } from 'react'
import type { Service, ServiceHealth } from '@lib/outbound-health'
import { api, HEALTH } from './classes/api'
import type { Sheet } from './shell/router'
import { dayAndClock } from './shell/time'

export type HealthView = Record<Service, ServiceHealth> & { testSite?: boolean; muted?: boolean }

export const SERVICE_NAME: Record<Service, string> = { email: 'Emails', text: 'Texts', square: 'Square' }
export const TEST_LABEL: Record<Service, string> = { email: 'Send me a test email', text: 'Send me a test text', square: 'Check Square' }
const ACTION: Record<Service, string> = { email: 'test-email', text: 'test-text', square: 'check-square' }

/** The warning words for a service that isn't working. */
export function problemText(s: Service, h: ServiceHealth): string {
  const since = h.since ? ` since ${dayAndClock(h.since)}` : ''
  if (h.state === 'not-set') {
    return s === 'square' ? 'Square isn’t set up on this site, so nothing can be paid online.' : `${SERVICE_NAME[s]} aren’t set up on this site, so none go out.`
  }
  if (s === 'email') return `Emails aren’t going out${since}. Customers aren’t getting confirmations, payment links or refund emails.`
  if (s === 'text') return `Texts aren’t going out${since}. Customers and owners aren’t getting texts.`
  return `Square is refusing the website${since}. Bookings, payments and refunds can’t go through online.`
}

export function useHealth() {
  const [view, setView] = useState<HealthView | null>(null)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    api<HealthView>(HEALTH).then((r) => { if (live && r.ok && r.data) setView(r.data) })
    return () => { live = false }
  }, [tries])
  return { view, reload: () => setTries((n) => n + 1) }
}

/** One test button: says what happened right under it, and reloads the health after. */
export function TestButton({ service, onDone, primary }: { service: Service; onDone?: () => void; primary?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  async function run() {
    if (busy) return
    setBusy(true)
    setResult(null)
    const r = await api<{ ok: boolean; message: string }>(HEALTH, { action: ACTION[service] })
    setBusy(false)
    setResult(r.ok && r.data ? { ok: r.data.ok, text: r.data.message } : { ok: false, text: r.error ?? 'That didn’t work. Try again.' })
    onDone?.()
  }
  return (
    <span style={{ display: 'grid', gap: '0.35rem' }}>
      <button type="button" className={`adm-btn ${primary ? 'is-pri' : 'is-ghost'} is-sm`} disabled={busy} onClick={run}>
        {busy ? (service === 'square' ? 'Checking…' : 'Sending…') : TEST_LABEL[service]}
      </button>
      {result && <span className={`adm-small${result.ok ? '' : ' adm-error'}`} role="status">{result.text}</span>}
    </span>
  )
}

export function HomeHealthAlert({ onOpen }: { onOpen: (s: Sheet, data?: unknown) => void }) {
  const { view, reload } = useHealth()
  if (!view) return null
  const bad = (['email', 'text', 'square'] as Service[]).filter((s) => view[s] && (view[s].state === 'failing' || view[s].state === 'not-set'))
  if (!bad.length) return null
  return (
    <>
      {bad.map((s) => (
        <div key={s} className="adm-panel is-warn adm-gap-top" role="group" aria-label={`${SERVICE_NAME[s]} problem`}>
          <span>{problemText(s, view[s])}</span>
          <div className="adm-two">
            {view[s].state === 'failing' && <TestButton service={s} primary onDone={reload} />}
            <button type="button" className="adm-btn is-ghost is-sm" onClick={() => onOpen({ kind: 'more', page: 'connections' }, { focus: s })}>What to do</button>
          </div>
        </div>
      ))}
    </>
  )
}
