import { useEffect, useState } from 'react'

interface Workshop {
  id: string
  name: string
  imageUrl?: string
  date: string // YYYY-MM-DD
  startTime: string // full ISO datetime (workshop-view-model sets startTime: w.startAt) — MUST be formatted before display
  price: number // cents
  remainingSeats: number | null
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Mirrors WorkshopCard.tsx's formatTime — startTime is a raw ISO datetime.
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function UpcomingWorkshops() {
  const [workshops, setWorkshops] = useState<Workshop[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/workshops.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`workshops ${r.status}`))))
      .then((d: { workshops?: Workshop[] }) => {
        if (cancelled) return
        const list = (Array.isArray(d?.workshops) ? d.workshops : [])
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 3)
        setWorkshops(list)
      })
      .catch((err) => {
        // Section hides itself when empty — degrade silently for visitors,
        // but keep the failure visible to developers.
        console.error('workshops fetch failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (workshops.length === 0) return null

  return (
    <section style={{ padding: '3rem 1rem' }}>
      <div style={{ maxWidth: '64rem', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <p className="uppercase" style={{ letterSpacing: '0.2em', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-accent)' }}>
            Coming Up
          </p>
          <h2 className="font-heading" style={{ fontSize: 'clamp(1.875rem, 4vw, 3rem)', fontWeight: 700, color: 'var(--color-dark)' }}>
            Upcoming Workshops
          </h2>
        </div>
        <div style={{ display: 'grid', gap: '1.25rem', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
          {workshops.map((w) => (
            <a key={w.id} href={`/workshops?w=${encodeURIComponent(w.id)}`} className="glass hover-card" style={{ borderRadius: '1rem', overflow: 'hidden', textDecoration: 'none', display: 'block' }}>
              {w.imageUrl && <img src={w.imageUrl} alt={w.name} loading="lazy" style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover' }} />}
              <div style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                  <span>{formatDate(w.date)} · {formatTime(w.startTime)}</span>
                  <span>${(w.price / 100).toFixed(0)}</span>
                </div>
                <h3 className="font-heading" style={{ marginTop: '0.5rem', fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-dark)' }}>{w.name}</h3>
                {w.remainingSeats !== null && w.remainingSeats <= 5 && (
                  <p style={{ marginTop: '0.375rem', fontSize: '0.75rem', fontWeight: 600, color: '#a15d3b' }}>Only {w.remainingSeats} seats left</p>
                )}
                <span style={{ display: 'inline-block', marginTop: '0.75rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-primary)' }}>Grab a seat →</span>
              </div>
            </a>
          ))}
        </div>
        <p style={{ textAlign: 'center', marginTop: '2rem' }}>
          <a href="/workshops" style={{ fontSize: '0.9375rem', fontWeight: 500, color: 'var(--color-primary)' }}>See all workshops →</a>
        </p>
      </div>
    </section>
  )
}
