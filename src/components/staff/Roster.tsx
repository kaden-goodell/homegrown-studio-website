import { useEffect, useRef, useState } from 'react'
import StaffHeader from '@components/staff/StaffHeader'
import EventSettingsSheet from '@components/staff/EventSettingsSheet'
import HouseholdCard, { type Household, type Checkin } from '@components/staff/HouseholdCard'
import { card, btn, field, Badge } from '@components/staff/ui'
import { formatWhen, studioDate } from '@lib/studio-time'
import type { StaffMember } from '@lib/staff-auth'
import type { EventKind, StudioEvent } from '@lib/events'

const ICON: Record<EventKind, string> = { party: '🎉', workshop: '🧵', program: '🌙' }
const DROP_OFF_CAP = 12

interface RosterData {
  event: StudioEvent
  day: string
  summary: { households: number; people: number; childrenHereNow: number }
  capWarning: boolean
  households: Household[]
}

/** "Mon 19" — short weekday + day number, studio-local calendar math (no tz shift). */
function fmtSeg(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const wd = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' })
  return `${wd} ${d}`
}

/**
 * Per-event roster (HOM-213): header + drop-off banner + multi-day selector,
 * search, and one `HouseholdCard` per signed household. Replaces the old
 * party-only roster screen in `StaffConsole` — works for any event kind
 * `getEvent`/`roster.json` resolve (party, workshop).
 */
