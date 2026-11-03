import { useEffect, useState } from 'react'
import StaffHeader from '@components/staff/StaffHeader'
import { type HouseholdMatch } from '@components/staff/DoorSearch'
import EventList from '@components/staff/EventList'
import { cafeOn } from '@lib/cafe-days'
import { CafeRow, CraftCafeSheet } from '@components/staff/CraftCafe'
import WarningsPanel from '@components/staff/WarningsPanel'
import { studioDate } from '@lib/studio-time'
import type { StaffMember } from '@lib/staff-auth'
import type { EventKind } from '@lib/events'

/**
 * Today: warnings, the Craft Café row on café days (tap it for who's here),
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
  /** Craft Café hours today, or null when it doesn't run: the server's answer (the owners' hours and closed days). */
  const [cafeToday, setCafeToday] = useState<{ opens: string; closes: string } | null | undefined>(undefined)
  const [cafeSheet, setCafeSheet] = useState(false)
  async function loadOpenStudioCount() {
    try {
      const res = await fetch(`/api/staff/open-studio.json?date=${today}`, { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      setOpenStudioCount(json.data.count)
      if ('hours' in json.data) setCafeToday(json.data.hours ?? null)
      else if ('cafe' in json.data && !json.data.cafe) setCafeToday(null)
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

      {(() => {
        const hours = cafeToday === undefined ? cafeOn(today) : cafeToday
        return hours ? <CafeRow date={today} hours={hours} here={openStudioCount} onOpen={() => setCafeSheet(true)} /> : null
      })()}

      <WarningsPanel onOpenEvent={(e) => onOpenRoster(e)} />

      <EventList date={today} stepper={false} onOpenRoster={onOpenRoster} />
      {cafeSheet && <CraftCafeSheet date={today} onClose={() => { setCafeSheet(false); loadOpenStudioCount() }} />}
    </div>
  )
}
