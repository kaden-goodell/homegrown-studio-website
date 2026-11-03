import { useState } from 'react'
import { api, RECOVER } from '../classes/api'

/**
 * "Forgot the passcode?" (M3): emails a one-time link to every owner's email
 * on the staff list. Nothing to type, so nobody can point it anywhere else.
 * Also in Admin access › Change the admin passcode, for an owner signed in
 * who forgot the one in use (final review M10).
 */
export function ForgotPasscode({ label = 'Forgot the passcode?' }: { label?: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  async function send() {
    if (busy) return
    setBusy(true)
    const r = await api<{ message: string }>(RECOVER, { action: 'request' })
    setBusy(false)
    setResult(r.ok ? { ok: true, text: r.data?.message ?? 'A link is on its way.' } : { ok: false, text: r.error ?? 'That didn’t work. Try again.' })
  }
  if (!open) return <button type="button" className="adm-quiet" onClick={() => setOpen(true)}>{label}</button>
  return (
    <div className="adm-panel" role="group" aria-label="Forgot the passcode?">
      <b>Forgot the passcode?</b>
      <span className="adm-small">We’ll email a link to every owner’s email in Staff › People (an owner added or changed in the last 3 days isn’t sent one). It works once, for 15 minutes, and lets you set a new admin passcode. Every other phone or iPad is signed out when you do.</span>
      {result && <p role={result.ok ? 'status' : 'alert'} className={result.ok ? 'adm-small' : 'field-error'}>{result.text}</p>}
      {!result?.ok && (
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={() => { setOpen(false); setResult(null) }}>Cancel</button>
          <button type="button" className="adm-btn is-pri" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Email the owners a link'}</button>
        </div>
      )}
    </div>
  )
}
