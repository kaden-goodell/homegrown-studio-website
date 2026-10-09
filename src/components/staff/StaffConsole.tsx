import { useEffect, useRef, useState, type ReactNode } from 'react'
import { formatCents } from '@lib/utils'
import { kitConfig } from '@config/kit.config'
import { kitThemes } from '@config/kit-content'
import { addDays } from '@lib/kit-dates'
import PickStaff from '@components/staff/PickStaff'
import StaffHeader from '@components/staff/StaffHeader'
import Today from '@components/staff/Today'
import Upcoming from '@components/staff/Upcoming'
import { readDayParam, writeDayParam } from '@components/staff/EventList'
import { StaffNavContext, type StaffNav, type StaffTab } from '@components/staff/nav'
import GiftCards from '@components/staff/GiftCards'
import Roster from '@components/staff/Roster'
import type { HouseholdMatch } from '@components/staff/DoorSearch'
import { card, btn, field, Badge } from '@components/staff/ui'
import type { StaffMember } from '@lib/staff-auth'
import { EVENT_KIND_RE, type EventKind } from '@lib/event-kinds'

// ─── Kits phase ──────────────────────────────────────────────────────────────

interface KitOrder {
  orderId: string
  reference: string
  createdAt: string
  contact: { name: string; email: string; phone: string; address: string }
  crafts: { craftId: string; name: string; qty: number; perHeadCents: number; personalized?: boolean }[]
  guests: number
  theme?: { themeId: string; ledgerThemeId: string; serves: number; packagePriceCents: number; depositCents: number }
  partyDate: string
  pickupDate: string
  returnBy: string
  weekKey: string
  totalChargedCents: number
  quoteTotalCents?: number
  balanceDueCents?: number
  depositRefund?: { amountCents: number; refundId: string; at: string }
  status: 'upcoming' | 'out' | 'returned' | 'cancelled' | 'forfeited'
  events: { at: string; action: string; note?: string; by?: { id: string; name: string }; amountCents?: number }[]
}
interface KitBuckets {
  pickupToday: KitOrder[]
  awaiting: KitOrder[]
  missedPickup: KitOrder[]
  out: KitOrder[]
  dueBackToday: KitOrder[]
  overdue: KitOrder[]
  recentlySettled: KitOrder[]
}
interface RadarRow { themeId: string; weekKey: string; committed: number; owned: number }
interface KitAssembly {
  weekKey: string
  isCurrent: boolean
  orders: KitOrder[]
  craftTotals: { name: string; qty: number }[]
  themeTotals: { label: string; count: number }[]
}

const STATUS_LABEL: Record<KitOrder['status'], string> = {
  upcoming: 'Upcoming', out: 'Out', returned: 'Returned', cancelled: 'Cancelled', forfeited: 'Forfeited',
}

/** Display status: a crafts-only kit settles as 'returned' on pickup (nothing
 *  to bring back), but staff should read that as "picked up", not "returned". */
function statusLabelFor(order: KitOrder): string {
  if (!order.theme && order.status === 'returned') return 'Picked up · done'
  return STATUS_LABEL[order.status]
}

/** YYYY-MM-DD → "Thu, Jul 16" (local calendar arithmetic, no tz shift). */
function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function kitStudioToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: kitConfig.timezone })
}
function themeDisplay(themeId?: string): string {
  if (!themeId) return ''
  return kitThemes.find((t) => t.id === themeId)?.displayName ?? themeId
}

const KIT_RETURN = '/api/staff/kit-return.json'
const KIT_CANCEL = '/api/staff/kit-cancel.json'
const KIT_REMIND = '/api/staff/kit-remind.json'

