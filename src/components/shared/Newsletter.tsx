import { useState } from 'react'

interface NewsletterProps {
  variant?: 'light' | 'dark'
}

export default function Newsletter({ variant = 'light' }: NewsletterProps) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const isDark = variant === 'dark'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/customer/subscribe.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.ok) {
        setStatus('success')
        setMessage('Thanks for subscribing!')
        setEmail('')
      } else {
        setStatus('error')
        setMessage('Something went wrong. Please try again.')
      }
    } catch {
      setStatus('error')
      setMessage('Something went wrong. Please try again.')
    }
  }

  return (
    <div className="max-w-xl mx-auto text-center">
      <p
        className="uppercase text-xs font-semibold mb-3"
        style={{
          letterSpacing: '0.2em',
          color: isDark ? 'var(--color-accent)' : 'var(--color-accent)',
        }}
      >
        Newsletter
      </p>
      <h2
        className="text-3xl sm:text-4xl font-bold mb-4"
        style={{
          fontFamily: 'var(--font-heading)',
          color: isDark ? 'var(--color-background)' : 'var(--color-dark, #3d3229)',
        }}
      >
        Stay Inspired
      </h2>
      <p
        className="mb-10 text-base"
        style={{
          color: isDark ? 'rgba(250, 248, 245, 0.6)' : 'var(--color-muted)',
        }}
      >
        Get workshop announcements, creative tips, and exclusive offers.
      </p>

      {status === 'success' ? (
        <p
          className="text-lg font-medium"
          style={{ color: isDark ? 'var(--color-accent)' : 'var(--color-primary)' }}
        >
          {message}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="flex-1 px-5 py-3.5 rounded-xl text-base focus:outline-none focus:ring-2 transition-all"
            style={{
              background: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(12px)',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid rgba(255, 255, 255, 0.4)',
              color: isDark ? '#faf8f5' : 'var(--color-text)',
            }}
          />
          <button
            type="submit"
            disabled={status === 'loading'}
            className="px-8 py-3.5 rounded-xl font-semibold text-base transition-all duration-300 disabled:opacity-60"
            style={{
              background: isDark
                ? 'linear-gradient(135deg, var(--color-accent), var(--color-secondary))'
                : 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
              color: isDark ? 'var(--color-dark, #3d3229)' : 'white',
              boxShadow: isDark
                ? '0 4px 15px rgba(212, 165, 116, 0.3)'
                : '0 4px 15px rgba(150, 112, 91, 0.25)',
            }}
          >
            {status === 'loading' ? 'Subscribing...' : 'Subscribe'}
          </button>
        </form>
      )}

      {status === 'error' && (
        <p className="mt-4 text-sm text-red-400">{message}</p>
      )}
    </div>
  )
}
