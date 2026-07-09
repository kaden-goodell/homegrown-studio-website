import { useState, useEffect } from 'react'
import PartyModal from './PartyModal'

interface Craft {
  id: string
  name: string
  perHeadCents: number
  perHeadMaxCents?: number
  description?: string
  imageUrl?: string | null
  personalized?: boolean
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}
function priceCompact(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : formatPrice(cents)
}
function perPersonLabel(minCents: number, maxCents?: number): string {
  return maxCents && maxCents > minCents ? `${priceCompact(minCents)}–${priceCompact(maxCents)}` : formatPrice(minCents)
}

export default function PartyLanding() {
  const [crafts, setCrafts] = useState<Craft[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [initialStart, setInitialStart] = useState<string | undefined>(undefined)
  const [initialCraftId, setInitialCraftId] = useState<string | undefined>(undefined)

  // Load the crafts so people can browse them before booking.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/party/service-info.json', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled) setCrafts(((json.data ?? json).crafts ?? []) as Craft[])
      } catch {
        /* gallery just stays empty; the Book a Party button still works */
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Deeplinks: ?start=<ISO> (calendar → preselect the slot) and/or ?craft=<id>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const start = params.get('start')
    const craft = params.get('craft')
    if (start) setInitialStart(start)
    if (craft) setInitialCraftId(craft)
    if (start || craft) setModalOpen(true)
  }, [])

  function bookCraft(id: string) {
    setInitialCraftId(id)
    setInitialStart(undefined)
    setModalOpen(true)
  }
  function bookAny() {
    setInitialCraftId(undefined)
    setInitialStart(undefined)
    setModalOpen(true)
  }

  return (
    <div>
      {/* Craft gallery — see what you'll make before you book */}
      {crafts.length > 0 && (
        <div style={{ marginBottom: '3.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', textAlign: 'center', marginBottom: '1.75rem' }}>
            Pick Your Craft
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))', gap: '1.5rem' }}>
            {crafts.map((craft) => (
              <button
                key={craft.id}
                type="button"
                onClick={() => bookCraft(craft.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  textAlign: 'left',
                  padding: 0,
                  borderRadius: '1rem',
                  overflow: 'hidden',
                  border: '1px solid rgba(150, 112, 91, 0.15)',
                  background: 'rgba(255, 255, 255, 0.9)',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.25s ease, transform 0.25s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 14px 32px rgba(150,112,91,0.18)'; e.currentTarget.style.transform = 'translateY(-3px)' }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}
              >
                {/* Image (or a tasteful placeholder) — fixed 4:3 so every card aligns */}
                <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, rgba(150,112,91,0.10), rgba(198,167,142,0.20))' }}>
                  {craft.imageUrl ? (
                    <img src={craft.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <span style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', fontWeight: 600, color: 'rgba(150,112,91,0.55)', textAlign: 'center', padding: '0 1rem' }}>{craft.name}</span>
                  )}
                  <span style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', background: 'rgba(255,255,255,0.94)', borderRadius: '2rem', padding: '0.28rem 0.7rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-dark)', boxShadow: '0 1px 5px rgba(0,0,0,0.12)' }}>
                    {perPersonLabel(craft.perHeadCents, craft.perHeadMaxCents)}/person
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '1rem 1.125rem 1.25rem' }}>
                  <span style={{ fontSize: '1.0625rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)' }}>{craft.name}</span>
                  {craft.description && (
                    <p style={{ margin: '0.4rem 0 0', fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--color-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {craft.description}
                    </p>
                  )}
                  <span style={{ marginTop: 'auto', paddingTop: '0.85rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                    Book this craft →
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Secondary CTA — primary path is picking a craft above */}
      <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
        <button
          onClick={bookAny}
          style={{
            padding: '0.8rem 2rem',
            background: 'transparent',
            color: 'var(--color-primary)',
            border: '1.5px solid var(--color-primary)',
            borderRadius: '0.75rem',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.2s ease, color 0.2s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-primary)'; e.currentTarget.style.color = '#fff' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-primary)' }}
        >
          {crafts.length > 0 ? 'Or just start a booking' : 'Book a Party'}
        </button>
      </div>

      {/* How it works */}
      <div style={{ maxWidth: '32rem', margin: '0 auto 3rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', textAlign: 'center', marginBottom: '1.5rem' }}>
          How It Works
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[
            { step: '1', text: 'Pick your craft and a date' },
            { step: '2', text: 'Tell us roughly how many guests' },
            { step: '3', text: 'Pay the $200 studio fee to reserve' },
            { step: '4', text: 'Pay for crafts at the studio, based on who comes' },
          ].map(({ step, text }) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 1.25rem', borderRadius: '0.75rem', background: 'rgba(255, 255, 255, 0.6)', border: '1px solid rgba(150, 112, 91, 0.08)' }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'rgba(150, 112, 91, 0.12)', color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.8125rem', flexShrink: 0 }}>
                {step}
              </span>
              <span style={{ fontWeight: 500, color: 'var(--color-dark)', fontSize: '0.875rem' }}>{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing callout */}
      <div style={{ maxWidth: '32rem', margin: '0 auto', textAlign: 'center', padding: '2rem', borderRadius: '1rem', background: 'rgba(34, 197, 94, 0.06)', border: '1px solid rgba(34, 197, 94, 0.15)' }}>
        <h3 style={{ fontSize: '1.125rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.5rem' }}>
          The Whole Studio Is Yours
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6 }}>
          Reserve the entire studio for a private party with a $200 studio fee. Crafts are
          paid per person at the studio, based on who actually comes — so no-shows never
          cost you.
        </p>
      </div>

      {modalOpen && (
        <PartyModal
          onClose={() => { setModalOpen(false); setInitialStart(undefined); setInitialCraftId(undefined) }}
          initialStart={initialStart}
          initialCraftId={initialCraftId}
        />
      )}
    </div>
  )
}
