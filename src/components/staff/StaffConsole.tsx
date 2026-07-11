import { useEffect, useRef, useState } from 'react'
import { formatWhen, formatTime } from '@lib/studio-time'

interface PartyRow {
  bookingId: string
  craftName: string
  startIso: string
  title: string | null
  hostName: string
  guestCount: number
  rsvpHouseholds: number
  rsvpPeople: number
}

interface Presence {
  inAt: string
  outAt: string | null
}

interface Checkin {
  /** Person ids the family said are coming (RSVP). null = unspecified. */
  expected: string[] | null
  /** person id → presence. Missing = never arrived. */
  presence: Record<string, Presence>
  pickedUpBy: string | null
  confirmedPickup: string[]
  hasPickupCode: boolean
}

interface Household {
  recordId: string
  signer: string
  phone: string
  email: string
  children: { name: string; allergies: string; duplicateOf?: string }[]
  childCount: number
  adultAllergies: string
  emergency: { name: string; phone: string; relationship: string }
  authorizedPickup: string
  responsibleAdult: string
  photoConsent: boolean
  signedAt: string
  checkin: Checkin
}

interface Roster {
  party: { bookingId: string; craftName: string; startIso: string; title: string | null; hostName: string; guestCount: number; dropOff: boolean }
  summary: { households: number; people: number }
  households: Household[]
}

const card: React.CSSProperties = {
  border: '1px solid rgba(150,112,91,0.16)',
  borderRadius: '1rem',
  padding: '1rem 1.1rem',
  boxShadow: '0 8px 24px rgba(150,112,91,0.08)',
  marginBottom: '0.9rem',
}
const btn = (primary = false): React.CSSProperties => ({
  padding: '0.55rem 0.9rem',
  borderRadius: '0.625rem',
  border: primary ? 'none' : '1px solid rgba(150,112,91,0.3)',
  background: primary ? 'var(--color-primary)' : 'transparent',
  color: primary ? '#fff' : 'var(--color-dark)',
  fontSize: '0.8125rem',
  fontWeight: 600,
  cursor: 'pointer',
})
const field: React.CSSProperties = {
  padding: '0.5rem 0.7rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(150,112,91,0.3)',
  fontSize: '0.875rem',
}

type Status = 'wait' | 'in' | 'out'

function StatusPill({ status, hereCount, total }: { status: Status; hereCount: number; total: number }) {
  const map = {
    wait: { bg: 'rgba(150,112,91,0.12)', fg: 'var(--color-muted)', icon: '○', label: 'Not arrived' },
    in: { bg: 'rgba(34,197,94,0.16)', fg: 'rgb(21,128,61)', icon: '●', label: `${hereCount} of ${total} here` },
    out: { bg: 'rgba(120,120,120,0.14)', fg: '#555', icon: '✓', label: 'All picked up' },
  }[status]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.28rem 0.7rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700, background: map.bg, color: map.fg, whiteSpace: 'nowrap' }}>
      {map.icon} {map.label}
    </span>
  )
}

function Badge({ tone, wrap, children }: { tone: 'alert' | 'muted'; wrap?: boolean; children: React.ReactNode }) {
  const t = tone === 'alert'
    ? { bg: 'rgba(185,28,28,0.1)', fg: '#b91c1c', bd: 'rgba(185,28,28,0.3)' }
    : { bg: 'rgba(90,90,90,0.08)', fg: '#4b5563', bd: 'rgba(90,90,90,0.22)' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.5rem', borderRadius: '0.5rem', fontSize: '0.7rem', fontWeight: 700, background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, whiteSpace: wrap ? 'normal' : 'nowrap' }}>
      {children}
    </span>
  )
}

type PersonState = 'here' | 'out' | 'absent'
interface Person { id: string; icon: string; name: string; sub: string; allergies: string; isChild: boolean; duplicateOf?: string }

