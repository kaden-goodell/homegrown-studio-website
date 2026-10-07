import { useState, useEffect, useRef, useCallback } from 'react'
import NotifyMe from '@components/shared/NotifyMe'
import { jsonLdString, workshopEventsJsonLd } from '@lib/seo'
import { SITE_URL } from '@config/site-url'
import WorkshopCard from './WorkshopCard'
import WorkshopBookingModal from './WorkshopBookingModal'
import { canBeBooked, isSoldOut } from '@lib/workshop-rules'
import { byStart } from './workshop-view-model'
import type { SeatOption } from '@lib/seat-options'

export interface WorkshopData {
  id: string
  name: string
  description: string
  category: string
  imageUrl?: string
  flyerUrl?: string
  date: string
  startTime: string
  endTime: string
  duration: number
  price: number
  currency: string
  /** No price yet: shown as "Coming soon", cannot be booked. */
  comingSoon?: boolean
  remainingSeats: number | null
  classScheduleId?: string
  classScheduleInstanceId?: string
  teamMemberId?: string
  /** Per-seat questions; empty or absent when the class asks none. */
  options?: SeatOption[]
  /** When sign-ups close (ISO). */
  signupClosesAt?: string
  /** Decided on the server, so a visitor's clock doesn't matter. */
  signupClosed?: boolean
}

const STUDIO_TZ = 'America/Chicago'
/** Where workshops happen. Kept here (not read from site.config) because this
 *  file ships to the browser and site.config must not. */
const STUDIO = {
  name: 'Hometown Studio',
  url: SITE_URL,
  address: { street: '525 Hughes Rd, Suite F', city: 'Madison', state: 'AL', zip: '35758' },
}

export interface WorkshopExplorerProps {
  /** Optional initial list (e.g. SSR). If empty, the component fetches client-side. */
  workshops?: WorkshopData[]
}

const GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))', gap: '1.5rem' } as const

/** Where a card sits on the page, so a link to a sold-out workshop can bring it into view. */
const cardAnchor = (id: string) => `workshop-card-${id}`

function Bar({ width, height, strong = false, marginTop = 0 }: { width: string; height: string; strong?: boolean; marginTop?: string | number }) {
  return (
    <div
      className="animate-pulse"
      style={{
        width,
        height,
        marginTop,
        borderRadius: '0.25rem',
        background: `rgba(var(--color-primary-rgb), ${strong ? 0.12 : 0.08})`,
      }}
    />
  )
}

/**
 * Placeholder cards shown while workshops load, so navigation feels instant.
 * Same shape as WorkshopCard (4:3 photo, title, four lines of description,
 * take-home line, price row, button), so the page does not jump when the
 * real cards arrive.
 */