export default function Roster({
  staff,
  onSwitch,
  onKits,
  onLogout,
  onBack,
  kind,
  id,
}: {
  staff: StaffMember
  onSwitch: () => void
  onKits: () => void
  onLogout: () => void
  onBack: () => void
  kind: EventKind
  id: string
}) {
  const [data, setData] = useState<RosterData | null>(null)
  const [netError, setNetError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [query, setQuery] = useState('')
  const [eventSettingsOpen, setEventSettingsOpen] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // The last day we asked the server for — used by `refresh`/the poll so they
  // keep showing whatever day staff is looking at, not silently jump to
  // "today" on every 30s tick.
  const dayRef = useRef<string | null>(null)

  async function load(targetDay?: string | null) {
    try {
      setNetError(null)
      const dayQ = targetDay ? `&day=${encodeURIComponent(targetDay)}` : ''
      const res = await fetch(`/api/staff/roster.json?kind=${kind}&id=${encodeURIComponent(id)}${dayQ}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setNetError(json?.error ?? 'Couldn’t load the roster.'); return }
      dayRef.current = json.data.day
      setData(json.data)
      setStale(false)
    } catch {
      setNetError('Couldn’t reach the studio server — check wifi and tap Retry.')
    }
  }

  async function refresh() {
    try {
      const dayQ = dayRef.current ? `&day=${encodeURIComponent(dayRef.current)}` : ''
      const res = await fetch(`/api/staff/roster.json?kind=${kind}&id=${encodeURIComponent(id)}${dayQ}`, { cache: 'no-store' })
      if (!res.ok) { setStale(true); return }
      const json = await res.json()
      dayRef.current = json.data.day
      setData(json.data)
      setStale(false)
    } catch {
      setStale(true)
    }
  }

  // Fresh load on mount (or if the target event changes under us).
  useEffect(() => {
    dayRef.current = null
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id])

  // Poll every 30s while this roster is on screen.
  useEffect(() => {
    pollRef.current = setInterval(() => { refresh() }, 30_000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id])

  async function post(recordId: string, extra: any): Promise<{ error?: string; oneTimeCode?: string; smsFailed?: boolean }> {
    if (!data) return {}
    try {
      const res = await fetch('/api/staff/checkin.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, recordId, day: data.day, ...extra }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) return { error: json?.error ?? 'Something went wrong.' }
      const respDay = typeof json.data.day === 'string' ? json.data.day : data.day
      const checkinForCard: Checkin = {
        expected: json.data.checkin.expected,
        presence: json.data.checkin.days?.[respDay]?.presence ?? {},
        pickedUpBy: json.data.checkin.pickedUpBy,
        confirmedPickup: json.data.checkin.confirmedPickup,
        notAuthorized: json.data.checkin.notAuthorized,
        hasPickupCode: json.data.checkin.hasPickupCode,
        codeAttempts: json.data.checkin.codeAttempts ?? 0,
        locked: !!json.data.checkin.locked,
        releasedTo: json.data.checkin.releasedTo ?? {},
      }
      setData((d) => d && { ...d, households: d.households.map((hh) => (hh.recordId === recordId ? { ...hh, checkin: checkinForCard } : hh)) })
      return { oneTimeCode: json.data.oneTimeCode, smsFailed: json.data.smsFailed }
    } catch {
      return { error: 'Couldn’t save — check wifi and try again.' }
    }
  }

  function applyEventSettings(saved: StudioEvent) {
    setData((d) => d && { ...d, event: saved })
  }

  const netErrorBanner = netError && (
    <div style={{ background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.3)', borderRadius: '0.6rem', padding: '0.7rem 0.9rem', marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
      <span style={{ flex: 1, fontSize: '0.875rem', color: '#b91c1c', fontWeight: 600 }}>{netError}</span>
      <button type="button" onClick={() => load(dayRef.current)} style={btn()}>Retry</button>
    </div>
  )

  if (!data) {
    return (
      <div>
        <StaffHeader title="Roster" staff={staff} onSwitch={onSwitch} onKits={onKits} onLogout={onLogout} />
        <button type="button" onClick={onBack} style={{ ...btn(), marginBottom: '1rem' }}>← Today</button>
        {netErrorBanner || <p style={{ textAlign: 'center', color: 'var(--color-muted)' }}>Loading…</p>}
      </div>
    )
  }

  const { event } = data
  const multiDay = event.days.length > 1
  const dayIndex = event.days.indexOf(data.day)
  const today = studioDate(new Date().toISOString())

  const here = data.households.reduce((n, h) => n + Object.values(h.checkin.presence || {}).filter((p) => !p.outAt).length, 0)
  const coming = data.households.reduce((n, h) => n + (h.checkin.expected ? h.checkin.expected.length : 1 + h.children.length), 0)
  const allergyCount = data.households.reduce((n, h) => n + (h.adultAllergies ? 1 : 0) + h.children.filter((c) => c.allergies).length, 0)
  const noPhotoGroups = data.households.filter((h) => !h.photoConsent).length

  const lowerQuery = query.toLowerCase()
  const visibleHouseholds = query
    ? data.households.filter((h) =>
        h.signer.toLowerCase().includes(lowerQuery) ||
        h.children.some((c) => c.name.toLowerCase().includes(lowerQuery)),
      )
    : data.households

  return (
    <div>
      <StaffHeader title="Roster" staff={staff} onSwitch={onSwitch} onKits={onKits} onLogout={onLogout} />
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={btn()}>← Today</button>
        <button type="button" onClick={refresh} style={btn()}>↻ Refresh</button>
        <a href={`/staff/print?kind=${kind}&id=${encodeURIComponent(id)}&day=${data.day}`} target="_blank" rel="noopener noreferrer" style={{ ...btn(), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
          🖨 Print
        </a>
        {stale && <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>⚠ Roster may be stale</span>}
      </div>
      {netErrorBanner}

      {event.dropOff && (
        <div style={{ background: 'rgba(185,28,28,0.1)', border: '1px solid rgba(185,28,28,0.35)', borderRadius: '0.7rem', padding: '0.7rem 1rem', marginBottom: '1rem', textAlign: 'center', fontWeight: 700, color: '#b91c1c' }}>
          DROP-OFF EVENT — every child needs the pickup code to leave
        </div>
      )}

      <div style={{ ...card, background: 'rgba(255,255,255,0.85)', textAlign: 'center', position: 'relative' }}>
        <button
          type="button"
          onClick={() => setEventSettingsOpen(true)}
          aria-label="Event settings"
          title="Event settings"
          style={{ ...btn(), position: 'absolute', top: '0.7rem', right: '0.7rem', padding: '0.35rem 0.55rem' }}
        >
          ⚙
        </button>
        <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)', margin: 0 }}>
          <span aria-hidden="true">{ICON[event.kind]}</span> {event.title}
        </h2>
        <p style={{ color: 'var(--color-dark)', fontWeight: 600, margin: '0.3rem 0 0' }}>
          {formatWhen(event.startIso)}
          {multiDay && <> · Day {dayIndex + 1} of {event.days.length}</>}
        </p>

        {multiDay && (
          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '0.7rem' }}>
            {event.days.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => load(d)}
                style={{ ...btn(d === data.day), padding: '0.35rem 0.7rem', fontSize: '0.78125rem', opacity: d < today && d !== data.day ? 0.55 : 1 }}
              >
                {fmtSeg(d)}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '0.6rem' }}>
          <Badge tone="muted">👥 {data.summary.households} RSVP’d</Badge>
          <Badge tone="muted">🗓 {coming} crafting</Badge>
          <Badge tone="muted">✓ {here} here now</Badge>
          {allergyCount > 0 && <Badge tone="alert">⚠ {allergyCount} with allergies</Badge>}
          {noPhotoGroups > 0 && (
            <Badge tone="alert" wrap>🚫 No group photos — {noPhotoGroups} {noPhotoGroups === 1 ? 'group' : 'groups'} opted out</Badge>
          )}
          {event.dropOff && <Badge tone="alert">🔑 Drop-off event</Badge>}
          {data.capWarning && (
            <Badge tone="alert" wrap>⚠ {data.summary.childrenHereNow} kids checked in — cap is {DROP_OFF_CAP}</Badge>
          )}
        </div>
      </div>

      {eventSettingsOpen && (
        <EventSettingsSheet
          event={event}
          onSaved={applyEventSettings}
          onClose={() => setEventSettingsOpen(false)}
        />
      )}

      {/* Search */}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a family or kid…"
        style={{ ...field, width: '100%', boxSizing: 'border-box', marginBottom: '0.8rem' }}
      />

      {visibleHouseholds.map((h) => (
        <HouseholdCard key={h.recordId} h={h} dropOff={event.dropOff} kind={kind} id={id} day={data.day} post={post} />
      ))}
    </div>
  )
}
