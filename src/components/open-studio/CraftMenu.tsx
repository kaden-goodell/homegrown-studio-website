import { useEffect, useState } from 'react'

interface Craft {
  id: string
  name: string
  perHeadCents: number
  perHeadMaxCents: number
  description?: string
  imageUrl?: string
  popular?: boolean
}

/** A craft can have multiple priced variations — show a range when min ≠ max. */
function formatPrice(c: Craft): string {
  if (!c.perHeadCents) return ''
  const min = (c.perHeadCents / 100).toFixed(0)
  if (c.perHeadMaxCents > c.perHeadCents) return `$${min}–$${(c.perHeadMaxCents / 100).toFixed(0)}`
  return `$${min}`
}

export default function CraftMenu() {
  const [crafts, setCrafts] = useState<Craft[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(false)
    // NOTE: this endpoint wraps its payload as { data: { crafts, ... } } —
    // unwrap exactly like PartyLanding/PartyModal do (json.data ?? json).
    fetch('/api/party/service-info.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`service-info ${r.status}`))))
      .then((json: { data?: { crafts?: Craft[] }; crafts?: Craft[] }) => {
        if (cancelled) return
        const data = json.data ?? json
        setCrafts(Array.isArray(data?.crafts) ? data.crafts : [])
      })
      .catch((err) => {
        // Distinct from an empty catalog: a transient API blip must not read
        // as "we have no menu".
        console.error('service-info fetch failed:', err)
        if (!cancelled) {
          setError(true)
          setCrafts([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (crafts === null) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))', gap: '1.5rem' }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="animate-pulse glass" style={{ borderRadius: '1rem', height: '18rem' }} />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
        The menu is being slow to load —{' '}
        <button
          onClick={() => window.location.reload()}
          style={{ color: 'var(--color-primary)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
        >
          give it another try
        </button>
        , or come see today&rsquo;s crafts in person.
      </p>
    )
  }

  if (crafts.length === 0) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
        Craft menu coming soon — follow us for the latest.
      </p>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))', gap: '1.5rem' }}>
      {crafts.map((c) => (
        <div key={c.id} className="glass hover-card" style={{ borderRadius: '1rem', overflow: 'hidden' }}>
          {c.imageUrl && (
            <img src={c.imageUrl} alt={c.name} loading="lazy" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover' }} />
          )}
          <div style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
              <h3 className="font-heading" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-dark)' }}>{c.name}</h3>
              {formatPrice(c) && (
                <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>
                  {formatPrice(c)}
                </span>
              )}
            </div>
            {c.description && (
              <p
                style={{
                  marginTop: '0.5rem',
                  fontSize: '0.875rem',
                  lineHeight: 1.6,
                  color: 'var(--color-muted)',
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {c.description}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
