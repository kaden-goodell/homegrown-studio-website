import { useState, useEffect, useRef, type CSSProperties } from 'react'
import PartyModal from './PartyModal'
import NotifyMe from '@components/shared/NotifyMe'
import { partyConfig } from '@config/party.config'
import { partyContent } from '@config/party-content'
import { craftShareUrl } from '@lib/party-share'
import { formatMoney } from '@lib/money'
import { trackViewItemList, trackSelectItem, trackShare, trackCtaClick, type AnalyticsItem } from '@lib/analytics'

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

interface ServiceInfo {
  crafts: Craft[]
  variationId: string | null
}

function perPersonLabel(minCents: number, maxCents?: number): string {
  return maxCents && maxCents > minCents ? `${formatMoney(minCents)}–${formatMoney(maxCents)}` : formatMoney(minCents)
}

/** "Sat, Aug 15" from a local YYYY-MM-DD string (built locally to avoid a UTC day shift). */
function formatDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** The cheapest craft on the list, or null while there is no list to read. */
export function lowestCraftCents(crafts: Pick<Craft, 'perHeadCents'>[]): number | null {
  const prices = crafts.map((c) => c.perHeadCents).filter((cents) => Number.isFinite(cents) && cents > 0)
  return prices.length > 0 ? Math.min(...prices) : null
}

/**
 * The one sentence that says what a party costs. The fee comes from config and
 * the "from" price from the craft list; with no list, the sentence goes
 * without a craft price rather than show a wrong one.
 */
export function partyPriceLine(lowestCents: number | null): string {
  const fee = formatMoney(partyConfig.basePriceCents)
  return lowestCents === null
    ? `${fee} today holds your date. Crafts are paid at the studio for whoever comes.`
    : `${fee} today holds your date. Crafts from ${formatMoney(lowestCents)} a person, paid at the studio for whoever comes.`
}

/** The studio fee split across an example party: "$25 each", or "about $23 each" when it doesn't divide evenly. */
export function feeShareLine(
  feeCents: number = partyConfig.basePriceCents,
  guests: number = partyContent.deposit.perPersonExample.guests,
): string {
  const each = formatMoney(Math.round(feeCents / guests / 100) * 100)
  const exact = feeCents % (guests * 100) === 0
  return `For a party of ${guests}, the studio fee works out to ${exact ? '' : 'about '}${each} each, plus the craft you choose.`
}

/** Card descriptions: four lines at a fixed height, so every card is the same size. */
export const craftDescriptionStyle = {
  margin: '0.4rem 0 0',
  fontSize: '0.8125rem',
  lineHeight: 1.5,
  height: '6em', // 4 lines × 1.5
  color: 'var(--color-muted)',
  display: '-webkit-box',
  WebkitLineClamp: 4,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
} as const satisfies CSSProperties

const sectionHeadingStyle: CSSProperties = {
  fontSize: '1.75rem',
  fontFamily: 'var(--font-heading)',
  fontWeight: 600,
  color: 'var(--color-dark)',
  textAlign: 'center',
  marginBottom: '0.5rem',
}

/**
 * The craft list is asked for once and shared by everything on the page that
 * reads it (the gallery and each price line), then reused for a minute. A
 * failed request is not kept, so the next reader tries again.
 */
const SERVICE_INFO_TTL_MS = 60_000
let serviceInfoRequest: { at: number; promise: Promise<ServiceInfo | null> } | null = null

function loadServiceInfo(): Promise<ServiceInfo | null> {
  if (serviceInfoRequest && Date.now() - serviceInfoRequest.at < SERVICE_INFO_TTL_MS) {
    return serviceInfoRequest.promise
  }
  const promise = (async (): Promise<ServiceInfo | null> => {
    try {
      const res = await fetch('/api/party/service-info.json', { cache: 'no-store' })
      if (!res.ok) return null
      const json = await res.json()
      const data = json.data ?? json
      return { crafts: (data.crafts ?? []) as Craft[], variationId: data.variationId ?? null }
    } catch {
      return null
    }
  })()
  const entry = { at: Date.now(), promise }
  serviceInfoRequest = entry
  promise.then((info) => {
    if (!info && serviceInfoRequest === entry) serviceInfoRequest = null
  })
  return promise
}

