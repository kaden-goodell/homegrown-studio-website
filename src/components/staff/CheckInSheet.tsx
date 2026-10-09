import { useEffect, useState } from 'react'
import DoorSearch, { signOnIpad, type HouseholdMatch, type TodayEvent } from '@components/staff/DoorSearch'
import { btn } from '@components/staff/ui'
import { studioDate } from '@lib/studio-time'

/**
 * The floating "Check in" sheet, reachable from every staff screen: find a
 * family and mark them here (Craft Café, or one of today's events), or hand
 * the iPad to a new family to sign. A class roster opens its own "+ Add
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
  const [todayEvents, setTodayEvents] = useState<TodayEvent[]>([])
  useEffect(() => {
    const today = studioDate(new Date().toISOString())
    fetch(`/api/staff/events.json?date=${today}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const events = json?.data?.events
        if (Array.isArray(events)) setTodayEvents(events.map((e: any) => ({ kind: e.kind, id: e.id, title: e.title, startIso: e.startIso, rsvpWaiverIds: e.rsvpWaiverIds })))
      })
      .catch(() => {})
  }, [])

  function addToEvent(e: TodayEvent, household: HouseholdMatch) {
    if (onOpenRoster) { onClose(); onOpenRoster({ kind: e.kind, id: e.id, title: e.title, addFamily: { household } }); return }
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
        <NewFamilyButton />
        <DoorSearch todayEvents={todayEvents} onAddToEvent={addToEvent} />
      </div>
    </div>
  )
}

/** Always-visible way to start the signing form, before any searching. */
export function NewFamilyButton({ event }: { event?: Parameters<typeof signOnIpad>[0] }) {
  return (
    <button
      type="button"
      onClick={() => signOnIpad(event)}
      style={{ ...btn(), width: '100%', minHeight: '2.75rem', marginBottom: '1rem', fontWeight: 700 }}
    >
      ✍️ New family? Sign on this iPad
    </button>
  )
}
