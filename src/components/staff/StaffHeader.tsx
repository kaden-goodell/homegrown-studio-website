import { useState, type CSSProperties } from 'react'
import IncidentSheet from '@components/staff/IncidentSheet'
import CheckInSheet from '@components/staff/CheckInSheet'
import type { HouseholdMatch } from '@components/staff/DoorSearch'
import type { EventKind } from '@lib/events'
import type { Household } from '@components/staff/HouseholdCard'
import type { StudioEvent } from '@lib/events'

export interface StaffHeaderMember {
  name: string
}

const btn = (primary = false): CSSProperties => ({
  padding: '0.55rem 0.9rem',
  borderRadius: '0.625rem',
  border: primary ? 'none' : '1px solid rgba(var(--color-primary-rgb),0.3)',
  background: primary ? 'var(--color-primary)' : 'transparent',
  color: primary ? '#fff' : 'var(--color-dark)',
  fontSize: '0.8125rem',
  fontWeight: 600,
  cursor: 'pointer',
})

/** Shared top bar for every signed-in staff screen: which screen, who's
 *  signed in, and the always-available nav (Switch identity, Incident, Kits,
 *  Log out). The 🚑 Incident sheet is self-contained here (HOM-215) so every
 *  screen gets it for free — `event`/`households`/`day` let a roster screen
 *  hand it real context; Today and Kits leave them unset ("Craft Café"). */
export default function StaffHeader({
  title,
  staff,
  onSwitch,
  onKits,
  onGiftCards,
  onLogout,
  event,
  households,
  day,
  onCheckIn,
  onOpenRoster,
}: {
  title: string
  staff: StaffHeaderMember
  onSwitch: () => void
  onKits: () => void
  onGiftCards: () => void
  onLogout: () => void
  event?: StudioEvent | null
  households?: Household[]
  day?: string
  /** A roster opens its own "+ Add family" (pointed at that event); every other screen gets the general Check in sheet. */
  onCheckIn?: () => void
  onOpenRoster?: (e: { kind: EventKind; id: string; title: string; addFamily?: { household?: HouseholdMatch } }) => void
}) {
  const [incidentOpen, setIncidentOpen] = useState(false)
  const [checkInOpen, setCheckInOpen] = useState(false)

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', margin: 0 }}>
          {title} <span style={{ fontWeight: 400, fontSize: '0.875rem', color: 'var(--color-muted)' }}>· {staff.name}</span>
        </h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={onSwitch} style={btn()}>Switch</button>
          <button type="button" onClick={() => setIncidentOpen(true)} style={btn()}>
            🚑 Incident
          </button>
          <button type="button" onClick={onKits} style={btn()}>Kits</button>
          <button type="button" onClick={onGiftCards} style={btn()}>Gift cards</button>
          <button type="button" onClick={onLogout} style={btn()}>Log out</button>
        </div>
      </div>

      {/* Always there, bottom-right, on every signed-in screen. */}
      <button
        type="button"
        onClick={() => (onCheckIn ? onCheckIn() : setCheckInOpen(true))}
        aria-label="Check in a family"
        style={{
          position: 'fixed', right: '1rem', bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))', zIndex: 120,
          padding: '0.9rem 1.3rem', minHeight: '3.25rem', borderRadius: '999px', border: 'none',
          background: 'var(--color-primary)', color: '#fff', fontSize: '1rem', fontWeight: 700,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)', cursor: 'pointer',
        }}
      >
        ✓ Check in
      </button>
      {checkInOpen && <CheckInSheet onOpenRoster={onOpenRoster} onClose={() => setCheckInOpen(false)} />}

      {incidentOpen && (
        <IncidentSheet
          staff={staff}
          event={event ?? null}
          day={day}
          households={households ?? []}
          onClose={() => setIncidentOpen(false)}
        />
      )}
    </>
  )
}
