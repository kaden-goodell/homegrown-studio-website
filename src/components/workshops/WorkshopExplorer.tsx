import { useState, useEffect } from 'react'
import NotifyMe from '@components/shared/NotifyMe'
import { jsonLdString, workshopEventsJsonLd } from '@lib/seo'
import { SITE_URL } from '@config/site-url'
import WorkshopCard from './WorkshopCard'
import WorkshopBookingModal from './WorkshopBookingModal'

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
  remainingSeats: number | null
  classScheduleId?: string
  classScheduleInstanceId?: string
  teamMemberId?: string
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

/** Placeholder cards shown while workshops load, so navigation feels instant. */
function WorkshopSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))', gap: '1.5rem' }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            borderRadius: '1rem',
            overflow: 'hidden',
            background: 'rgba(255, 255, 255, 0.6)',
            border: '1px solid rgba(var(--color-primary-rgb), 0.08)',
          }}
        >
          <div className="animate-pulse" style={{ height: '10rem', background: 'rgba(var(--color-primary-rgb), 0.08)' }} />
          <div style={{ padding: '1rem' }}>
            <div className="animate-pulse" style={{ height: '1rem', width: '70%', background: 'rgba(var(--color-primary-rgb), 0.12)', borderRadius: '0.25rem', marginBottom: '0.6rem' }} />
            <div className="animate-pulse" style={{ height: '0.75rem', width: '40%', background: 'rgba(var(--color-primary-rgb), 0.08)', borderRadius: '0.25rem' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function WorkshopExplorer({ workshops: initialWorkshops = [] }: WorkshopExplorerProps) {
  const [workshops, setWorkshops] = useState<WorkshopData[]>(initialWorkshops)
  const [loading, setLoading] = useState(initialWorkshops.length === 0)
  const [bookingWorkshop, setBookingWorkshop] = useState<WorkshopData | null>(null)

  // Fetch workshops client-side so the page shell renders immediately instead of
  // blocking navigation on the Square Classes API. Skipped if SSR provided them.
  useEffect(() => {
    if (initialWorkshops.length > 0) return
    let cancelled = false
    setLoading(true)
    fetch('/api/workshops.json')
      .then((res) => {
        if (!res.ok) throw new Error(`workshops fetch failed: ${res.status}`)
        return res.json()
      })
      .then((data: { workshops?: WorkshopData[] }) => {
        if (!cancelled) setWorkshops(Array.isArray(data?.workshops) ? data.workshops : [])
      })
      .catch(() => {
        // Keep whatever we have; the list just stays empty.
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Deeplink support: /workshops?w=<workshopId> auto-opens that workshop's
  // booking modal once the list is loaded. Client-only — guards SSR.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const id = new URLSearchParams(window.location.search).get('w')
    if (!id) return
    const target = workshops.find((w) => w.id === id)
    if (target) setBookingWorkshop(target)
  }, [workshops])

  const sorted = [...workshops].sort(
    (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
  )

  return (
    <div>
      {loading ? (
        <WorkshopSkeleton />
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))', gap: '1.5rem' }}>
          {sorted.map((w) => (
            <WorkshopCard key={w.id} workshop={w} onBook={setBookingWorkshop} />
          ))}
        </div>
      )}

      {/* The same workshops, described for search engines. Only what is on the page. */}
      {sorted.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(workshopEventsJsonLd(sorted, STUDIO, STUDIO_TZ)) }}
        />
      )}

      {bookingWorkshop && (
        <WorkshopBookingModal workshop={bookingWorkshop} onClose={() => setBookingWorkshop(null)} />
      )}
    </div>
  )
}