function WorkshopSkeleton() {
  return (
    <div style={GRID} aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            borderRadius: '1rem',
            overflow: 'hidden',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-line)',
          }}
        >
          <div className="animate-pulse" style={{ aspectRatio: '4 / 3', background: 'rgba(var(--color-primary-rgb), 0.08)' }} />
          <div style={{ padding: '1.25rem' }}>
            <Bar width="60%" height="1.25rem" strong />
            {/* Description: four lines of 0.9375rem text at 1.5 line height. */}
            <div style={{ height: '5.625rem', marginTop: '0.5rem', paddingTop: '0.3rem' }}>
              <Bar width="100%" height="0.75rem" />
              <Bar width="95%" height="0.75rem" marginTop="0.65rem" />
              <Bar width="70%" height="0.75rem" marginTop="0.65rem" />
            </div>
            {/* Take-home line: two lines of 0.8125rem text at 1.4 line height. */}
            <div style={{ height: '2.275rem', marginTop: '0.75rem', paddingTop: '0.25rem' }}>
              <Bar width="80%" height="0.6875rem" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '1.75rem', marginTop: '1rem', marginBottom: '0.875rem' }}>
              <Bar width="40%" height="1rem" strong />
              <Bar width="25%" height="0.875rem" />
            </div>
            <Bar width="100%" height="3rem" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function WorkshopExplorer({ workshops: initialWorkshops = [] }: WorkshopExplorerProps) {
  const [workshops, setWorkshops] = useState<WorkshopData[]>(initialWorkshops)
  const [loading, setLoading] = useState(initialWorkshops.length === 0)
  // The lookup failed. Never shown as "no workshops": that would be a guess.
  const [failed, setFailed] = useState(false)
  const [bookingWorkshop, setBookingWorkshop] = useState<WorkshopData | null>(null)
  // What a link to one workshop (?w=<id>) led to, when it was not a booking panel.
  const [notice, setNotice] = useState('')
  const linkFollowed = useRef(false)
  const mounted = useRef(true)

  const load = useCallback(() => {
    setLoading(true)
    setFailed(false)
    fetch('/api/workshops.json')
      .then((res) => {
        if (!res.ok) throw new Error(`workshops fetch failed: ${res.status}`)
        return res.json()
      })
      .then((data: { workshops?: WorkshopData[]; incomplete?: boolean }) => {
        const list = Array.isArray(data?.workshops) ? data.workshops : []
        // `incomplete` means Square could not be asked: an empty list then says nothing.
        if (data?.incomplete && list.length === 0) throw new Error('workshops lookup incomplete')
        if (mounted.current) setWorkshops(list)
      })
      .catch(() => {
        if (mounted.current) setFailed(true)
      })
      .finally(() => {
        if (mounted.current) setLoading(false)
      })
  }, [])

  // Fetch workshops client-side so the page shell renders immediately instead of
  // blocking navigation on the Square Classes API. Skipped if SSR provided them.
  useEffect(() => {
    mounted.current = true
    if (initialWorkshops.length === 0) load()
    return () => {
      mounted.current = false
    }
  }, [])

  // A link to one workshop, /workshops?w=<workshopId>, is followed once, after
  // the list has loaded. Client-only — guards SSR.
  useEffect(() => {
    if (typeof window === 'undefined' || loading || failed || linkFollowed.current) return
    const id = new URLSearchParams(window.location.search).get('w')
    if (!id) return
    linkFollowed.current = true

    const target = workshops.find((w) => w.id === id)
    if (!target) {
      setNotice(
        workshops.length > 0
          ? 'That workshop has finished or is no longer listed. Here’s what’s coming up.'
          : 'That workshop has finished or is no longer listed.',
      )
      return
    }
    // Not for sale yet: the list, with its "Coming soon" card. No booking panel.
    if (!canBeBooked(target.price)) return
    // Past its sign-up cutoff: say so, and no booking panel.
    if (target.signupClosed) {
      setNotice(`Sign-ups for ${target.name} have closed.`)
      return
    }
    if (isSoldOut(target.remainingSeats)) {
      setNotice(`${target.name} is sold out. Leave your email on its card and we’ll tell you if a seat opens.`)
      // Not every browser can do this; the notice alone still says what to do.
      document.getElementById(cardAnchor(target.id))?.scrollIntoView?.({ block: 'center' })
      return
    }
    setBookingWorkshop(target)
  }, [workshops, loading, failed])

  const sorted = [...workshops].sort(byStart)

  // Google is told about every workshop with a price, sold out or not (a
  // sold-out one is reported as sold out). A class with no price yet is left
  // out: it would otherwise be listed as a free event.
  const forSale = sorted.filter((w) => canBeBooked(w.price))

  return (
    <div>
      {notice && !loading && !(failed && sorted.length === 0) && (
        <p
          role="status"
          style={{
            margin: '0 0 1.5rem',
            padding: '1rem 1.25rem',
            borderRadius: '0.75rem',
            background: 'var(--tone-workshop-soft)',
            border: '1px solid var(--color-line)',
            color: 'var(--color-dark)',
            fontSize: '0.9375rem',
            fontWeight: 500,
          }}
        >
          {notice}
        </p>
      )}

      {loading ? (
        <WorkshopSkeleton />
      ) : failed && sorted.length === 0 ? (
        <div role="alert" className="glass" style={{ borderRadius: '1rem', padding: '3rem 2rem', textAlign: 'center' }}>
          <p className="font-heading" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-dark)' }}>
            We couldn&rsquo;t load workshops just now.
          </p>
          <p style={{ margin: '1.5rem 0 0' }}>
            <button type="button" className="btn btn-secondary" onClick={load}>
              Try again
            </button>
          </p>
          <p style={{ marginTop: '1.5rem', fontSize: '0.875rem', display: 'flex', justifyContent: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
            <a href="/calendar" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>See the calendar</a>
            <a href="/book" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>Book a party</a>
          </p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="glass" style={{ borderRadius: '1rem', padding: '3rem 2rem', textAlign: 'center' }}>
          <p className="font-heading" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-dark)' }}>
            New workshops are on the way
          </p>
          <p style={{ margin: '0.5rem 0 1.5rem', fontSize: '0.9375rem', color: 'var(--color-muted)' }}>
            Leave your email and we&rsquo;ll tell you when the next ones are posted.
          </p>
          <NotifyMe
            interest="workshops:new-dates"
            buttonLabel="Tell me when they’re posted"
            note="One email when new workshops go up. Nothing else."
            successText="Got it. We’ll email you when new workshops are posted."
          />
          <p style={{ marginTop: '1.5rem', fontSize: '0.875rem' }}>
            <a href="/calendar" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>See the calendar</a>
          </p>
        </div>
      ) : (
        <div style={GRID}>
          {sorted.map((w) => (
            <div key={w.id} id={cardAnchor(w.id)} style={{ display: 'flex' }}>
              <WorkshopCard workshop={w} onBook={setBookingWorkshop} />
            </div>
          ))}
        </div>
      )}

      {/* The same workshops, described for search engines. Only what is on the page. */}
      {forSale.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(workshopEventsJsonLd(forSale, STUDIO, STUDIO_TZ)) }}
        />
      )}

      {bookingWorkshop && (
        <WorkshopBookingModal
          workshop={bookingWorkshop}
          onClose={() => setBookingWorkshop(null)}
          // Seats were just sold. Take them off the count here rather than ask
          // again: the list is cached for a minute and would still show the old number.
          onBooked={(seats) =>
            setWorkshops((list) =>
              list.map((w) =>
                w.id === bookingWorkshop.id && w.remainingSeats !== null
                  ? { ...w, remainingSeats: Math.max(0, w.remainingSeats - seats) }
                  : w,
              ),
            )
          }
        />
      )}
    </div>
  )
}
