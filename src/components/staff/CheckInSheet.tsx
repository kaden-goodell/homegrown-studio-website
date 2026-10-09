import { useEffect, useState } from 'react'
import type { HouseholdMatch, TodayEvent } from '@components/staff/DoorSearch'
import CheckInFlow from '@components/staff/CheckInFlow'
import { cafeRunsOn } from '@lib/cafe-days'
import { btn } from '@components/staff/ui'
import { studioDate } from '@lib/studio-time'

/**
 * The floating "Check in" sheet, reachable from every staff screen: what
 * are they here for, then find the family (or hand the iPad to a new one). A class roster opens its own "+ Add
 * family" sheet instead, already pointed at that class.
 */
export default function CheckInSheet({
  onOpenRoster,
  onClose,
}: {
  /** Open an event's roster with this family ready to add. Without it, the page navigates there. */
  onOpenRoster?: (e: { kind: TodayEvent['kind']; id: string; title: string; addFamily?: { household?: HouseholdMatch } }) => void
  onClose: () => void
}) {
  const today = studioDate(new Date().toISOString())
  const [todayEvents, setTodayEvents] = useState<TodayEvent[] | null>(null)
  useEffect(() => {
    fetch(`/api/staff/events.json?date=${today}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const events = json?.data?.events
        setTodayEvents(Array.isArray(events) ? events.map((e: any) => ({ kind: e.kind, id: e.id, title: e.title, startIso: e.startIso, rsvpWaiverIds: e.rsvpWaiverIds })) : [])
      })
      .catch(() => setTodayEvents([]))
  }, [])

  function openRoster(e: { kind: TodayEvent['kind']; id: string; title: string; addFamily?: { household?: HouseholdMatch } }) {
    if (onOpenRoster) { onClose(); onOpenRoster(e); return }
    location.assign(`/staff?open=${e.kind}:${encodeURIComponent(e.id)}`)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Check in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', justifyContent: 'flex-end', background: 'rgba(0, 0, 0, 0.4)' }}
    >
      <div style={{
        width: '100%', maxWidth: '30rem', height: '100vh', overflowY: 'auto', padding: '1.25rem 1.25rem 2rem', boxSizing: 'border-box',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(255,255,255,0.96) 100%)', boxShadow: '-12px 0 40px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.9rem' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>Check in</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...btn(), padding: '0.35rem 0.6rem' }}>✕</button>
        </div>
        <CheckInFlow todayEvents={todayEvents} cafeOpen={cafeRunsOn(today)} onOpenRoster={openRoster} />
      </div>
    </div>
  )
}
