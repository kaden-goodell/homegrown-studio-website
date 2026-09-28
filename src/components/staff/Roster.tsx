import { useEffect, useRef, useState } from 'react'
import StaffHeader from '@components/staff/StaffHeader'
import EventSettingsSheet from '@components/staff/EventSettingsSheet'
import HouseholdCard, { type Household, type Checkin } from '@components/staff/HouseholdCard'
import { card, btn, field, Badge } from '@components/staff/ui'
import { formatWhen, studioDate } from '@lib/studio-time'
import type { StaffMember } from '@lib/staff-auth'
import type { EventKind, StudioEvent } from '@lib/events'
import type { IncidentRecord } from '@lib/incident-store'

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
  const [incidents, setIncidents] = useState<IncidentRecord[]>([])
  const [incidentsOpen, setIncidentsOpen] = useState(false)
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

  // Incident badge (HOM-215) — loaded once per event, independent of the
  // roster poll; a silent miss just means the badge doesn't show this tick.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/staff/incidents.json?kind=${kind}&id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (!cancelled && json) setIncidents(json.data.incidents ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
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
      // A pickup-denial/lock response (HOM-214 fix round 1) carries the
      // household's live checkin state too — top-level, not under `data`,
      // same as every other error body in this endpoint — so the tries-left/
      // locked UI updates immediately instead of waiting for the 30s poll.
      const checkinPayload = json?.data?.checkin ?? json?.checkin
      const dayPayload = json?.data?.day ?? json?.day
      if (checkinPayload) {
        const respDay = typeof dayPayload === 'string' ? dayPayload : data.day
        const checkinForCard: Checkin = {
          expected: checkinPayload.expected,
          presence: checkinPayload.days?.[respDay]?.presence ?? {},
          pickedUpBy: checkinPayload.pickedUpBy,
          confirmedPickup: checkinPayload.confirmedPickup,
          notAuthorized: checkinPayload.notAuthorized,
          hasPickupCode: checkinPayload.hasPickupCode,
          codeAttempts: checkinPayload.codeAttempts ?? 0,
          locked: !!checkinPayload.locked,
          releasedTo: checkinPayload.releasedTo ?? {},
        }
        setData((d) => d && { ...d, households: d.households.map((hh) => (hh.recordId === recordId ? { ...hh, checkin: checkinForCard } : hh)) })
      }
      if (!res.ok) return { error: json?.error ?? 'Something went wrong.' }
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
      <StaffHeader title="Roster" staff={staff} onSwitch={onSwitch} onKits={onKits} onLogout={onLogout} event={event} households={data.households} day={data.day} />
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
          {incidents.length > 0 && (
            <button
              type="button"
              onClick={() => setIncidentsOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.5rem', borderRadius: '0.5rem', fontSize: '0.7rem', fontWeight: 700, background: 'rgba(185,28,28,0.1)', color: '#b91c1c', border: '1px solid rgba(185,28,28,0.3)', cursor: 'pointer' }}
            >
              🚑 Incidents ({incidents.length})
            </button>
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

      {incidentsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Incidents for this event"
          onClick={(e) => { if (e.target === e.currentTarget) setIncidentsOpen(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 125, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '1rem' }}
        >
          <div style={{ width: '100%', maxWidth: '28rem', maxHeight: '85vh', overflowY: 'auto', padding: '1.25rem', borderRadius: '1rem', background: 'rgba(255,255,255,0.98)', boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.8rem' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>🚑 Incidents · {event.title}</h3>
              <button type="button" onClick={() => setIncidentsOpen(false)} aria-label="Close" style={{ ...btn(), padding: '0.35rem 0.6rem' }}>✕</button>
            </div>
            {incidents.map((inc) => (
              <div key={inc.id} style={{ ...card, background: 'rgba(255,255,255,0.85)' }}>
                <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
                  {formatWhen(inc.at)} · {inc.who.length ? inc.who.map((w) => w.name).join(', ') : 'Unnamed'} · filed by {inc.by.name}
                </p>
                <p style={{ margin: '0.4rem 0 0', fontSize: '0.875rem', color: 'var(--color-dark)' }}>{inc.what}</p>
                {inc.firstAid && <p style={{ margin: '0.3rem 0 0', fontSize: '0.8125rem', color: 'var(--color-muted)' }}><strong style={{ color: 'var(--color-dark)' }}>First aid:</strong> {inc.firstAid}</p>}
                <p style={{ margin: '0.3rem 0 0', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
                  {inc.parentNotified.how === 'not-yet' ? 'Parent not yet notified' : `Parent notified (${inc.parentNotified.how}${inc.parentNotified.at ? `, ${formatWhen(inc.parentNotified.at)}` : ''})`}
                </p>
                <a href={`/staff/incident-print?id=${encodeURIComponent(inc.id)}`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', marginTop: '0.5rem', ...btn(), textDecoration: 'none' }}>
                  🖨 Print note
                </a>
              </div>
            ))}
          </div>
        </div>
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
