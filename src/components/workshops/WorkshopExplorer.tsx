import { useState, useEffect } from 'react'
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
            border: '1px solid rgba(150, 112, 91, 0.08)',
          }}
        >
          <div className="animate-pulse" style={{ height: '10rem', background: 'rgba(150, 112, 91, 0.08)' }} />
          <div style={{ padding: '1rem' }}>
            <div className="animate-pulse" style={{ height: '1rem', width: '70%', background: 'rgba(150, 112, 91, 0.12)', borderRadius: '0.25rem', marginBottom: '0.6rem' }} />
            <div className="animate-pulse" style={{ height: '0.75rem', width: '40%', background: 'rgba(150, 112, 91, 0.08)', borderRadius: '0.25rem' }} />
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
          <p style={{ marginTop: '0.5rem', fontSize: '0.9375rem', color: 'var(--color-muted)' }}>
            Join the newsletter and you&rsquo;ll hear about them first — or{' '}
            <a href="/calendar" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>see what else is on</a>.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))', gap: '1.5rem' }}>
          {sorted.map((w) => (
            <WorkshopCard key={w.id} workshop={w} onBook={setBookingWorkshop} />
          ))}
        </div>
      )}

      {bookingWorkshop && (
        <WorkshopBookingModal workshop={bookingWorkshop} onClose={() => setBookingWorkshop(null)} />
      )}
    </div>
  )
}