function KitOrderCard({ order, onAction }: { order: KitOrder; onAction: (path: string, body: any) => Promise<{ error?: string }> }) {
  // Inline panels only — no native dialogs (house rule).
  const [panel, setPanel] = useState<'none' | 'return' | 'withhold' | 'forfeit' | 'cancel'>('none')
  const [withheld, setWithheld] = useState('') // dollars, staff-entered
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isThemed = !!order.theme
  const deposit = order.theme?.depositCents ?? 0
  const withheldCents = Math.round((parseFloat(withheld) || 0) * 100)
  const withholdValid = withheldCents >= 1 && withheldCents <= deposit
  const partialRefund = Math.max(0, deposit - withheldCents)

  // Cancel refund preview (server recomputes authoritatively).
  const freeCancel = kitStudioToday() <= addDays(order.pickupDate, -kitConfig.leadTimeDays)
  const cancelRefund = freeCancel ? order.totalChargedCents : Math.max(0, order.totalChargedCents - kitConfig.assemblyFeeCents)

  // Undo is only honest before a refund goes out (matches kit-return semantics).
  const canUndo = isThemed && !order.depositRefund && (order.status === 'forfeited' || order.status === 'returned')

  async function run(path: string, body: any) {
    setErr(null); setBusy(true)
    const r = await onAction(path, body)
    setBusy(false)
    if (r.error) setErr(r.error)
    else setPanel('none') // success re-fetches buckets; this card unmounts
  }

  const statusTone = order.status === 'forfeited' ? '#b91c1c' : order.status === 'out' ? 'rgb(180,120,20)' : 'var(--color-muted)'

  return (
    <div style={{ ...card, background: 'rgba(255,255,255,0.85)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: 'var(--color-dark)' }}>{order.contact.name}</span>
        <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: statusTone }}>{statusLabelFor(order)}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>#{order.reference}</span>
        </span>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
        {isThemed && <Badge tone="muted">🎀 {themeDisplay(order.theme!.themeId)} · serves {order.theme!.serves}</Badge>}
        {!isThemed && <Badge tone="muted">Crafts only</Badge>}
        <Badge tone="muted">👥 {order.guests}</Badge>
        {order.crafts.map((c) => (
          <Badge key={c.craftId} tone={c.personalized ? 'alert' : 'muted'}>
            {c.personalized ? '✏️ ' : ''}{c.name} ×{c.qty}{c.personalized ? ' — collect names!' : ''}
          </Badge>
        ))}
      </div>

      <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0.5rem 0 0' }}>
        <a href={`tel:${order.contact.phone}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>📞 {order.contact.phone}</a>
        {order.contact.address ? <> · 📍 {order.contact.address}</> : null}
      </p>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-dark)', margin: '0.35rem 0 0' }}>
        <strong>Pick up</strong> {fmtDay(order.pickupDate)} · <strong>Party</strong> {fmtDay(order.partyDate)}
        {isThemed && <> · <strong>Return by</strong> {fmtDay(order.returnBy)}, {kitConfig.returnWindow}</>}
      </p>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0.2rem 0 0' }}>
        Charged {formatCents(order.totalChargedCents)}
        {order.depositRefund
          ? ` · deposit ${formatCents(order.depositRefund.amountCents)} refunded ${fmtDay(order.depositRefund.at.slice(0, 10))}`
          : isThemed ? ` · deposit ${formatCents(deposit)} held` : ' · no deposit'}
      </p>
      {/* Deposit-only orders: the balance is collected on the POS at pickup —
          make it impossible to hand a kit over without seeing the number. */}
      {!!order.balanceDueCents && order.status === 'upcoming' && (
        <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'rgb(180,120,20)', margin: '0.3rem 0 0' }}>
          💵 Collect {formatCents(order.balanceDueCents)} at pickup (of {formatCents(order.quoteTotalCents ?? 0)} total)
        </p>
      )}

      {err && <p style={{ color: '#b91c1c', fontSize: '0.8125rem', marginTop: '0.5rem', fontWeight: 600 }}>{err}</p>}

      {/* ── Actions by status ── */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.7rem', alignItems: 'center' }}>
        {order.status === 'upcoming' && panel !== 'cancel' && (
          <>
            <button type="button" disabled={busy} onClick={() => run(KIT_RETURN, { orderId: order.orderId, action: 'pickup' })} style={btn(true)}>
              {order.balanceDueCents
                ? `Balance ${formatCents(order.balanceDueCents)} collected — mark picked up`
                : isThemed ? 'Mark picked up — moves to Out' : 'Mark picked up — done, nothing to return'}
            </button>
            <button type="button" disabled={busy} onClick={() => setPanel('cancel')} style={{ ...btn(), color: '#b91c1c', borderColor: 'rgba(185,28,28,0.35)' }}>Cancel + refund</button>
          </>
        )}
        {order.status === 'upcoming' && panel === 'cancel' && (
          <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
              Cancel and refund {formatCents(cancelRefund)}?{freeCancel ? '' : ` (${formatCents(kitConfig.assemblyFeeCents)} assembly fee kept)`}
            </span>
            <button type="button" disabled={busy} onClick={() => run(KIT_CANCEL, { orderId: order.orderId })} style={{ ...btn(), color: '#b91c1c', borderColor: 'rgba(185,28,28,0.35)' }}>Confirm cancel</button>
            <button type="button" disabled={busy} onClick={() => setPanel('none')} style={btn()}>Keep</button>
          </span>
        )}

        {order.status === 'out' && panel === 'none' && (() => {
          // One-tap reminder, sent server-side FROM the business Quo number —
          // customers see (256) 464-1710, not a staff member's personal cell.
          const lastReminder = [...order.events].reverse().find((e) => e.action === 'reminder')
          return (
            <>
              <button type="button" disabled={busy} onClick={() => setPanel('return')} style={btn(true)}>Check in return</button>
              <button type="button" disabled={busy} onClick={() => run(KIT_REMIND, { orderId: order.orderId })} style={btn()}>
                💬 Text reminder
              </button>
              {lastReminder && (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                  reminded {fmtDay(lastReminder.at.slice(0, 10))}
                </span>
              )}
            </>
          )
        })()}
        {order.status === 'out' && panel === 'return' && (
          <>
            <button type="button" disabled={busy} onClick={() => run(KIT_RETURN, { orderId: order.orderId, action: 'complete' })} style={btn(true)}>Complete — refund {formatCents(deposit)}</button>
            <button type="button" disabled={busy} onClick={() => { setWithheld(''); setNote(''); setPanel('withhold') }} style={btn()}>Withhold…</button>
            <button type="button" disabled={busy} onClick={() => { setNote(''); setPanel('forfeit') }} style={{ ...btn(), color: '#b91c1c', borderColor: 'rgba(185,28,28,0.35)' }}>Forfeit</button>
            <button type="button" disabled={busy} onClick={() => setPanel('none')} style={btn()}>Back</button>
          </>
        )}
        {order.status === 'out' && panel === 'withhold' && (
          <span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={withheld} onChange={(e) => setWithheld(e.target.value)} placeholder="Withhold $" inputMode="decimal" style={{ ...field, width: '6rem' }} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (required)" style={{ ...field, flex: '1 1 10rem' }} />
            <button type="button" disabled={busy || !withholdValid || !note.trim()} onClick={() => run(KIT_RETURN, { orderId: order.orderId, action: 'partial', withheldCents, note: note.trim() })} style={{ ...btn(true), opacity: !withholdValid || !note.trim() ? 0.5 : 1 }}>Refund {formatCents(partialRefund)}</button>
            <button type="button" disabled={busy} onClick={() => setPanel('return')} style={btn()}>Back</button>
          </span>
        )}
        {order.status === 'out' && panel === 'forfeit' && (
          <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Forfeit the whole {formatCents(deposit)} deposit? No refund.</span>
            <button type="button" disabled={busy} onClick={() => run(KIT_RETURN, { orderId: order.orderId, action: 'forfeit', note: note.trim() || undefined })} style={{ ...btn(), color: '#b91c1c', borderColor: 'rgba(185,28,28,0.35)' }}>Confirm forfeit</button>
            <button type="button" disabled={busy} onClick={() => setPanel('return')} style={btn()}>Back</button>
          </span>
        )}

        {canUndo && (
          <button type="button" disabled={busy} onClick={() => run(KIT_RETURN, { orderId: order.orderId, action: 'undo' })} style={btn()}>Undo</button>
        )}
      </div>
    </div>
  )
}

// Kinds come from EVENT_KIND_RE so a new kind can't drift; ids are slug-like only.
const OPEN_RE = new RegExp(`^(${EVENT_KIND_RE.source.replace(/^\^\(|\)\$$/g, '')}):([\\w-]+)$`)

/** Parse + strip `?open={kind}:{id}` from the address bar. */
function readOpenParam(): { kind: EventKind; id: string } | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('open')
    if (raw === null) return null
    params.delete('open')
    const qs = params.toString()
    history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
    const m = OPEN_RE.exec(raw)
    return m ? { kind: m[1] as EventKind, id: m[2] } : null
  } catch {
    return null
  }
}

export default function StaffConsole() {
  const [phase, setPhase] = useState<'checking' | 'login' | 'pick' | 'today' | 'upcoming' | 'roster' | 'kits' | 'giftcards'>('checking')
  // Which list a roster was opened from, so its Back and the active tab match.
  const [lastList, setLastList] = useState<'today' | 'upcoming'>('today')
  const [kitBuckets, setKitBuckets] = useState<KitBuckets | null>(null)
  const [radar, setRadar] = useState<RadarRow[]>([])
  const [assembly, setAssembly] = useState<KitAssembly | null>(null)
  const [passcode, setPasscode] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [staffRoster, setStaffRoster] = useState<StaffMember[]>([])
  const [me, setMe] = useState<StaffMember | null>(null)
  const [pickBusy, setPickBusy] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)
  const [pickAuthFailed, setPickAuthFailed] = useState(false)
  /** Which event's roster to show — any kind `getEvent`/`roster.json`
   *  resolves (party, workshop). `Roster` owns its own fetch/poll/state. */
  const [rosterTarget, setRosterTarget] = useState<{ kind: EventKind; id: string; addFamily?: { household?: HouseholdMatch } } | null>(null)
  const [netError, setNetError] = useState<string | null>(null)
  // The passcode lives only in memory for the length of this browser session —
  // "Switch" reuses it to re-pick an identity without asking again. A page
  // reload always starts back at the passcode screen (pick.json re-verifies it).
  const passcodeRef = useRef('')

  // `?open=` target, held until we know who's signed in (it may need a login first).
  const pendingOpen = useRef<{ kind: EventKind; id: string } | null>(null)
  function landOnToday() {
    const target = pendingOpen.current
    pendingOpen.current = null
    // A ?day in the address means someone was looking ahead: land back on Upcoming.
    if (target) { setRosterTarget(target); setPhase('roster') } else setPhase(readDayParam() ? 'upcoming' : 'today')
  }

  // Recover the signed-in staffer from the identity cookie on mount, so a
  // page reload lands back on Today instead of dropping to the passcode
  // screen. No cookie (or an expired one) falls through to login.
  useEffect(() => {
    pendingOpen.current = readOpenParam() ?? pendingOpen.current // ?? — StrictMode runs this twice; the 2nd read finds the param already stripped
    ;(async () => {
      try {
        const res = await fetch('/api/staff/me.json', { cache: 'no-store' })
        if (res.ok) {
          const json = await res.json()
          setMe(json.data.staff)
          // `/staff?open=party:abc` (the kiosk's return path after signing for an
          // event) goes straight to that roster, then drops the param so a
          // refresh or Back doesn't re-open it.
          landOnToday()
          return
        }
      } catch {
        // fall through to login
      }
      setPhase('login')
    })()
  }, [])

  async function doLogin() {
    setLoginError(null)
    const res = await fetch('/api/staff/login.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) })
    if (!res.ok) { setLoginError((await res.json().catch(() => null))?.error ?? 'Login failed.'); return }
    const json = await res.json()
    passcodeRef.current = passcode
    setStaffRoster(json.data.staff)
    setPasscode('')
    setPickError(null)
    setPhase('pick')
  }

  async function doPick(staffId: string) {
    setPickBusy(true)
    setPickError(null)
    setPickAuthFailed(false)
    try {
      const res = await fetch('/api/staff/pick.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcodeRef.current, staffId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setPickError(json?.error ?? 'Couldn’t sign in.')
        // Only a 401 (stale/changed passcode) is fixed by re-entering it —
        // a 429 (rate limit) or 503 (storage hiccup) isn't an auth problem.
        setPickAuthFailed(res.status === 401)
        setPickBusy(false)
        return
      }
      setMe(json.data.staff)
      setPickBusy(false)
      landOnToday()
    } catch {
      setPickError('Couldn’t reach the studio server — check wifi and try again.')
      setPickBusy(false)
    }
  }

  /** Back to the name grid without re-entering the passcode. Only works if
   *  the passcode is still in memory (this browser session logged in the
   *  normal way) — a session recovered from the cookie after a reload never
   *  saw the passcode, so Switch falls back to asking for it again. */
  function switchStaff() {
    setPickError(null)
    setPickAuthFailed(false)
    setPhase(passcodeRef.current ? 'pick' : 'login')
  }

  async function logout() {
    await fetch('/api/staff/login.json', { method: 'DELETE' })
    passcodeRef.current = ''
    setMe(null)
    setStaffRoster([])
    setRosterTarget(null)
    setPhase('login')
  }

  /** `assemblyWeek`: a Thursday to view, `null` to snap back to the current
   *  week, omitted to stay on whichever week is on screen (action refreshes). */
  async function loadKits(assemblyWeek?: string | null) {
    try {
      setNetError(null)
      const week = assemblyWeek === null ? undefined : assemblyWeek ?? assembly?.weekKey
      const url = week ? `/api/staff/kits.json?assemblyWeek=${week}` : '/api/staff/kits.json'
      const res = await fetch(url, { cache: 'no-store' })
      if (res.status === 401) { setPhase('login'); return }
      const json = await res.json()
      setKitBuckets(json.data.buckets)
      setRadar(json.data.radar ?? [])
      setAssembly(json.data.assembly ?? null)
      setPhase('kits')
    } catch {
      setNetError('Couldn’t reach the studio server — check wifi and tap Retry.')
    }
  }

  /** POST a kit action, then re-fetch so orders re-bucket. Returns any error. */
  async function kitAction(path: string, body: any): Promise<{ error?: string }> {
    // A refund that POSTed fine but failed to refresh must never read as "not saved" —
    // staff would retry a money action that already happened.
    let posted = false
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok) return { error: json?.error ?? 'Something went wrong.' }
      posted = true
      await loadKits()
      return {}
    } catch {
      return posted
        ? { error: 'Saved — but the list couldn’t refresh. Tap Kits again to reload.' }
        : { error: 'Couldn’t save — check wifi and try again.' }
    }
  }

  /** Today/EventList's row tap — opens that event's roster. Any kind
   *  `getEvent`/`roster.json` resolves (party, workshop) — HOM-213 replaced
   *  the party-only screen with a generalized one. */
  function openRoster(e: { kind: EventKind; id: string; title: string; addFamily?: { household?: HouseholdMatch } }) {
    if (phase === 'today' || phase === 'upcoming') setLastList(phase)
    setRosterTarget({ kind: e.kind, id: e.id, ...(e.addFamily ? { addFamily: e.addFamily } : {}) })
    setPhase('roster')
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

  if (phase === 'pick') {
    return (
      <PickStaff
        staff={staffRoster}
        busy={pickBusy}
        error={pickError}
        showBack={pickAuthFailed}
        onPick={doPick}
        onBack={() => { setPickError(null); setPickAuthFailed(false); setPhase('login') }}
      />
    )
  }

  if (!me) return null // 'today' / 'roster' / 'kits' all require a picked identity

  // Network error banner (kits phase only — Roster owns its own error
  // handling now, and Today owns its own per-section since its data comes
  // from several independent fetches, not one).
  const netErrorBanner = netError && (
    <div style={{ background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.3)', borderRadius: '0.6rem', padding: '0.7rem 0.9rem', marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
      <span style={{ flex: 1, fontSize: '0.875rem', color: '#b91c1c', fontWeight: 600 }}>{netError}</span>
      <button type="button" onClick={() => loadKits()} style={btn()}>Retry</button>
    </div>
  )

  const activeTab: StaffTab = phase === 'roster' ? lastList : phase === 'upcoming' || phase === 'kits' || phase === 'giftcards' ? phase : 'today'
  const nav: StaffNav = {
    active: activeTab,
    go: (tab) => {
      setRosterTarget(null)
      if (tab !== 'upcoming') writeDayParam(null) // ?day belongs to Upcoming
      if (tab === 'kits') { loadKits(); return }
      setPhase(tab)
    },
    switchStaff,
    logout,
  }
  const withNav = (node: ReactNode) => <StaffNavContext.Provider value={nav}>{node}</StaffNavContext.Provider>

  if (phase === 'today') {
    return withNav(<Today staff={me} onOpenRoster={openRoster} />)
  }

  if (phase === 'upcoming') {
    return withNav(<Upcoming staff={me} onOpenRoster={openRoster} />)
  }

  if (phase === 'giftcards') {
    return withNav(<GiftCards staff={me} />)
  }

  if (phase === 'roster' && rosterTarget) {
    return withNav(
      <Roster
        key={`${rosterTarget.kind}:${rosterTarget.id}`}
        staff={me}
        onBack={() => { setRosterTarget(null); setPhase(lastList) }}
        backLabel={lastList === 'upcoming' ? 'Upcoming' : 'Today'}
        kind={rosterTarget.kind}
        id={rosterTarget.id}
        addFamily={rosterTarget.addFamily}
      />,
    )
  }

  if (phase === 'kits') {
    // Operational order: what needs doing soonest comes first.
    const sections: [keyof KitBuckets, string][] = [
      ['pickupToday', 'Pickup today'],
      ['dueBackToday', 'Due back today'],
      ['overdue', 'Overdue'],
      ['missedPickup', 'Missed pickup'],
      ['awaiting', 'Awaiting pickup'],
      ['out', 'Out'],
      ['recentlySettled', 'Recently settled'],
    ]
    const empty = kitBuckets && sections.every(([k]) => kitBuckets[k].length === 0)
    return withNav(
      <div>
        <StaffHeader title="Kits" staff={me} />
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => loadKits()} style={btn()}>↻ Refresh</button>
        </div>
        {netErrorBanner}

        {/* Radar first — over-committed weeks need a human, now. */}
        {radar.length > 0 && (
          <div style={{ background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.35)', borderRadius: '0.8rem', padding: '0.8rem 1rem', marginBottom: '1rem' }}>
            <strong style={{ color: '#b91c1c', fontSize: '0.9rem' }}>⚠ Over-committed weeks</strong>
            {radar.map((r) => (
              <p key={`${r.themeId}-${r.weekKey}`} style={{ fontSize: '0.8125rem', color: '#b91c1c', margin: '0.35rem 0 0' }}>
                Week of {fmtDay(r.weekKey)}: {themeDisplay(r.themeId)} committed {r.committed}/{r.owned} — call somebody.
              </p>
            ))}
          </div>
        )}

        {/* Assembly worksheet — what to build for the pickup Thursday on screen.
            Rolls over to the next week automatically on Thursday morning. */}
        {assembly && (
          <section style={{ ...card, background: 'rgba(255,255,255,0.85)', marginBottom: '1.2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', fontSize: '1rem', margin: 0 }}>
                🔨 Assemble for pickup {fmtDay(assembly.weekKey)}{' '}
                <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>({assembly.orders.length})</span>
              </h3>
              <span style={{ display: 'inline-flex', gap: '0.4rem' }}>
                <button type="button" onClick={() => loadKits(addDays(assembly.weekKey, -7))} style={btn()} aria-label="Previous week">‹ Prev</button>
                {!assembly.isCurrent && (
                  <button type="button" onClick={() => loadKits(null)} style={btn()}>This week</button>
                )}
                <button type="button" onClick={() => loadKits(addDays(assembly.weekKey, 7))} style={btn()} aria-label="Next week">Next ›</button>
              </span>
            </div>

            {assembly.orders.length === 0 ? (
              <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem', margin: '0.6rem 0 0' }}>
                Nothing to assemble for this week{assembly.isCurrent ? ' yet' : ''}.
              </p>
            ) : (
              <>
                {/* Pull list — totals across the week, biggest first. */}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                  {assembly.craftTotals.map((c) => <Badge key={c.name} tone="muted">🎨 {c.name} ×{c.qty}</Badge>)}
                  {assembly.themeTotals.map((t) => <Badge key={t.label} tone="muted">🎀 {t.label} ×{t.count}</Badge>)}
                </div>

                {assembly.orders.map((o) => (
                  <div key={o.orderId} style={{ borderTop: '1px solid rgba(var(--color-primary-rgb),0.12)', marginTop: '0.7rem', paddingTop: '0.6rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-dark)', fontSize: '0.9rem' }}>{o.contact.name}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                        {o.status !== 'upcoming' && <strong style={{ color: 'var(--color-dark)' }}>{statusLabelFor(o)} · </strong>}
                        party {fmtDay(o.partyDate)} · #{o.reference}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                      {o.crafts.map((c) => (
                        <Badge key={c.craftId} tone={c.personalized ? 'alert' : 'muted'}>
                          {c.personalized ? '✏️ ' : ''}{c.name} ×{c.qty}
                        </Badge>
                      ))}
                      {o.theme
                        ? <Badge tone="muted">🎀 {themeDisplay(o.theme.themeId)} · serves {o.theme.serves}</Badge>
                        : <Badge tone="muted">Crafts only</Badge>}
                    </div>
                  </div>
                ))}
              </>
            )}
          </section>
        )}

        {empty && !netError && <p style={{ color: 'var(--color-muted)' }}>No kit orders yet.</p>}

        {kitBuckets && sections.map(([key, label]) => kitBuckets[key].length > 0 && (
          <section key={key} style={{ marginBottom: '1.2rem' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', fontSize: '1rem', margin: '0 0 0.6rem' }}>
              {label} <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>({kitBuckets[key].length})</span>
            </h3>
            {kitBuckets[key].map((o) => <KitOrderCard key={o.orderId} order={o} onAction={kitAction} />)}
          </section>
        ))}
      </div>,
    )
  }

  // 'roster' phase without a target (shouldn't normally happen) falls through
  // to nothing rather than crashing.
  return null
}
