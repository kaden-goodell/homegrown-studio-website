import { useEffect, useState } from 'react'
import StaffHeader from '@components/staff/StaffHeader'
import { type HouseholdMatch } from '@components/staff/DoorSearch'
import { cafeRunsOn } from '@lib/cafe-days'
import EventList from '@components/staff/EventList'
import WarningsPanel from '@components/staff/WarningsPanel'
import { studioDate } from '@lib/studio-time'
import type { StaffMember } from '@lib/staff-auth'
import type { EventKind } from '@lib/events'

/**
 * The staff landing screen: warnings, the Craft Café headcount on café days,
 * and today's events — today only (Upcoming looks ahead). Checking people
 * in is the floating ✓ Check in button, which always works on today.
 */
export default function Today({
  staff,
  onOpenRoster,
}: {
  staff: StaffMember
  onOpenRoster: (e: { kind: EventKind; id: string; title: string; addFamily?: { household?: HouseholdMatch } }) => void
}) {
  const today = studioDate(new Date().toISOString())
  const [openStudioCount, setOpenStudioCount] = useState<number | null>(null)
  async function loadOpenStudioCount() {
    try {
      const res = await fetch(`/api/staff/open-studio.json?date=${today}`, { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      setOpenStudioCount(json.data.count)
    } catch {
      // Silent — this is a header nicety, not a blocking error.
    }
  }

  // Refreshes each minute so check-ins from the floating sheet show up.
  useEffect(() => {
    loadOpenStudioCount()
    const t = setInterval(loadOpenStudioCount, 60_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div>
      <StaffHeader title="Today" staff={staff} onOpenRoster={onOpenRoster} />

      {cafeRunsOn(today) && openStudioCount !== null && (
        <p style={{ fontSize: '0.95rem', color: 'var(--color-dark)', margin: '0 0 1rem', fontWeight: 600 }}>
          ☕ {openStudioCount} here now at Craft Café
        </p>
      )}

      <WarningsPanel onOpenEvent={(e) => onOpenRoster(e)} />

      <EventList date={today} stepper={false} onOpenRoster={onOpenRoster} />
    </div>
  )
}
