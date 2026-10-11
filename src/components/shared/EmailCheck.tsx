import { useId, useState } from 'react'

/**
 * The "where did your confirmation go" line on a You're-booked screen, with
 * two quiet ways to put a mistyped email right (11 Oct 2026: a confirmation
 * went to "…phptography@gmail.com"):
 *
 *   - "Wrong email? Fix it": type the right one, the same confirmation is sent there.
 *   - When their phone matched a Square record whose email is a letter or two
 *     off, both got the email; one question settles which is theirs.
 *
 * Posts to /api/booking/fix-email.json with the signed ticket the booking returned.
 */
export interface EmailCheckData {
  token: string
  sentTo: string
  onFile: string | null
}

interface EmailCheckProps {
  check: EmailCheckData
  /** Told the address that is now theirs, so the next booking this visit uses it. */
  onEmailChanged?: (email: string) => void
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const linkButton = {
  background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--color-primary)',
  textDecoration: 'underline', textUnderlineOffset: '2px', cursor: 'pointer',
} as const

export default function EmailCheck({ check, onEmailChanged }: EmailCheckProps) {
  const id = useId()
  const [email, setEmail] = useState(check.sentTo)
  const [token, setToken] = useState(check.token)
  const [onFile, setOnFile] = useState(check.onFile)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(check.sentTo)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  async function send(next: string, kind: 'choose' | 'fix') {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/booking/fix-email.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email: next }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.data) {
        setError(body?.error ?? 'That didn’t go through. Please try again.')
        return
      }
      setToken(body.data.token)
      setEmail(body.data.email)
      setOnFile(null)
      setEditing(false)
      setNote(kind === 'choose' ? `Got it. We’ll use ${body.data.email} from now on.` : `Sent to ${body.data.email}.`)
      onEmailChanged?.(body.data.email)
    } catch {
      setError('That didn’t go through. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const small = { margin: '0.375rem 0 0', fontSize: '0.875rem', color: 'var(--color-text)', lineHeight: 1.5 } as const

  return (
    <div>
      <p role="status" style={{ margin: '0.5rem 0 0', fontSize: '0.9375rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
        A confirmation is on its way to <strong>{email}</strong>.
      </p>

      {onFile && (
        <div style={{ ...small, marginTop: '0.625rem' }}>
          <p style={{ margin: 0 }}>
            We also sent it to <strong>{onFile}</strong>, the email we have for you. Which one is right?
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
            {[email, onFile].map((choice) => (
              <button key={choice} type="button" className="btn btn-quiet" style={{ width: 'auto', maxWidth: '100%', overflowWrap: 'anywhere' }} disabled={busy} onClick={() => send(choice, 'choose')}>
                {choice}
              </button>
            ))}
          </div>
        </div>
      )}

      {!onFile && !editing && (
        <p style={small}>
          {note ? <>{note} </> : null}
          <button type="button" style={linkButton} onClick={() => { setDraft(email); setEditing(true); setNote('') }}>
            Wrong email? Fix it
          </button>
        </p>
      )}

      {editing && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            const next = draft.trim()
            if (!EMAIL_RE.test(next)) { setError('That email doesn’t look right. Check for typos.'); return }
            void send(next, 'fix')
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginTop: '0.625rem', textAlign: 'left' }}
        >
          <label htmlFor={id} style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>The right email</label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              id={id}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); if (error) setError('') }}
              className="field-input"
              style={{ flex: '1 1 12rem', minWidth: 0 }}
            />
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={busy}>
              {busy ? 'Sending…' : 'Send it there'}
            </button>
          </div>
          <button type="button" style={{ ...linkButton, alignSelf: 'flex-start', fontSize: '0.875rem', color: 'var(--color-text)' }} onClick={() => { setEditing(false); setError('') }}>
            Never mind
          </button>
        </form>
      )}

      {error && <p role="alert" className="field-error" style={{ margin: '0.375rem 0 0' }}>{error}</p>}
    </div>
  )
}
