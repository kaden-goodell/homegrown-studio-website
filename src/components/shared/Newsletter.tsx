import { useState } from 'react'

export default function Newsletter() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

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
      <h2 className="text-3xl font-heading font-bold mb-3" style={{ fontFamily: 'var(--font-heading)' }}>
        Stay Inspired
      </h2>
      <p className="text-muted mb-8" style={{ color: 'var(--color-muted)' }}>
        Get workshop announcements, creative tips, and exclusive offers delivered to your inbox.
      </p>

      {status === 'success' ? (
        <p className="text-lg font-medium" style={{ color: 'var(--color-primary)' }}>
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
            className="flex-1 px-5 py-3 rounded-lg border border-gray-200 bg-white text-base focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
            style={{ color: 'var(--color-text)' }}
          />
          <button
            type="submit"
            disabled={status === 'loading'}
            className="px-8 py-3 rounded-lg text-white font-semibold text-base transition hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {status === 'loading' ? 'Subscribing...' : 'Subscribe'}
          </button>
        </form>
      )}

      {status === 'error' && (
        <p className="mt-4 text-sm text-red-600">{message}</p>
      )}
    </div>
  )
}
