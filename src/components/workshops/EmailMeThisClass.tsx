import { useId, useRef, useState } from 'react'
import { posthogId, trackClassEmail } from '@lib/analytics'

/**
 * One quiet grey line at the bottom of a class's booking screen, for the
 * people who like a class but aren't ready to book: tap it and an email field
 * opens in place. They get ONE email with this class and a button back to it;
 * the new-classes list only if they tick the box (unticked by default).
 * No pop-up, no box, nothing in front of the booking
 * (Kaden, 11 Oct 2026: "just don't be annoying").
 *
 * Replaced "Not this one? Get an email when new classes go up." on 2 Nov 2026:
 * nobody used it, and the people browsing liked THIS class.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function EmailMeThisClass({ classId, className }: { classId: string; className: string }) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [alsoNews, setAlsoNews] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState('')
  const quiet = { margin: 0, fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--color-muted)' } as const

  if (status === 'done') return <p role="status" style={quiet}>Sent. Check your inbox.</p>
  if (!open) {
    return (
      <p style={quiet}>
        Not ready to book?{' '}
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            // Show the whole form (the tick box too), not just the field: on a
            // phone it opens right above the pinned Continue button.
            setTimeout(() => {
              inputRef.current?.focus({ preventScroll: true })
              formRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
            }, 0)
          }}
          style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px', cursor: 'pointer' }}
        >
          Email me this class.
        </button>
      </p>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'sending') return
    const value = email.trim()
    if (!EMAIL_RE.test(value)) {
      trackClassEmail('invalid', classId, className)
      setError('That email doesn’t look right. Check for typos.')
      inputRef.current?.focus()
      return
    }
    setError('')
    setStatus('sending')
    try {
      const res = await fetch('/api/workshops/email-me.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, classId, alsoNews, posthogId: posthogId() }),
      })
      if (res.ok) { trackClassEmail('sent', classId, className); setStatus('done'); return }
      if (res.status === 429) {
        trackClassEmail('rate_limited', classId, className)
        const body = await res.json().catch(() => null)
        setStatus('idle')
        setError(typeof body?.error === 'string' ? body.error : 'Too many tries. Please wait a few minutes.')
        return
      }
      trackClassEmail('server', classId, className)
    } catch {
      trackClassEmail('network', classId, className)
    }
    setStatus('idle')
    setError('We couldn’t send that. Please try again.')
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', scrollMarginBottom: '1rem' }}>
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
          {status === 'sending' ? 'Sending…' : 'Send it'}
        </button>
      </div>
      <label style={{ ...quiet, display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={alsoNews} onChange={(e) => setAlsoNews(e.target.checked)} style={{ width: '1.125rem', height: '1.125rem', margin: 0 }} />
        Also tell me when new classes go up
      </label>
      {error && <p role="alert" className="field-error" style={{ margin: 0 }}>{error}</p>}
    </form>
  )
}
