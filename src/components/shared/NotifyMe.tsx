import { useId, useRef, useState } from 'react'
import { partyContent } from '@config/party-content'
import { trackNotifyMe } from '@lib/analytics'

/**
 * One email field and a button: "tell me when…". Used wherever the site has
 * to say "not yet" — booking closed, kits coming, no workshops listed, a
 * sold-out class — so an interested visitor always has something to do.
 *
 * Posts to /api/party/notify-me.json, which keeps the email (and `interest`)
 * on the customer record and tells the owners. That endpoint works while
 * booking is closed.
 */
interface NotifyMeProps {
  /** What they were looking at, e.g. "workshop:Kinusaiga 2026-10-16". Max 80 chars. */
  interest: string
  buttonLabel?: string
  /** The promise under the button: how many emails, and nothing more. */
  note?: string
  successText?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Status = 'idle' | 'sending' | 'done'

export default function NotifyMe({
  interest,
  buttonLabel = 'Tell me when it opens',
  note = 'One email. No mailing list unless you ask for it.',
  successText = 'Got it. We’ll email you the day booking opens.',
}: NotifyMeProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  function fail(message: string) {
    setError(message)
    setStatus('idle')
    inputRef.current?.focus()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'sending') return

    const value = email.trim()
    if (!value) return fail('Add your email so we can reach you.')
    if (!EMAIL_RE.test(value)) return fail('That email doesn’t look right. Check for typos.')

    setError('')
    setStatus('sending')
    try {
      const res = await fetch('/api/party/notify-me.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, interest }),
      })
      if (res.ok) {
        trackNotifyMe(interest)
        setStatus('done')
        return
      }
      if (res.status === 429) return fail('That’s a lot of sign-ups from one place. Please try again in a few minutes.')
      fail(`We couldn’t save that. Please try again, or text us at ${partyContent.textNumber}.`)
    } catch {
      fail(`We couldn’t save that. Please try again, or text us at ${partyContent.textNumber}.`)
    }
  }

  if (status === 'done') {
    return (
      <p role="status" style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--craft-green-ink)', margin: 0 }}>
        {successText}
      </p>
    )
  }

  const errorId = `${id}-error`

  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', maxWidth: '26rem', margin: '0 auto', textAlign: 'left' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <label htmlFor={id} style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>
          Email address
        </label>
        <input
          ref={inputRef}
          id={id}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (error) setError('')
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          placeholder="you@example.com"
          style={{
            width: '100%',
            minHeight: '3rem',
            padding: '0.75rem 1rem',
            borderRadius: '0.75rem',
            border: `1.5px solid ${error ? 'var(--color-error)' : 'var(--color-field-border)'}`,
            background: 'var(--color-surface)',
            color: 'var(--color-dark)',
            // 16px keeps iPhones from zooming the page when the field is tapped
            fontSize: '1rem',
            fontFamily: 'var(--font-body)',
          }}
        />
        {error && (
          <p id={errorId} role="alert" style={{ fontSize: '0.875rem', color: 'var(--color-error)', margin: 0 }}>
            {error}
          </p>
        )}
      </div>
      <button type="submit" className="btn btn-primary" aria-busy={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : buttonLabel}
      </button>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', textAlign: 'center', margin: 0 }}>{note}</p>
    </form>
  )
}
