/**
 * /admin/recover?t=… — the page the emailed "Forgot the passcode?" link opens
 * (M3). Opening it never uses the link up (email scanners open links); it only
 * checks it and shows the form. Saving a new passcode uses it up, signs every
 * other device out and signs this one in. The key leaves the address bar at
 * once (kept in memory only).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import '../../styles/booking-panel.css'
import '../../styles/admin.css'
import { api, RECOVER } from './classes/api'
const MIN = 8

type Stage = { kind: 'checking' } | { kind: 'form' } | { kind: 'dead'; message: string } | { kind: 'done' }

/** Reads the link's key once and takes it out of the address bar. */
function takeToken(): string {
  if (typeof window === 'undefined') return ''
  try {
    const u = new URL(window.location.href)
    const t = u.searchParams.get('t') ?? ''
    if (u.search) history.replaceState(history.state, '', u.pathname)
    return t
  } catch {
    return ''
  }
}

export default function AdminRecover() {
  const token = useRef<string | null>(null)
  if (token.current === null) token.current = takeToken()
  const [stage, setStage] = useState<Stage>({ kind: 'checking' })
  const [code, setCode] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let on = true
    if (!token.current) {
      setStage({ kind: 'dead', message: 'This link doesn’t work. Go to /admin and tap “Forgot the passcode?” for a new one.' })
      return
    }
    api<{ state: string; message?: string }>(RECOVER, { action: 'check', token: token.current }).then((r) => {
      if (!on) return
      if (!r.ok) return setStage({ kind: 'dead', message: r.error ?? 'We couldn’t check the link just now. Try again in a minute.' })
      if (r.data?.state === 'ok') setStage({ kind: 'form' })
      else setStage({ kind: 'dead', message: r.data?.message ?? 'This link doesn’t work.' })
    })
    return () => { on = false }
  }, [])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    const r = await api(RECOVER, { action: 'use', token: token.current, passcode: code, again })
    setBusy(false)
    if (r.ok) { setCode(''); setAgain(''); return setStage({ kind: 'done' }) }
    if (typeof r.extra.state === 'string') return setStage({ kind: 'dead', message: r.error ?? 'This link no longer works.' })
    setError(r.error ?? 'That didn’t work. Try again.')
  }

  return (
    <div className="adm adm-signin">
      <div className="adm-card" aria-live="polite">
        <p className="adm-brand">Hometown Studio</p>
        <h1>Set a new admin passcode</h1>
        {stage.kind === 'checking' && <p className="adm-small">Checking the link…</p>}
        {stage.kind === 'dead' && (
          <>
            <p role="alert">{stage.message}</p>
            <a className="adm-btn is-pri" href="/admin">Go to /admin</a>
          </>
        )}
        {stage.kind === 'done' && (
          <>
            <p role="status">The admin passcode is changed, and you’re signed in on this device. Every other phone or iPad signed in to /admin is signed out and needs the new one. The other owners got an email and a text saying it was reset.</p>
            <a className="adm-btn is-pri" href="/admin">Go to /admin</a>
          </>
        )}
        {stage.kind === 'form' && (
          <form onSubmit={save} aria-label="Set a new admin passcode">
            <p className="adm-small">{`Use at least ${MIN} letters or numbers, with no space at the start or end, and not the staff passcode. Write it somewhere safe: nobody can look it up later.`}</p>
            <label className="adm-fld"><span>New passcode</span><input type={show ? 'text' : 'password'} value={code} autoComplete="new-password" maxLength={64} onChange={(e) => { setCode(e.target.value); setError('') }} /></label>
            <label className="adm-fld"><span>New passcode again</span><input type={show ? 'text' : 'password'} value={again} autoComplete="new-password" maxLength={64} onChange={(e) => { setAgain(e.target.value); setError('') }} /></label>
            <button type="button" className="adm-btn is-ghost is-sm" aria-pressed={show} onClick={() => setShow(!show)}>{show ? 'Hide passcodes' : 'Show passcodes'}</button>
            {error && <p role="alert" className="field-error">{error}</p>}
            <p className="adm-small adm-muted">This link works once. Saving signs every other phone and iPad out of /admin.</p>
            <button type="submit" className="adm-btn is-pri" disabled={busy}>{busy ? 'Saving…' : 'Save new admin passcode'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
