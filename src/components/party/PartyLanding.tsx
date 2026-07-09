import { useState, useEffect } from 'react'
import PartyModal from './PartyModal'
import { partyConfig } from '@config/party.config'
import { partyContent } from '@config/party-content'
import { craftShareUrl } from '@lib/party-share'

interface Craft {
  id: string
  name: string
  perHeadCents: number
  perHeadMaxCents?: number
  description?: string
  imageUrl?: string | null
  personalized?: boolean
  popular?: boolean
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

/** "Sat, Aug 15" from a local YYYY-MM-DD string (built locally to avoid a UTC day shift). */
function formatDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "$200 ÷ 12 guests ≈ $17" — the value reframe, computed from real config. */
const PER_PERSON_EXAMPLE = Math.round(200 / partyContent.deposit.perPersonExample.guests)

export default function PartyLanding() {
  const [crafts, setCrafts] = useState<Craft[]>([])
  const [variationId, setVariationId] = useState<string | null>(null)
  const [nextDates, setNextDates] = useState<string[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [initialStart, setInitialStart] = useState<string | undefined>(undefined)
  const [initialCraftId, setInitialCraftId] = useState<string | undefined>(undefined)
  const [initialDate, setInitialDate] = useState<string | undefined>(undefined)
  const [sharedCraftId, setSharedCraftId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    setIsMobile(mq.matches)
    const handler = (ev: MediaQueryListEvent) => setIsMobile(ev.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Load the crafts so people can browse them before booking.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/party/service-info.json', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        const data = json.data ?? json
        if (!cancelled) {
          setCrafts((data.crafts ?? []) as Craft[])
          setVariationId(data.variationId ?? null)
        }
      } catch {
        /* gallery just stays empty; the Book a Party button still works */
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Next open dates — the urgency strip. Real availability, nothing invented.
  useEffect(() => {
    if (!variationId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/party/available-dates.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serviceVariationId: variationId }),
        })
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled) setNextDates(((json.data ?? json).dates ?? []) as string[])
      } catch {
        /* strip just doesn't render */
      }
    })()
    return () => { cancelled = true }
  }, [variationId])

  // Deeplinks: ?start=<ISO> (calendar slot), ?date=<YYYY-MM-DD> (calendar day),
  // and/or ?craft=<id> (shared craft link).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const start = params.get('start')
    const date = params.get('date')
    const craft = params.get('craft')
    if (start) setInitialStart(start)
    if (date && !start) setInitialDate(date)
    if (craft) setInitialCraftId(craft)
    if (start || date || craft) setModalOpen(true)
  }, [])

  function openModal(opts: { craftId?: string; date?: string } = {}) {
    setInitialCraftId(opts.craftId)
    setInitialDate(opts.date)
    setInitialStart(undefined)
    setModalOpen(true)
  }

  async function shareCraft(craft: Craft) {
    const url = craftShareUrl(craft.id, window.location.origin)
    const text = `Look at this — we could make ${craft.name} at Homegrown Studio! 🎨`
    if (navigator.share) {
      try {
        await navigator.share({ text, url })
        return
      } catch {
        /* sheet closed — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`)
      setSharedCraftId(craft.id)
      setTimeout(() => setSharedCraftId(null), 2000)
    } catch {
      /* clipboard unavailable */
    }
  }

  const closeModal = () => {
    setModalOpen(false)
    setInitialStart(undefined)
    setInitialCraftId(undefined)
    setInitialDate(undefined)
  }

  return (
    <div style={{ paddingBottom: isMobile ? '4.5rem' : 0 }}>
      {/* Craft gallery — see what you'll make before you book */}
      {crafts.length > 0 && (
        <div style={{ marginBottom: '3rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', textAlign: 'center', marginBottom: '0.5rem' }}>
            Pick Your Craft
          </h2>
          <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-muted)', margin: '0 0 1.75rem' }}>
            Every guest makes one — you choose which. Tap share to send a favorite to your group.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))', gap: '1.5rem' }}>
            {crafts.map((craft) => (
              <div
                key={craft.id}
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: '1rem',
                  overflow: 'hidden',
                  border: '1px solid rgba(150, 112, 91, 0.15)',
                  background: 'rgba(255, 255, 255, 0.9)',
                  transition: 'box-shadow 0.25s ease, transform 0.25s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 14px 32px rgba(150,112,91,0.18)'; e.currentTarget.style.transform = 'translateY(-3px)' }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}
              >
                <button
                  type="button"
                  onClick={() => openModal({ craftId: craft.id })}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    textAlign: 'left',
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
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
                    {craft.popular && (
                      <span style={{ position: 'absolute', bottom: '0.75rem', left: '0.75rem', background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))', color: '#fff', borderRadius: '2rem', padding: '0.3rem 0.75rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.02em', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
                        ♥ Most popular
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', padding: '1rem 1.125rem 1.25rem', boxSizing: 'border-box' }}>
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
                {/* Share — party planning is a group-chat activity */}
                <button
                  type="button"
                  onClick={() => shareCraft(craft)}
                  aria-label={`Share ${craft.name}`}
                  title="Share with your group"
                  style={{
                    position: 'absolute',
                    top: '0.75rem',
                    left: '0.75rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    background: 'rgba(255,255,255,0.94)',
                    border: 'none',
                    borderRadius: '2rem',
                    padding: '0.28rem 0.65rem',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    color: 'var(--color-dark)',
                    boxShadow: '0 1px 5px rgba(0,0,0,0.12)',
                    cursor: 'pointer',
                  }}
                >
                  {sharedCraftId === craft.id ? '✓ Copied!' : '↗ Share'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next open dates — real availability as gentle urgency */}
      {nextDates.length > 0 && (
        <div id="open-dates" style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.4rem' }}>
            Next Open Dates
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0 0 1.25rem' }}>
            Parties run on weekends — {nextDates.length} date{nextDates.length === 1 ? '' : 's'} open in the
            next {partyConfig.bookingWindowDays} days.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center' }}>
            {nextDates.slice(0, 6).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => openModal({ date: d })}
                style={{
                  padding: '0.6rem 1rem',
                  borderRadius: '2rem',
                  border: '1px solid rgba(150, 112, 91, 0.2)',
                  background: 'rgba(255, 255, 255, 0.85)',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: 'var(--color-dark)',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease, border-color 0.2s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.background = 'rgba(150, 112, 91, 0.08)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(150, 112, 91, 0.2)'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.85)' }}
              >
                {formatDateLabel(d)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Secondary CTA — primary path is picking a craft above */}
      <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
        <button
          onClick={() => openModal()}
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

      {/* Value band — the deposit reframed as what it buys */}
      <div style={{ maxWidth: '34rem', margin: '0 auto 3.5rem', textAlign: 'center', padding: '2rem', borderRadius: '1rem', background: 'rgba(34, 197, 94, 0.06)', border: '1px solid rgba(34, 197, 94, 0.15)' }}>
        <h3 style={{ fontSize: '1.125rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.5rem' }}>
          The Whole Studio Is Yours
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6, margin: 0 }}>
          {partyContent.deposit.holdLine} For a party of {partyContent.deposit.perPersonExample.guests},
          that&rsquo;s about ${PER_PERSON_EXAMPLE} a person for a completely private studio.
          {' '}{partyContent.deposit.noShowLine}
        </p>
      </div>

      {/* How it works */}
      <div style={{ maxWidth: '32rem', margin: '0 auto' }}>
        <h2 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', textAlign: 'center', marginBottom: '1.5rem' }}>
          How It Works
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[
            { step: '1', text: 'Pick your craft and a date' },
            { step: '2', text: 'Tell us roughly how many guests' },
            { step: '3', text: 'Pay the $200 studio fee — the date is yours' },
            { step: '4', text: 'Guests pay for crafts at the studio, based on who comes' },
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

      {/* Sticky mobile CTA — the action survives scrolling through crafts */}
      {isMobile && !modalOpen && (
        <div style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 90,
          padding: '0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0px))',
          background: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: '1px solid rgba(150, 112, 91, 0.12)',
          boxShadow: '0 -6px 24px rgba(150, 112, 91, 0.10)',
        }}>
          <button
            type="button"
            onClick={() => openModal()}
            style={{
              width: '100%',
              padding: '0.875rem',
              background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
              color: '#fff',
              border: 'none',
              borderRadius: '0.75rem',
              fontSize: '0.9375rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(150, 112, 91, 0.2)',
            }}
          >
            Book your date — $200 holds it
          </button>
        </div>
      )}

      {modalOpen && (
        <PartyModal
          onClose={closeModal}
          initialStart={initialStart}
          initialCraftId={initialCraftId}
          initialDate={initialDate}
        />
      )}
    </div>
  )
}
