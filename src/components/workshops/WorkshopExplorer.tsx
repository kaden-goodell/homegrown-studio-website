import { useState, useEffect } from 'react'
import SearchView from './SearchView'
import CalendarView from './CalendarView'
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

type View = 'search' | 'calendar'

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
  const [view, setView] = useState<View>('search')
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

  return (
    <div>
      <div className="flex gap-2 mb-8">
          {(['search', 'calendar'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300"
              style={
                view === v
                  ? {
                      background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                      color: 'white',
                      boxShadow: '0 4px 15px rgba(150, 112, 91, 0.2)',
                    }
                  : {
                      background: 'rgba(255, 255, 255, 0.75)',
                      backdropFilter: 'blur(12px)',
                      border: '1px solid rgba(150, 112, 91, 0.06)',
                      color: 'var(--color-text)',
                    }
              }
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
      </div>

      {loading ? (
        <WorkshopSkeleton />
      ) : view === 'search' ? (
        <SearchView workshops={workshops} onBook={setBookingWorkshop} />
      ) : (
        <CalendarView workshops={workshops} onBook={setBookingWorkshop} />
      )}

      {bookingWorkshop && (
        <WorkshopBookingModal
          workshop={bookingWorkshop}
          onClose={() => setBookingWorkshop(null)}
        />
      )}
    </div>
  )
}