function HouseholdCard({ h, dropOff, post }: { h: Household; dropOff: boolean; post: (recordId: string, extra: any) => Promise<{ error?: string; oneTimeCode?: string }> }) {
  const people: Person[] = [
    { id: 'adult', icon: '👤', name: h.signer, sub: 'adult', allergies: h.adultAllergies, isChild: false },
    ...h.children.map((c, i) => ({ id: `child:${i}`, icon: '🧒', name: c.name, sub: '', allergies: c.allergies, isChild: true, duplicateOf: c.duplicateOf })),
  ]
  const presence = h.checkin.presence || {}
  const expected = h.checkin.expected
  const noPhoto = !h.photoConsent
  const anyAllergy = people.some((p) => p.allergies)

  const stateOf = (id: string): PersonState => {
    const p = presence[id]
    if (!p) return 'absent'
    return p.outAt ? 'out' : 'here'
  }
  const herePeople = people.filter((p) => stateOf(p.id) === 'here')
  const absentPeople = people.filter((p) => stateOf(p.id) === 'absent')
  const anyPresence = people.some((p) => stateOf(p.id) !== 'absent')
  const status: Status = herePeople.length > 0 ? 'in' : anyPresence ? 'out' : 'wait'

  // Check-in selection (absent people) defaults to who RSVP'd; expandable at the door.
  // Duplicate kids (already on another family's RSVP) default to unchecked.
  const [selIn, setSelIn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(people.map((p) => [
      p.id,
      p.duplicateOf ? false : (expected ? expected.includes(p.id) : true),
    ])),
  )
  // Checkout selection (present people) defaults to everyone here.
  const [selOut, setSelOut] = useState<Record<string, boolean>>({})
  const [code, setCode] = useState('')
  const [collectedBy, setCollectedBy] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [oneTimeCode, setOneTimeCode] = useState<string | null>(null)
  // Two-tap reset guard
  const [resetPending, setResetPending] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])

  const selectedIn = absentPeople.filter((p) => selIn[p.id]).map((p) => p.id)
  const selectedOut = herePeople.filter((p) => selOut[p.id] !== false).map((p) => p.id)
  const checkingOutChild = selectedOut.some((id) => id.startsWith('child:'))

  const border = status === 'in' ? 'rgb(34,197,94)' : status === 'out' ? 'rgba(120,120,120,0.4)' : 'rgba(150,112,91,0.3)'
  const bg = status === 'in' ? 'rgba(34,197,94,0.04)' : status === 'out' ? 'rgba(120,120,120,0.04)' : 'rgba(255,255,255,0.85)'

  async function act(extra: any) {
    setErr(null)
    const r = await post(h.recordId, extra)
    if (r.error) setErr(r.error)
    else if (r.oneTimeCode) setOneTimeCode(r.oneTimeCode)
  }

  function handleResetTap() {
    if (!resetPending) {
      setResetPending(true)
      resetTimerRef.current = setTimeout(() => setResetPending(false), 5000)
    } else {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      setResetPending(false)
      act({ action: 'undo-checkin' })
    }
  }

  // Right-side status label (the checkbox lives on the LEFT of the row).
  function stateLabel(p: Person, st: PersonState) {
    const pr = presence[p.id]
    if (st === 'here') {
      return <span style={{ fontSize: '0.78rem', color: 'rgb(21,128,61)', fontWeight: 700, whiteSpace: 'nowrap' }}>● here {pr ? formatTime(pr.inAt) : ''}</span>
    }
    if (st === 'out') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.78rem', color: '#666', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ left {pr?.outAt ? formatTime(pr.outAt) : ''}</span>
          <button type="button" onClick={() => act({ action: 'undo-pickup', personIds: [p.id] })} style={{ ...btn(), padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}>Undo</button>
        </span>
      )
    }
    if (expected == null) return null
    return expected.includes(p.id)
      ? <span style={{ fontSize: '0.7rem', color: 'rgb(21,128,61)', fontWeight: 700, whiteSpace: 'nowrap' }}>RSVP’d</span>
      : <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>didn’t RSVP</span>
  }

  // Big, obvious check box on the left of a person row (or a spacer to keep alignment).
  function leftBox(p: Person, st: PersonState) {
    if (st === 'out') return <span style={{ width: '1.4rem', flex: '0 0 auto' }} />
    const checked = st === 'here' ? selOut[p.id] !== false : !!selIn[p.id]
    const onChange = (v: boolean) =>
      st === 'here' ? setSelOut((s) => ({ ...s, [p.id]: v })) : setSelIn((s) => ({ ...s, [p.id]: v }))
    return (
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: '1.4rem', height: '1.4rem', flex: '0 0 auto', cursor: 'pointer', accentColor: 'var(--color-primary)' }}
      />
    )
  }

  return (
    <div style={{ ...card, borderLeft: `5px solid ${border}`, background: bg, opacity: status === 'out' ? 0.72 : 1 }}>
      {/* Header: family name + status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontWeight: 700, color: 'var(--color-dark)', fontSize: '1.0625rem' }}>{h.signer}</span>
          <a href={`tel:${h.phone}`} style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--color-primary)', textDecoration: 'none' }}>📞 {h.phone}</a>
        </div>
        <StatusPill status={status} hereCount={herePeople.length} total={people.length} />
      </div>

      {/* Card-level scan strip: any allergy or no-photo in this family */}
      {(anyAllergy || noPhoto) && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
          {anyAllergy && <Badge tone="alert" wrap>⚠ Allergies in this family</Badge>}
          {noPhoto && <Badge tone="muted">🚫 No photos</Badge>}
        </div>
      )}

      {/* People — big checkbox on the LEFT, badges on the person, status on the right */}
      <div style={{ marginTop: '0.6rem' }}>
        {people.map((p) => {
          const st = stateOf(p.id)
          return (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0', borderTop: '1px solid rgba(150,112,91,0.1)', flexWrap: 'wrap', opacity: st === 'out' ? 0.6 : 1, cursor: st === 'out' ? 'default' : 'pointer' }}>
              {leftBox(p, st)}
              <span style={{ fontSize: '0.95rem' }}>{p.icon}</span>
              <span style={{ fontWeight: 600, color: 'var(--color-dark)', fontSize: '0.9375rem' }}>{p.name}</span>
              {p.sub && <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>{p.sub}</span>}
              {p.duplicateOf && <Badge tone="muted">also on {p.duplicateOf}’s RSVP</Badge>}
              {stateLabel(p, st)}
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {p.allergies && <Badge tone="alert" wrap>⚠ {p.allergies}</Badge>}
              </span>
            </label>
          )
        })}
      </div>

      {/* Meta */}
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0.55rem 0 0' }}>
        <strong style={{ color: 'var(--color-dark)' }}>Emergency:</strong> {h.emergency.name} · {h.emergency.phone}{h.emergency.relationship ? ` (${h.emergency.relationship})` : ''}
      </p>
      {h.responsibleAdult && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0.15rem 0 0' }}>
          <strong style={{ color: 'var(--color-dark)' }}>With:</strong> {h.responsibleAdult}
        </p>
      )}
      {dropOff && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0.15rem 0 0' }}>
          <strong style={{ color: 'var(--color-dark)' }}>Pickup:</strong> {h.authorizedPickup || '— not provided —'}
        </p>
      )}

      {/* Pickup code — shown ONCE */}
      {dropOff && oneTimeCode && (
        <div style={{ marginTop: '0.7rem', background: 'rgba(150,112,91,0.1)', border: '1px solid rgba(150,112,91,0.4)', borderRadius: '0.6rem', padding: '0.7rem 0.8rem', textAlign: 'center' }}>
          <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-primary)', fontWeight: 700 }}>Pickup code — give to parent now</span>
          <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '0.25em', color: 'var(--color-dark)', margin: '0.1rem 0' }}>{oneTimeCode}</div>
          <p style={{ fontSize: '0.7rem', color: 'var(--color-muted)', margin: '0 0 0.5rem' }}>Won’t be shown again — it collects any of their kids. Make sure the parent has it.</p>
          <button type="button" onClick={() => setOneTimeCode(null)} style={btn(true)}>Parent has it — hide</button>
        </div>
      )}
      {dropOff && status === 'in' && !oneTimeCode && (
        <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {h.checkin.hasPickupCode && (
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>🔒 Pickup code issued (hidden)</span>
          )}
          <button type="button" onClick={() => act({ action: 'reissue-code' })} style={btn()}>
            {h.checkin.hasPickupCode ? 'Re-issue code' : 'Issue pickup code'}
          </button>
        </div>
      )}

      {err && <p style={{ color: '#b91c1c', fontSize: '0.8125rem', marginTop: '0.5rem', fontWeight: 600 }}>{err}</p>}

      {/* Check-out — one code for the family, pick who's leaving now */}
      {herePeople.length > 0 && (
        <div style={{ marginTop: '0.8rem', borderTop: '1px solid rgba(150,112,91,0.12)', paddingTop: '0.7rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {dropOff && checkingOutChild && (
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Pickup code" inputMode="numeric" style={{ ...field, width: '6.5rem' }} />
          )}
          <input value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} placeholder="Collected by (optional)" style={{ ...field, flex: '1 1 8rem' }} />
          <button
            type="button"
            disabled={selectedOut.length === 0}
            onClick={() => act({ action: 'pickup', personIds: selectedOut, code: code.trim(), pickedUpBy: collectedBy.trim() })}
            style={{ ...btn(true), opacity: selectedOut.length === 0 ? 0.5 : 1 }}
          >
            Check out ({selectedOut.length})
          </button>
          {/* Two-tap reset guard — no native confirm dialog */}
          {resetPending ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Really reset? Clears this family’s arrival times.</span>
              <button type="button" onClick={handleResetTap} style={{ ...btn(), color: '#b91c1c', borderColor: 'rgba(185,28,28,0.35)' }}>Reset</button>
              <button type="button" onClick={() => { if (resetTimerRef.current) clearTimeout(resetTimerRef.current); setResetPending(false) }} style={btn()}>Keep</button>
            </span>
          ) : (
            <button type="button" onClick={handleResetTap} style={{ ...btn(), color: 'var(--color-muted)', borderColor: 'transparent' }}>Reset</button>
          )}
        </div>
      )}

      {/* Check-in — pick who's here (RSVP pre-selected), add late arrivals anytime */}
      {absentPeople.length > 0 && (
        <div style={{ marginTop: '0.7rem', borderTop: herePeople.length > 0 ? '1px solid rgba(150,112,91,0.12)' : 'none', paddingTop: herePeople.length > 0 ? '0.7rem' : 0 }}>
          <button
            type="button"
            disabled={selectedIn.length === 0}
            onClick={() => act({ action: 'checkin', personIds: selectedIn })}
            style={{ ...btn(true), width: '100%', padding: '0.7rem', opacity: selectedIn.length === 0 ? 0.5 : 1 }}
          >
            {status === 'wait' ? `Check in (${selectedIn.length})` : `Add / check in (${selectedIn.length})`}
          </button>
        </div>
      )}
    </div>
  )
}

