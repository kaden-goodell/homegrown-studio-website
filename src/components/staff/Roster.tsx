import { useEffect, useRef, useState } from 'react'
import { hasAllergy } from '@lib/allergy'
import StaffHeader from '@components/staff/StaffHeader'
import EventSettingsSheet from '@components/staff/EventSettingsSheet'
import AddFamilySheet from '@components/staff/AddFamilySheet'
import CompSeatSheet from '@components/staff/CompSeatSheet'
import type { HouseholdMatch } from '@components/staff/DoorSearch'
import HouseholdCard, { type Household, type Checkin } from '@components/staff/HouseholdCard'
import { card, btn, field, Badge, FlagBanner } from '@components/staff/ui'
import { formatWhen, studioDate } from '@lib/studio-time'
import type { StaffMember } from '@lib/staff-auth'
import type { EventKind, StudioEvent } from '@lib/events'
import type { IncidentRecord } from '@lib/incident-store'
import { picksShort, prepOptions } from '@lib/seat-options'
import type { RosterChoices } from '@lib/seat-choices'
import RefundPanel, { STAFF_REFUND, type WaitingRefund } from '@components/shared/RefundPanel'
import type { BookingView } from '@lib/classes/admin-actions'

const ICON: Record<EventKind, string> = { party: '🎉', workshop: '🧵', program: '🌙' }

interface RosterData {
  event: StudioEvent
  day: string
  summary: { households: number; people: number; childrenHereNow: number }
  households: Household[]
  /** Seat picks (classes with questions only); null = no questions, undefined = the read failed. */
  choices?: RosterChoices | null
  /** Our own classes: the day's bookings from the seat ledger. */
  bookings?: (BookingView & { name: string; seatsToday: number; waiting: WaitingRefund | null })[]
  /** Our own classes: ticket type id → label. */
  ticketLabels?: Record<string, string>
}

/** How a seat on our class was paid, in a few words for the door. */
function paidWay(b: BookingView): string {
  switch (b.source) {
    case 'online': return 'Paid online'
    case 'door-card': return 'Paid on the iPad'
    case 'door-counter': return b.paidHere ? 'Paid at the counter' : 'Pay at the counter'
    case 'comp': return 'Comped'
    case 'pos': return 'Counter sale'
    default: return ''
  }
}

/**
 * A booking on one of our classes: who, how many seats today, how it was
 * paid, and for a counter sale with no name yet, "Who is it?" from the
 * families who signed. Refund (crew, with a reason) underneath.
 */
