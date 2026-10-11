import { useId, useRef, useState } from 'react'
import { posthogId, trackNewsletterFailed, trackNewsletterSubscribed } from '@lib/analytics'

/**
 * One quiet grey line at the bottom of a class's booking screen, for the
 * people who read a class and decide "not this one": tap it and an email field
 * opens in place. No pop-up, no box, nothing in front of the booking
 * (Kaden, 11 Oct 2026: "just don't be annoying").
 *
 * Saves to the same list as the home-page signup (/api/customer/subscribe.json).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function NewClassesSignup() {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState('')

  const quiet = { margin: 0, fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--color-muted)' } as const

  if (status === 'done') return <p role="status" style={quiet}>You’re on the list.</p>

  if (!open) {
    return (
      <p style={quiet}>
        Not this one?{' '}
        <button
          type="button"
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0) }}
          style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px', cursor: 'pointer' }}
        >
          Get an email when new classes go up.
        </button>
      </p>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'sending') return
    const value = email.trim()
    if (!EMAIL_RE.test(value)) { setError('That email doesn’t look right. Check for typos.'); inputRef.current?.focus(); return }
    setError('')
    setStatus('sending')
    try {
      const res = await fetch('/api/customer/subscribe.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, posthogId: posthogId() }),
      })
      if (res.ok) { trackNewsletterSubscribed(); setStatus('done'); return }
      trackNewsletterFailed('server')
    } catch {
      trackNewsletterFailed('network')
    }
    setStatus('idle')
    setError('We couldn’t save that. Please try again.')
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      <label htmlFor={id} className="sr-only">Email address</label>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          ref={inputRef}
          id={id}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (error) setError('') }}
          aria-invalid={error ? true : undefined}
          style={{ flex: '1 1 12rem', minWidth: 0, minHeight: '2.5rem', padding: '0.4rem 0.75rem', borderRadius: '0.75rem', border: '1.5px solid var(--color-field-border)', background: 'var(--color-surface)', fontSize: '1rem', color: 'var(--color-dark)' }}
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          style={{ minHeight: '2.5rem', padding: '0.4rem 1rem', borderRadius: '0.75rem', border: '1.5px solid var(--color-field-border)', background: 'var(--color-surface)', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)', cursor: 'pointer' }}
        >
          {status === 'sending' ? 'Saving…' : 'Sign me up'}
        </button>
      </div>
      {error
        ? <p role="alert" className="field-error" style={{ margin: 0 }}>{error}</p>
        : <p style={{ ...quiet, fontSize: '0.8125rem' }}>A short email when new classes are posted. Nothing else.</p>}
    </form>
  )
}
