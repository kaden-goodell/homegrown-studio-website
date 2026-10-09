import { useEffect, useState } from 'react'
import StaffHeader from '@components/staff/StaffHeader'
import { type HouseholdMatch } from '@components/staff/DoorSearch'
import { card, btn, Badge } from '@components/staff/ui'
import { formatWhen, studioDate } from '@lib/studio-time'
import { addDays } from '@lib/kit-dates'
import EventList from '@components/staff/EventList'
import type { StaffMember } from '@lib/staff-auth'
import type { EventKind } from '@lib/events'

interface PartyRow {
  bookingId: string
  craftName: string
  startIso: string
  title: string | null
  hostName: string
  hostPhone: string | null
  guestCount: number
  rsvpHouseholds: number
  rsvpPeople: number
  themeName: string | null
}

/**
 * Upcoming: step through the days ahead (starting tomorrow) to see each
 * day's events, and below that every upcoming party. Today is its own tab.
 */
export default function Upcoming({
  staff,
  onOpenRoster,
}: {
  staff: StaffMember
  onOpenRoster: (e: { kind: EventKind; id: string; title: string; addFamily?: { household?: HouseholdMatch } }) => void
}) {
  const today = studioDate(new Date().toISOString())
  const [parties, setParties] = useState<PartyRow[]>([])
  const [partiesError, setPartiesError] = useState<string | null>(null)
  const [partiesLoading, setPartiesLoading] = useState(true)

  async function loadParties() {
    setPartiesLoading(true)
    setPartiesError(null)
    try {
      const res = await fetch('/api/staff/parties.json', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setPartiesError(json?.error ?? 'Couldn’t load parties.'); return }
      // Upcoming means not over yet: anything that started in the last 6 hours
      // still shows (a party in progress), oldest-first so the next one leads.
      const cutoff = Date.now() - 6 * 3_600_000
      setParties(
        (json.data.parties as PartyRow[])
          .filter((p) => Date.parse(p.startIso) >= cutoff)
          .sort((a, b) => a.startIso.localeCompare(b.startIso)),
      )
    } catch {
      setPartiesError('Couldn’t reach the studio server — check wifi and tap Retry.')
    } finally {
      setPartiesLoading(false)
    }
  }

  useEffect(() => { loadParties() }, [])

    return (
      <div>
        <StaffHeader title="Upcoming" staff={staff} onOpenRoster={onOpenRoster} />
        <EventList date={today} start={addDays(today, 1)} onOpenRoster={onOpenRoster} />
        <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', margin: '1.6rem 0 0.8rem', fontSize: '1.15rem' }}>All upcoming parties</h2>
        {partiesError && (
          <div style={{ background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.3)', borderRadius: '0.6rem', padding: '0.7rem 0.9rem', marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, fontSize: '0.875rem', color: '#b91c1c', fontWeight: 600 }}>{partiesError}</span>
            <button type="button" onClick={loadParties} style={btn()}>Retry</button>
          </div>
        )}
        {!partiesLoading && !partiesError && parties.length === 0 && <p style={{ color: 'var(--color-muted)' }}>No upcoming parties.</p>}
        {parties.map((p) => (
          <button
            key={p.bookingId}
            type="button"
            onClick={() => onOpenRoster({ kind: 'party', id: p.bookingId, title: p.title || `${p.craftName} Party` })}
            style={{ ...card, background: 'rgba(255,255,255,0.85)', width: '100%', textAlign: 'left', cursor: 'pointer', display: 'block', minHeight: '2.75rem' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.35rem' }}>
              <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: 'var(--color-dark)' }}>{p.title || `${p.craftName} Party`}</span>
                {p.themeName && <Badge tone="muted">🎀 {p.themeName}</Badge>}
              </span>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>{formatWhen(p.startIso)}</span>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0.3rem 0 0' }}>
              Host: {p.hostName}{p.hostPhone ? ` · ${p.hostPhone}` : ''} · <strong style={{ color: 'var(--color-dark)' }}>{p.rsvpHouseholds}</strong> RSVP’d ({p.rsvpPeople} ppl on file)
            </p>
          </button>
        ))}
      </div>
    )
  }