/** Tests only: forget the shared craft list. */
export function resetServiceInfoCache(): void {
  serviceInfoRequest = null
}

type LoadStatus = 'loading' | 'ready' | 'error'

function useServiceInfo(): { info: ServiceInfo | null; status: LoadStatus } {
  const [state, setState] = useState<{ info: ServiceInfo | null; status: LoadStatus }>({ info: null, status: 'loading' })
  useEffect(() => {
    let cancelled = false
    loadServiceInfo().then((info) => {
      if (!cancelled) setState({ info, status: info ? 'ready' : 'error' })
    })
    return () => { cancelled = true }
  }, [])
  return state
}

/**
 * The price sentence as its own island, for the parts of /book that live in
 * book.astro (the hero and the closing section).
 */
export function PartyPriceLine() {
  const { info } = useServiceInfo()
  return (
    <p style={{ margin: '1rem auto 0', maxWidth: '34rem', fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.5, color: 'var(--color-dark)' }}>
      {partyPriceLine(lowestCraftCents(info?.crafts ?? []))}
    </p>
  )
}

export default function PartyLanding() {
  const { info, status: infoStatus } = useServiceInfo()
  const crafts = info?.crafts ?? []
  const variationId = info?.variationId ?? null
  // Gallery previews the first two desktop rows; the rest sit behind one tap so
  // a growing catalog never buries the open-dates section (the real converter).
  const CRAFT_PREVIEW_COUNT = 6
  const [showAllCrafts, setShowAllCrafts] = useState(false)
  const [nextDates, setNextDates] = useState<string[]>([])
  const [datesStatus, setDatesStatus] = useState<LoadStatus>('loading')
  const [modalOpen, setModalOpen] = useState(false)
  const [initialStart, setInitialStart] = useState<string | undefined>(undefined)
  const [initialCraftId, setInitialCraftId] = useState<string | undefined>(undefined)
  const [initialDate, setInitialDate] = useState<string | undefined>(undefined)
  const [sharedCraftId, setSharedCraftId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const modalOpenRef = useRef(false)
  modalOpenRef.current = modalOpen

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    setIsMobile(mq.matches)
    const handler = (ev: MediaQueryListEvent) => setIsMobile(ev.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Next open dates. Real availability, nothing invented: a failed request
  // says it failed, and only a real empty answer says "no open dates".
  useEffect(() => {
    if (infoStatus === 'loading') return
    if (!variationId) {
      setDatesStatus('error')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/party/available-dates.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serviceVariationId: variationId }),
        })
        if (cancelled) return
        if (!res.ok) return setDatesStatus('error')
        const json = await res.json()
        if (cancelled) return
        setNextDates(((json.data ?? json).dates ?? []) as string[])
        setDatesStatus('ready')
      } catch {
        if (!cancelled) setDatesStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [infoStatus, variationId])

  // Any element on the page marked data-open-booking opens the panel: the hero
  // and closing buttons in book.astro, and the site header's "Book a Party".
  // They are links to /book, so they still work before this script loads.
  // Listens in the capture phase so it runs before the page-transition
  // router's own click handler, which would otherwise reload /book.
  useEffect(() => {
    function onClick(ev: MouseEvent) {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return
      if (!rootRef.current?.isConnected) return
      const target = ev.target instanceof Element ? ev.target.closest('[data-open-booking]') : null
      if (!target) return
      ev.preventDefault()
      if (modalOpenRef.current) return
      setInitialCraftId(undefined)
      setInitialDate(undefined)
      setInitialStart(undefined)
      setModalOpen(true)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

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

  const craftItem = (c: Craft, i?: number): AnalyticsItem => ({
    item_id: c.id, item_name: c.name, item_category: 'party_craft', price: c.perHeadCents / 100, ...(i !== undefined ? { index: i } : {}),
  })
  // The craft gallery as a list: which crafts people see, then which they tap.
  const listSent = useRef(false)
  useEffect(() => {
    if (listSent.current || crafts.length === 0) return
    listSent.current = true
    trackViewItemList('party_crafts', crafts.map((c, i) => craftItem(c, i)))
  }, [crafts.length])

  function openModal(opts: { craftId?: string; date?: string } = {}) {
    const i = opts.craftId ? crafts.findIndex((c) => c.id === opts.craftId) : -1
    if (i >= 0) trackSelectItem('party_crafts', craftItem(crafts[i], i))
    else trackCtaClick(opts.date ? 'party_date_chip' : 'party_book_button', opts.date ?? 'party_landing')
    setInitialCraftId(opts.craftId)
    setInitialDate(opts.date)
    setInitialStart(undefined)
    setModalOpen(true)
  }

  async function shareCraft(craft: Craft) {
    trackShare('party_craft', typeof navigator.share === 'function' ? 'share_sheet' : 'copy_link', craft.id)
    const url = craftShareUrl(craft.id, window.location.origin)
    const text = `Look at this — we could make ${craft.name} at Hometown Studio!`
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
    <div ref={rootRef} style={{ paddingBottom: isMobile ? '4.5rem' : 0 }}>
      {/* Craft gallery — see what you'll make before you book */}
      {crafts.length > 0 && (
        <div style={{ marginBottom: '3.5rem' }}>
          <h2 style={sectionHeadingStyle}>
            Pick your craft
          </h2>
          <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-muted)', margin: '0 0 1.75rem' }}>
            Every guest makes one — you choose which. Tap share to send a favorite to your group.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))', gap: '1.5rem' }}>
            {(showAllCrafts ? crafts : crafts.slice(0, CRAFT_PREVIEW_COUNT)).map((craft) => (
              <div
                key={craft.id}
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: '1rem',
                  overflow: 'hidden',
                  border: '1px solid rgba(var(--color-primary-rgb), 0.15)',
                  background: 'rgba(255, 255, 255, 0.9)',
                  transition: 'box-shadow 0.25s ease, transform 0.25s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 14px 32px rgba(var(--color-primary-rgb),0.18)'; e.currentTarget.style.transform = 'translateY(-3px)' }}
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
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, rgba(var(--color-primary-rgb),0.10), rgba(198,167,142,0.20))' }}>
                    {craft.imageUrl ? (
                      <img src={craft.imageUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <span style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', fontWeight: 600, color: 'rgba(var(--color-primary-rgb),0.55)', textAlign: 'center', padding: '0 1rem' }}>{craft.name}</span>
                    )}
                    <span style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', background: 'rgba(255,255,255,0.94)', borderRadius: '2rem', padding: '0.28rem 0.7rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-dark)', boxShadow: '0 1px 5px rgba(0,0,0,0.12)' }}>
                      {perPersonLabel(craft.perHeadCents, craft.perHeadMaxCents)}/person
                    </span>
                    {craft.popular && (
                      <span style={{ position: 'absolute', bottom: '0.75rem', left: '0.75rem', background: 'var(--craft-marigold-soft)', color: 'var(--craft-marigold-ink)', borderRadius: '2rem', padding: '0.3rem 0.75rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.02em', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
                        Our pick
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', padding: '1rem 1.125rem 1.25rem', boxSizing: 'border-box' }}>
                    <span style={{ fontSize: '1.0625rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3, minHeight: '2.6em' }}>{craft.name}</span>
                    {/* Always rendered, so a craft with no description is still the same height */}
                    <p style={craftDescriptionStyle}>
                      {craft.description}
                    </p>
                    <span style={{ marginTop: 'auto', paddingTop: '0.85rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                      Book this craft
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
                  {sharedCraftId === craft.id ? 'Copied' : 'Share'}
                </button>
              </div>
            ))}
          </div>
          {!showAllCrafts && crafts.length > CRAFT_PREVIEW_COUNT && (
            <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => { trackCtaClick('show_all_crafts', 'party_landing'); setShowAllCrafts(true) }}>
                Show all {crafts.length} crafts
              </button>
            </div>
          )}
        </div>
      )}

      {/* Next open dates. Always on the page: the hero's "See open dates" link lands here. */}
      <section
        id="open-dates"
        aria-labelledby="open-dates-heading"
        // Clears the sticky header (4.5rem) and the returning-host banner under it.
        style={{ scrollMarginTop: '8rem', textAlign: 'center', marginBottom: '3.5rem' }}
      >
        <h2 id="open-dates-heading" style={sectionHeadingStyle}>
          Next open dates
        </h2>
        {datesStatus === 'loading' && (
          <p role="status" style={{ fontSize: '0.875rem', color: 'var(--color-muted)', margin: 0, minHeight: '5.5rem' }}>
            Checking open dates…
          </p>
        )}
        {datesStatus === 'ready' && nextDates.length > 0 && (
          <>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', margin: '0 0 1.25rem' }}>
              Parties run on weekends. {nextDates.length} date{nextDates.length === 1 ? '' : 's'} open in the
              next {partyConfig.bookingWindowDays} days.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center' }}>
              {nextDates.slice(0, 6).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => openModal({ date: d })}
                  style={{
                    minHeight: '2.75rem',
                    padding: '0.6rem 1rem',
                    borderRadius: '2rem',
                    border: '1px solid rgba(var(--color-primary-rgb), 0.2)',
                    background: 'rgba(255, 255, 255, 0.85)',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    color: 'var(--color-dark)',
                    cursor: 'pointer',
                    transition: 'background 0.2s ease, border-color 0.2s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.background = 'rgba(var(--color-primary-rgb), 0.08)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(var(--color-primary-rgb), 0.2)'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.85)' }}
                >
                  {formatDateLabel(d)}
                </button>
              ))}
            </div>
          </>
        )}
        {datesStatus === 'ready' && nextDates.length === 0 && (
          <div className="tone-party">
            <p style={{ fontSize: '0.9375rem', color: 'var(--color-text)', margin: '0 auto 1.25rem', maxWidth: '30rem' }}>
              No open dates in the next {partyConfig.bookingWindowDays} days. Leave your email and we’ll tell you when more open.
            </p>
            <NotifyMe
              interest="party:more-dates"
              buttonLabel="Tell me when dates open"
              successText="Got it. We’ll email you when more party dates open."
            />
          </div>
        )}
        {datesStatus === 'error' && (
          <p style={{ fontSize: '0.9375rem', color: 'var(--color-text)', margin: '0 auto', maxWidth: '30rem' }}>
            We couldn’t load the open dates. You can still choose your date when you book, or text us
            at {partyContent.textNumber}.
          </p>
        )}
      </section>

      {/* Value band — the deposit reframed as what it buys */}
      <div style={{ maxWidth: '34rem', margin: '0 auto 3.5rem', textAlign: 'center', padding: '2rem', borderRadius: '1rem', background: 'var(--tone-party-soft)', border: '1px solid color-mix(in srgb, var(--tone-party) 25%, transparent)' }}>
        <h3 style={{ fontSize: '1.125rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.5rem' }}>
          The whole studio is yours
        </h3>
        <p style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-dark)', lineHeight: 1.6, margin: '0 0 0.5rem' }}>
          {partyContent.deposit.positioningLine}
        </p>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6, margin: 0 }}>
          {partyContent.deposit.holdLine} {feeShareLine()} {partyContent.deposit.noShowLine}
        </p>
      </div>

      {/* How it works */}
      <div style={{ maxWidth: '32rem', margin: '0 auto' }}>
        <h2 style={{ ...sectionHeadingStyle, fontSize: '1.5rem', marginBottom: '1.5rem' }}>
          How it works
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[
            { step: '1', text: 'Pick your craft and a date' },
            { step: '2', text: 'Tell us roughly how many guests' },
            { step: '3', text: `Pay the ${formatMoney(partyConfig.basePriceCents)} studio fee — the date is yours` },
            { step: '4', text: 'Guests pay for crafts at the studio, based on who comes' },
          ].map(({ step, text }) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 1.25rem', borderRadius: '0.75rem', background: 'rgba(255, 255, 255, 0.6)', border: '1px solid rgba(var(--color-primary-rgb), 0.08)' }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'rgba(var(--color-primary-rgb), 0.12)', color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.8125rem', flexShrink: 0 }}>
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
          borderTop: '1px solid rgba(var(--color-primary-rgb), 0.12)',
          boxShadow: '0 -6px 24px rgba(var(--color-primary-rgb), 0.10)',
        }}>
          <button type="button" className="btn btn-primary" onClick={() => openModal()} style={{ width: '100%' }}>
            {`Book your date — ${formatMoney(partyConfig.basePriceCents)} holds it`}
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