export default function StaffConsole() {
  const [phase, setPhase] = useState<'checking' | 'login' | 'parties' | 'roster'>('checking')
  const [passcode, setPasscode] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [parties, setParties] = useState<PartyRow[]>([])
  const [roster, setRoster] = useState<Roster | null>(null)
  const [netError, setNetError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [query, setQuery] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function loadParties() {
    try {
      setNetError(null)
      const res = await fetch('/api/staff/parties.json', { cache: 'no-store' })
      if (res.status === 401) { setPhase('login'); return }
      const json = await res.json()
      setParties(json.data.parties)
      setPhase('parties')
    } catch {
      setNetError('Couldn’t reach the studio server — check wifi and tap Retry.')
    }
  }
  useEffect(() => { loadParties() }, [])

  async function doLogin() {
    setLoginError(null)
    const res = await fetch('/api/staff/login.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) })
    if (!res.ok) { setLoginError((await res.json().catch(() => null))?.error ?? 'Login failed.'); return }
    setPasscode(''); await loadParties()
  }
  async function logout() { await fetch('/api/staff/login.json', { method: 'DELETE' }); setRoster(null); setParties([]); setPhase('login') }

  async function openParty(bookingId: string) {
    try {
      setNetError(null)
      setQuery('')
      const res = await fetch(`/api/staff/roster.json?party=${encodeURIComponent(bookingId)}`, { cache: 'no-store' })
      if (res.status === 401) { setPhase('login'); return }
      setRoster((await res.json()).data)
      setPhase('roster')
    } catch {
      setNetError('Couldn’t reach the studio server — check wifi and tap Retry.')
    }
  }

  async function refreshRoster() {
    if (!roster) return
    try {
      const res = await fetch(`/api/staff/roster.json?party=${encodeURIComponent(roster.party.bookingId)}`, { cache: 'no-store' })
      if (!res.ok) { setStale(true); return }
      setRoster((await res.json()).data)
      setStale(false)
    } catch {
      setStale(true)
    }
  }

  // Poll every 30s while on the roster view
  useEffect(() => {
    if (phase === 'roster') {
      pollRef.current = setInterval(() => { refreshRoster() }, 30_000)
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [phase, roster?.party.bookingId])

  async function setDropOff(on: boolean) {
    if (!roster) return
    const res = await fetch('/api/staff/party.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ party: roster.party.bookingId, dropOff: on }) })
    if (res.ok) setRoster({ ...roster, party: { ...roster.party, dropOff: on } })
  }

  async function post(recordId: string, extra: any): Promise<{ error?: string; oneTimeCode?: string }> {
    if (!roster) return {}
    try {
      const res = await fetch('/api/staff/checkin.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ party: roster.party.bookingId, recordId, ...extra }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) return { error: json?.error ?? 'Something went wrong.' }
      setRoster({ ...roster, households: roster.households.map((hh) => (hh.recordId === recordId ? { ...hh, checkin: json.data.checkin } : hh)) })
      return { oneTimeCode: json.data.oneTimeCode }
    } catch {
      return { error: 'Couldn’t save — check wifi and try again.' }
    }
  }

  if (phase === 'checking') return <p style={{ textAlign: 'center', color: 'var(--color-muted)' }}>Loading…</p>

  if (phase === 'login') {
    return (
      <div style={{ ...card, background: 'rgba(255,255,255,0.85)', maxWidth: '22rem', margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.35rem' }}>Staff check-in</h2>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>Enter the staff passcode.</p>
        <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doLogin()} placeholder="Passcode" style={{ ...field, width: '100%', marginBottom: '0.6rem' }} />
        {loginError && <p style={{ color: '#b91c1c', fontSize: '0.8125rem', marginBottom: '0.6rem' }}>{loginError}</p>}
        <button type="button" onClick={doLogin} style={{ ...btn(true), width: '100%', padding: '0.65rem' }}>Enter</button>
      </div>
    )
  }

  // Network error banner (shown in parties and roster phases)
  const netErrorBanner = netError && (
    <div style={{ background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.3)', borderRadius: '0.6rem', padding: '0.7rem 0.9rem', marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
      <span style={{ flex: 1, fontSize: '0.875rem', color: '#b91c1c', fontWeight: 600 }}>{netError}</span>
      <button type="button" onClick={phase === 'roster' && roster ? () => openParty(roster.party.bookingId) : loadParties} style={btn()}>Retry</button>
    </div>
  )

  if (phase === 'parties') {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', margin: 0 }}>Parties</h2>
          <button type="button" onClick={logout} style={btn()}>Log out</button>
        </div>
        {netErrorBanner}
        {parties.length === 0 && !netError && <p style={{ color: 'var(--color-muted)' }}>No parties yet.</p>}
        {parties.map((p) => (
          <button key={p.bookingId} type="button" onClick={() => openParty(p.bookingId)} style={{ ...card, background: 'rgba(255,255,255,0.85)', width: '100%', textAlign: 'left', cursor: 'pointer', display: 'block' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.35rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-dark)' }}>{p.title || `${p.craftName} Party`}</span>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>{formatWhen(p.startIso)}</span>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0.3rem 0 0' }}>
              Host: {p.hostName} · <strong style={{ color: 'var(--color-dark)' }}>{p.rsvpHouseholds}</strong> RSVP’d ({p.rsvpPeople} ppl)
            </p>
          </button>
        ))}
      </div>
    )
  }

  if (!roster) return null
  const here = roster.households.reduce((n, h) => n + Object.values(h.checkin.presence || {}).filter((p) => !p.outAt).length, 0)
  const coming = roster.households.reduce((n, h) => n + (h.checkin.expected ? h.checkin.expected.length : 1 + h.children.length), 0)
  const allergyCount = roster.households.reduce((n, h) => n + (h.adultAllergies ? 1 : 0) + h.children.filter((c) => c.allergies).length, 0)

  // Filter households by search query
  const lowerQuery = query.toLowerCase()
  const visibleHouseholds = query
    ? roster.households.filter((h) =>
        h.signer.toLowerCase().includes(lowerQuery) ||
        h.children.some((c) => c.name.toLowerCase().includes(lowerQuery))
      )
    : roster.households

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setPhase('parties')} style={btn()}>← All parties</button>
        <button type="button" onClick={refreshRoster} style={btn()}>↻ Refresh</button>
        {stale && <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>⚠ Roster may be stale</span>}
      </div>
      {netErrorBanner}
      <div style={{ ...card, background: 'rgba(255,255,255,0.85)', textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)', margin: 0 }}>{roster.party.title || `${roster.party.craftName} Party`}</h2>
        <p style={{ color: 'var(--color-dark)', fontWeight: 600, margin: '0.3rem 0 0' }}>{formatWhen(roster.party.startIso)}</p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '0.6rem' }}>
          <Badge tone="muted">👥 {roster.summary.households} RSVP’d</Badge>
          <Badge tone="muted">🗓 {coming} expected</Badge>
          <Badge tone="muted">✓ {here} here now</Badge>
          {allergyCount > 0 && <Badge tone="alert">⚠ {allergyCount} with allergies</Badge>}
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.7rem', fontSize: '0.8125rem', color: 'var(--color-dark)', cursor: 'pointer' }}>
          <input type="checkbox" checked={roster.party.dropOff} onChange={(e) => setDropOff(e.target.checked)} />
          Drop-off event (studio-run only — camps/PNO; parties are not drop-off)
        </label>
      </div>

      {/* Search */}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a family or kid…"
        style={{ ...field, width: '100%', boxSizing: 'border-box', marginBottom: '0.8rem' }}
      />

      {visibleHouseholds.map((h) => (
        <HouseholdCard key={h.recordId} h={h} dropOff={roster.party.dropOff} post={post} />
      ))}
    </div>
  )
}