function OwnBooking({ b, classId, households, ticketLabels, onChanged }: {
  b: NonNullable<RosterData['bookings']>[number]
  classId: string
  households: Household[]
  ticketLabels: Record<string, string>
  onChanged: () => void
}) {
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unnamed = !b.customer
  async function saveName() {
    if (!who || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/staff/class-names.json', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, bookingId: b.bookingId, recordId: who }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Couldn’t save that.'); return }
      onChanged()
    } catch {
      setError('Couldn’t save — check wifi and try again.')
    } finally {
      setBusy(false)
    }
  }
  const refunded = b.refundedCents > 0
  return (
    <li data-testid="own-booking" style={{ padding: '0.6rem 0', borderTop: '1px solid rgba(var(--color-primary-rgb),0.12)', listStyle: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong style={{ color: unnamed ? 'var(--color-muted)' : 'var(--color-dark)' }}>{b.name}</strong>
        <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>
          {`${b.seatsToday} seat${b.seatsToday === 1 ? '' : 's'} · ${paidWay(b)}`}
          {refunded && ' · part refunded'}
        </span>
      </div>
      {b.overCapacity && <p style={{ margin: '0.2rem 0 0', fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-error)' }}>Over capacity. An owner decides on /admin.</p>}
      {unnamed && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.4rem' }}>
          {households.length ? (
            <>
              <select aria-label={`Who is ${b.name}`} value={who} onChange={(e) => setWho(e.target.value)} style={{ ...field, flex: '1 1 12rem' }}>
                <option value="">Who is it?</option>
                {households.map((h) => <option key={h.recordId} value={h.recordId}>{h.signer}</option>)}
              </select>
              <button type="button" onClick={saveName} disabled={!who || busy} style={{ ...btn(true), minHeight: '2.75rem' }}>{busy ? 'Saving…' : 'Save name'}</button>
            </>
          ) : (
            <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>Their name comes from the waiver once they sign for this class.</span>
          )}
        </div>
      )}
      {error && <p role="alert" style={{ margin: '0.3rem 0 0', fontSize: '0.875rem', color: '#b91c1c', fontWeight: 600 }}>{error}</p>}
      <div style={{ marginTop: '0.4rem' }}>
        <RefundPanel classId={classId} booking={b} endpoint={STAFF_REFUND} reasonRequired waiting={b.waiting} ticketLabel={(t) => ticketLabels[t] ?? t} onDone={onChanged} />
      </div>
    </li>
  )
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
  onBack,
  backLabel = 'Today',
  kind,
  id,
  initialDay,
  addFamily,
}: {
  staff: StaffMember
  onBack: () => void
  /** "← Today" or "← Parties": where Back goes. */
  backLabel?: string
  kind: EventKind
  id: string
  /** Open on this day of a multi-day event (This week's row for that day). */
  initialDay?: string
  /** Open "+ Add family" on arrival — with this household already found when
   *  Today's "Here for an event?" chip sent us here. */
  addFamily?: { household?: HouseholdMatch } | null
}) {
  const [addFamilyOpen, setAddFamilyOpen] = useState(!!addFamily)
  const [compSeatOpen, setCompSeatOpen] = useState(false)
  const [sellSeatOpen, setSellSeatOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
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
    load(initialDay ?? null)
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
        <StaffHeader title="Roster" staff={staff} />
        <button type="button" onClick={onBack} style={{ ...btn(), marginBottom: '1rem' }}>← {backLabel}</button>
        {netErrorBanner || <p style={{ textAlign: 'center', color: 'var(--color-muted)' }}>Loading…</p>}
      </div>
    )
  }

  const { event } = data
  const options = event.options ?? []
  // Comped seats are recorded on every class, so the records come back even
  // when the class asks no questions; only the totals card needs questions.
  const choices = data.choices ?? null
  const picksUnknown = options.length > 0 && data.choices === undefined
  const multiDay = event.days.length > 1
  const dayIndex = event.days.indexOf(data.day)
  const today = studioDate(new Date().toISOString())

  const here = data.households.reduce((n, h) => n + Object.values(h.checkin.presence || {}).filter((p) => !p.outAt).length, 0)
  const coming = data.households.reduce((n, h) => n + (h.checkin.expected ? h.checkin.expected.length : 1 + h.children.length), 0)
  // "Mia R. (peanuts)" for everyone with a real allergy; family last names for no-photo.
  const short = (n: string) => { const [f, ...rest] = n.trim().split(/\s+/); const l = rest.at(-1); return l ? `${f} ${l[0]}.` : f }
  const lastName = (n: string) => n.trim().split(/\s+/).at(-1) ?? n
  const allergyList = data.households.flatMap((h) => [
    ...(hasAllergy(h.adultAllergies) ? [`${short(h.signer)} (${h.adultAllergies})`] : []),
    ...h.children.filter((c) => hasAllergy(c.allergies)).map((c) => `${short(c.name)} (${c.allergies})`),
  ])
  const noPhotoFamilies = data.households.filter((h) => !h.photoConsent).map((h) => lastName(h.signer))

  // The link a household signs for THIS event — shown on an empty drop-off
  // roster so staff can read it out or text it without leaving the screen.
  const waiverLink = `${typeof window === 'undefined' ? '' : window.location.origin}/waiver?${kind}=${id}`

  const lowerQuery = query.toLowerCase()
  const visibleHouseholds = query
    ? data.households.filter((h) =>
        h.signer.toLowerCase().includes(lowerQuery) ||
        h.children.some((c) => c.name.toLowerCase().includes(lowerQuery)),
      )
    : data.households

  return (
    <div>
      <StaffHeader title="Roster" staff={staff} event={event} households={data.households} day={data.day} onCheckIn={() => setAddFamilyOpen(true)} />
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={{ ...btn(), minHeight: '2.75rem', fontSize: '0.9rem' }}>← {backLabel}</button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }}>
          {stale && <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>⚠ May be out of date</span>}
          <button
            type="button"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
            style={{ ...btn(), minHeight: '2.75rem', minWidth: '2.75rem', fontSize: '1.1rem', fontWeight: 800 }}
          >
            ⋯
          </button>
          {moreOpen && (
            <>
              <div onClick={() => setMoreOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 110 }} />
              <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 0.35rem)', zIndex: 111, minWidth: '12rem', padding: '0.35rem', borderRadius: '0.75rem', background: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,0.18)', display: 'grid', gap: '0.25rem' }}>
                <a role="menuitem" href={`/staff/print?kind=${kind}&id=${encodeURIComponent(id)}&day=${data.day}`} target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)} style={{ ...btn(), border: 'none', textDecoration: 'none', display: 'flex', alignItems: 'center', minHeight: '2.75rem', fontSize: '0.95rem' }}>🖨 Print</a>
                {!event.own && <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setEventSettingsOpen(true) }} style={{ ...btn(), border: 'none', textAlign: 'left', minHeight: '2.75rem', fontSize: '0.95rem' }}>⚙️ Event settings</button>}
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); refresh() }} style={{ ...btn(), border: 'none', textAlign: 'left', minHeight: '2.75rem', fontSize: '0.95rem' }}>↻ Refresh</button>
              </div>
            </>
          )}
        </span>
      </div>
      {netErrorBanner}

      {event.dropOff && (
        <div style={{ background: 'rgba(185,28,28,0.1)', border: '1px solid rgba(185,28,28,0.35)', borderRadius: '0.7rem', padding: '0.7rem 1rem', marginBottom: '1rem', textAlign: 'center', fontWeight: 700, color: '#b91c1c' }}>
          DROP-OFF EVENT — every child needs the pickup code to leave
        </div>
      )}

      <div style={{ ...card, background: 'rgba(255,255,255,0.85)', textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)', margin: 0, fontSize: '1.6rem' }}>
          <span aria-hidden="true">{ICON[event.kind]}</span> {event.title}
        </h2>
        <p style={{ color: 'var(--color-dark)', fontWeight: 600, margin: '0.3rem 0 0', fontSize: '1rem' }}>
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
                style={{ ...btn(d === data.day), padding: '0.45rem 0.8rem', minHeight: '2.5rem', fontSize: '0.875rem', opacity: d < today && d !== data.day ? 0.55 : 1 }}
              >
                {fmtSeg(d)}
              </button>
            ))}
          </div>
        )}

        <div data-testid="roster-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem', marginTop: '0.9rem' }}>
          {(kind === 'workshop' && typeof event.capacity === 'number' && typeof event.seats === 'number'
            ? [{ n: `${event.capacity - event.seats}`, sub: `of ${event.capacity} sold` }]
            : [{ n: `${data.summary.households}`, sub: data.summary.households === 1 ? 'family RSVP’d' : 'families RSVP’d' }]
          ).concat([
            { n: `${coming}`, sub: 'crafting' },
            { n: `${here}`, sub: 'here now' },
          ]).map((st) => (
            <div key={st.sub} style={{ padding: '0.55rem 0.3rem', borderRadius: '0.7rem', background: 'rgba(var(--color-primary-rgb),0.07)' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-dark)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{st.n}</div>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-muted)' }}>{st.sub}</div>
            </div>
          ))}
        </div>

        {incidents.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.7rem' }}>
            <button
              type="button"
              onClick={() => setIncidentsOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.3rem 0.6rem', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 700, background: 'rgba(185,28,28,0.1)', color: '#b91c1c', border: '1px solid rgba(185,28,28,0.3)', cursor: 'pointer' }}
            >
              🚑 Incidents ({incidents.length})
            </button>
          </div>
        )}
      </div>

      {/* Who to watch for, by name — one read for whoever runs the table or takes the photo. */}
      {(allergyList.length > 0 || noPhotoFamilies.length > 0) && (
        <div style={{ display: 'grid', gap: '0.45rem', marginBottom: '0.9rem' }}>
          {allergyList.length > 0 && (
            <FlagBanner tone="alert" testId="roster-allergies">⚠ Allergies: {allergyList.join(', ')}</FlagBanner>
          )}
          {noPhotoFamilies.length > 0 && (
            <FlagBanner tone="warn" testId="roster-no-photos">
              🚫 No photos: {noPhotoFamilies.join(', ')} {noPhotoFamilies.length === 1 ? 'family' : 'families'}
            </FlagBanner>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button type="button" onClick={() => setAddFamilyOpen(true)} style={{ ...btn(true), minHeight: '2.75rem', fontSize: '0.95rem', flex: '1 1 10rem' }}>+ Add family</button>
        {kind === 'workshop' && <button type="button" onClick={() => setSellSeatOpen(true)} style={{ ...btn(), minHeight: '2.75rem', fontSize: '0.95rem', flex: '1 1 7rem' }}>Sell a seat</button>}
        {kind === 'workshop' && <button type="button" onClick={() => setCompSeatOpen(true)} style={{ ...btn(), minHeight: '2.75rem', fontSize: '0.95rem', flex: '1 1 7rem' }}>Comp a seat</button>}
      </div>

      {picksUnknown && (
        <p style={{ margin: '0 0 0.8rem', fontSize: '0.875rem', color: 'var(--color-muted)', textAlign: 'center' }}>Picks unavailable — reload the page</p>
      )}
      {choices && options.length > 0 && (() => {
        const prep = prepOptions(options, choices.totals, choices.seatsSold)
        const picked = Math.max(...prep.map((o) => o.counts.reduce((n, c) => n + c.n, 0)), 0)
        const seats = choices.seatsSold ?? picked
        return (
          <section data-testid="picks-totals" aria-label="Prep" style={{ ...card, background: 'rgba(255,255,255,0.92)', borderLeft: '4px solid var(--color-primary)' }}>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--color-primary)' }}>
              PREP · {seats} SEAT{seats === 1 ? '' : 'S'}
            </p>
            {prep.map((o) => (
              <div key={o.id} style={{ marginBottom: '0.6rem' }}>
                <p style={{ margin: '0 0 0.25rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-dark)' }}>{o.label}</p>
                {o.counts.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-muted)' }}>No picks yet</p>
                ) : (
                  <table style={{ borderCollapse: 'collapse', fontSize: '1rem', color: 'var(--color-dark)' }}>
                    <tbody>
                      {o.counts.map((c) => (
                        <tr key={c.choice}>
                          <td style={{ padding: '0.15rem 1.5rem 0.15rem 0.25rem' }}>{c.choice}</td>
                          <td style={{ padding: '0.15rem 0', fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{c.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {o.unpicked > 0 && (
                  <p role="note" style={{ margin: '0.3rem 0 0', fontSize: '0.875rem', color: 'var(--color-error)' }}>
                    ⚠ {o.unpicked} seat{o.unpicked === 1 ? ' has' : 's have'} no pick yet
                  </p>
                )}
              </div>
            ))}
          </section>
        )
      })()}

      {addFamilyOpen && (
        <AddFamilySheet
          event={{ kind, id, title: event.title, day: data.day }}
          initialHousehold={addFamily?.household}
          onAdded={refresh}
          onClose={() => setAddFamilyOpen(false)}
        />
      )}

      {sellSeatOpen && kind === 'workshop' && (
        <CompSeatSheet
          mode="sell"
          priceCents={event.priceCents}
          event={{ id, title: event.title, day: data.day, ...(event.own ? { own: true as const } : {}) }}
          options={options}
          onRecorded={refresh}
          onClose={() => setSellSeatOpen(false)}
        />
      )}

      {compSeatOpen && kind === 'workshop' && (
        <CompSeatSheet
          event={{ id, title: event.title, day: data.day, ...(event.own ? { own: true as const } : {}) }}
          options={options}
          onRecorded={refresh}
          onClose={() => setCompSeatOpen(false)}
        />
      )}

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
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-muted)' }}>
                  {formatWhen(inc.at)} · {inc.who.length ? inc.who.map((w) => w.name).join(', ') : 'Unnamed'} · filed by {inc.by.name}
                </p>
                <p style={{ margin: '0.4rem 0 0', fontSize: '0.875rem', color: 'var(--color-dark)' }}>{inc.what}</p>
                {inc.firstAid && <p style={{ margin: '0.3rem 0 0', fontSize: '0.875rem', color: 'var(--color-muted)' }}><strong style={{ color: 'var(--color-dark)' }}>First aid:</strong> {inc.firstAid}</p>}
                <p style={{ margin: '0.3rem 0 0', fontSize: '0.875rem', color: 'var(--color-muted)' }}>
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

      {data.bookings && (
        <section aria-label="Bookings" style={{ ...card, background: 'rgba(255,255,255,0.9)' }}>
          <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--color-primary)' }}>
            BOOKINGS · {data.bookings.reduce((n, b) => n + b.seatsToday, 0)} SEAT{data.bookings.reduce((n, b) => n + b.seatsToday, 0) === 1 ? '' : 'S'}
          </p>
          {data.bookings.length === 0 && <p style={{ margin: '0.4rem 0 0', fontSize: '0.9rem', color: 'var(--color-muted)' }}>No one booked on this day yet.</p>}
          <ul style={{ margin: '0.3rem 0 0', padding: 0 }}>
            {data.bookings.map((b) => (
              <OwnBooking key={b.bookingId} b={b} classId={id} households={data.households} ticketLabels={data.ticketLabels ?? {}} onChanged={refresh} />
            ))}
          </ul>
        </section>
      )}

      {/* Search */}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a family or kid…"
        style={{ ...field, width: '100%', boxSizing: 'border-box', marginBottom: '0.8rem' }}
      />

      {data.households.length === 0 && (
        <div style={{ ...card, background: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--color-muted)' }}>
            No RSVPs yet — anyone who signs the agreement for this event will appear here, or tap “+ Add family”.
          </p>
          {event.dropOff && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: 'var(--color-muted)' }}>
              Send them the link: <strong style={{ color: 'var(--color-dark)', wordBreak: 'break-all' }}>{waiverLink}</strong>
            </p>
          )}
        </div>
      )}

      {data.households.length > 0 && visibleHouseholds.length === 0 && (
        <p style={{ color: 'var(--color-muted)', textAlign: 'center' }}>No one here matches “{query}”.</p>
      )}

      {/* Keyed by record AND day: the in/out selections and the revealed pickup
          code belong to one day's roster, and carried straight over when staff
          switched days on a multi-day camp. */}
      {visibleHouseholds.map((h) => (
        <HouseholdCard key={`${h.recordId}:${data.day}`} h={h} dropOff={event.dropOff} kind={kind} id={id} day={data.day} post={post} picks={choices?.byEmail[h.email.trim().toLowerCase()]} seats={kind === 'workshop' && choices ? (choices.seatsByEmail?.[h.email.trim().toLowerCase()] ?? { seats: 0, comped: 0, atRegister: 0 }) : undefined} />
      ))}

      {choices && choices.unmatched.length > 0 && (
        <div style={{ ...card, background: 'rgba(255,255,255,0.7)' }}>
          <p style={{ margin: '0 0 0.4rem', fontWeight: 700, color: 'var(--color-dark)' }}>Paid or comped, not signed in yet</p>
          {choices.unmatched.map((u, i) => (
            <p key={`${u.email}:${i}`} style={{ margin: '0.2rem 0 0', fontSize: '0.875rem', color: 'var(--color-dark)' }}>
              {`${u.name} · ${u.seats} seat${u.seats === 1 ? '' : 's'}${u.picks.length ? ` · Picks: ${picksShort(u.picks)}` : ''}`}
              {u.comped && <>{' '}<Badge tone="muted">comped</Badge></>}
              {u.atRegister && <>{' '}<Badge tone="muted">pay at register</Badge></>}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
