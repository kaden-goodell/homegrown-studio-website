import { useEffect, useRef, useState } from 'react'
import { formatTime, formatMonthDay, formatMonthYear } from '@lib/studio-time'
import { card, btn, Badge } from '@components/staff/ui'
import PickupPanel from '@components/staff/PickupPanel'
import HistorySheet from '@components/staff/HistorySheet'
import type { EventKind } from '@lib/events'
import type { AuthorizedPickup } from '@lib/waiver-store'

export interface Presence {
  inAt: string
  outAt: string | null
}

/** Who collected one person, and when/which day (HOM-214). */
export interface Released {
  name: string
  at: string
  day: string
}

export interface Checkin {
  /** Person ids the family said are coming (RSVP). null = unspecified. */
  expected: string[] | null
  /** person id → presence, scoped to the roster's currently-selected day. */
  presence: Record<string, Presence>
  /** @deprecated legacy free-text note — see `releasedTo`. */
  pickedUpBy: string | null
  confirmedPickup: AuthorizedPickup[]
  notAuthorized: string
  hasPickupCode: boolean
  /** Consecutive wrong pickup-code attempts (HOM-214) — drives "N tries left". */
  codeAttempts: number
  /** True once 5 wrong attempts have locked code entry (HOM-214). */
  locked: boolean
  /** Who collected each already-released person, and when (HOM-214). */
  releasedTo: Record<string, Released>
}

export interface Household {
  recordId: string
  signer: string
  phone: string
  email: string
  children: { name: string; allergies: string; medications: string; duplicateOf?: string }[]
  childCount: number
  adultAllergies: string
  emergency: { name: string; phone: string; relationship: string }
  authorizedPickup: AuthorizedPickup[]
  notAuthorized: string
  responsibleAdult: string
  photoConsent: boolean
  signedAt: string
  agreementVersion: string
  validUntil: string
  /** Drop-off addendum version accepted for THIS event, or null if the
   *  household hasn't accepted one yet (HOM-213). */
  addendumVersion: string | null
  checkin: Checkin
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

type PersonState = 'here' | 'out' | 'absent'
export interface Person { id: string; icon: string; name: string; sub: string; allergies: string; medications?: string; isChild: boolean; duplicateOf?: string }

/**
 * One household's card on the roster: signer, phone, each person with a
 * check-in/pickup checkbox, allergy/medication badges, emergency contact,
 * the signature's validity line, and (for drop-off events) the addendum
 * status + pickup code machinery (HOM-213, HOM-212).
 */
export default function HouseholdCard({
  h,
  dropOff,
  kind,
  id,
  day,
  post,
}: {
  h: Household
  dropOff: boolean
  kind: EventKind
  id: string
  day: string
  post: (recordId: string, extra: any) => Promise<{ error?: string; oneTimeCode?: string; smsFailed?: boolean }>
}) {
  const people: Person[] = [
    { id: 'adult', icon: '👤', name: h.signer, sub: 'adult', allergies: h.adultAllergies, isChild: false },
    ...h.children.map((c, i) => ({ id: `child:${i}`, icon: '🧒', name: c.name, sub: '', allergies: c.allergies, medications: c.medications, isChild: true, duplicateOf: c.duplicateOf })),
  ]
  const presence = h.checkin.presence || {}
  const expected = h.checkin.expected
  const noPhoto = !h.photoConsent
  const anyAllergy = people.some((p) => p.allergies)
  const expired = new Date(h.validUntil).getTime() < Date.now()

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
  // Re-derives whenever the selected day changes (a new day's absent list).
  const [selIn, setSelIn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(people.map((p) => [
      p.id,
      p.duplicateOf ? false : (expected ? expected.includes(p.id) : true),
    ])),
  )
  // Checkout selection (present people) defaults to everyone here.
  const [selOut, setSelOut] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState<string | null>(null)
  const [sendState, setSendState] = useState<'idle' | 'busy' | 'sent' | 'failed'>('idle')
  // The freshly-issued pickup code (HOM-214): shown once, then hidden. Lives
  // here (not PickupPanel) because it's first set by the CHECK-IN action
  // above, and again by PickupPanel's own "Re-send code" — both write into
  // this same reveal so there's only ever one code on screen at a time.
  const [revealCode, setRevealCode] = useState<string | null>(null)
  const [smsFailed, setSmsFailed] = useState(false)
  // When the server retires the code (Reset, or the last child picked up), drop
  // any displayed plaintext — it's dead, and handing it to a parent would fail
  // at checkout.
  useEffect(() => {
    if (!h.checkin.hasPickupCode) setRevealCode(null)
  }, [h.checkin.hasPickupCode])
  // Two-tap reset guard
  const [resetPending, setResetPending] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Read-only custody-log sheet (HOM-217) — "History" button below.
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])

  const selectedIn = absentPeople.filter((p) => selIn[p.id]).map((p) => p.id)
  const selectedOut = herePeople.filter((p) => selOut[p.id] !== false).map((p) => p.id)
  const checkingOutChild = selectedOut.some((pid) => pid.startsWith('child:'))

  const border = status === 'in' ? 'rgb(34,197,94)' : status === 'out' ? 'rgba(120,120,120,0.4)' : 'rgba(150,112,91,0.3)'
  const bg = status === 'in' ? 'rgba(34,197,94,0.04)' : status === 'out' ? 'rgba(120,120,120,0.04)' : 'rgba(255,255,255,0.85)'

  async function act(extra: any) {
    setErr(null)
    const r = await post(h.recordId, { day, ...extra })
    if (r.error) setErr(r.error)
    else if (r.oneTimeCode) { setRevealCode(r.oneTimeCode); setSmsFailed(!!r.smsFailed) }
  }

  async function sendLink() {
    setSendState('busy')
    try {
      const res = await fetch('/api/staff/send-waiver-link.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: h.recordId, kind, id }),
      })
      const json = await res.json().catch(() => null)
      setSendState(res.ok && json?.data?.sent ? 'sent' : 'failed')
    } catch {
      setSendState('failed')
    }
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
      const releasedTo = h.checkin.releasedTo?.[p.id]
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.78rem', color: '#666', fontWeight: 700, whiteSpace: 'nowrap' }}>
            ✓ left {pr?.outAt ? formatTime(pr.outAt) : ''}{releasedTo?.name ? ` · ${releasedTo.name}` : ''}
          </span>
          <button type="button" onClick={() => act({ action: 'undo-pickup', personIds: [p.id] })} style={{ ...btn(), padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}>Undo</button>
        </span>
      )
    }
    if (expected == null) return null
    return expected.includes(p.id)
      ? <span style={{ fontSize: '0.7rem', color: 'rgb(21,128,61)', fontWeight: 700, whiteSpace: 'nowrap' }}>crafting</span>
      : <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>not crafting</span>
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

      {/* Signature validity — HOM-213 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0.3rem 0 0' }}>
          Signed {formatMonthDay(h.signedAt)} · {h.agreementVersion} ·{' '}
          {expired ? <span style={{ color: '#b91c1c', fontWeight: 700 }}>EXPIRED</span> : `valid to ${formatMonthYear(h.validUntil)}`}
        </p>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          style={{ ...btn(), padding: '0.2rem 0.5rem', fontSize: '0.7rem', color: 'var(--color-muted)' }}
        >
          🕘 History
        </button>
      </div>

      {/* Drop-off addendum status — HOM-211/213 */}
      {dropOff && (
        h.addendumVersion ? (
          <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0.15rem 0 0' }}>Addendum ✓</p>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.25rem 0 0', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: '#b91c1c', fontWeight: 700 }}>⚠ Addendum not signed</span>
            <button type="button" onClick={sendLink} disabled={sendState === 'busy'} style={{ ...btn(), padding: '0.25rem 0.55rem', fontSize: '0.7rem' }}>
              {sendState === 'sent' ? 'Sent!' : sendState === 'failed' ? 'Couldn’t send — retry' : sendState === 'busy' ? 'Sending…' : 'Send link'}
            </button>
          </div>
        )
      )}

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
                {p.medications && <Badge tone="muted" wrap>💊 {p.medications}</Badge>}
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
      {dropOff && h.notAuthorized && (
        <p style={{ fontSize: '0.8125rem', color: '#b91c1c', fontWeight: 700, margin: '0.5rem 0 0', background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.3)', borderRadius: '0.5rem', padding: '0.4rem 0.6rem' }}>
          ⛔ May NOT collect: {h.notAuthorized}
        </p>
      )}
      {dropOff && (
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0.4rem 0 0' }}>
          <strong style={{ color: 'var(--color-dark)' }}>Pickup:</strong>{' '}
          {h.authorizedPickup.length > 0
            ? h.authorizedPickup.map((p) => (p.phone ? `${p.name} · ${p.phone}` : p.name)).join(', ')
            : '— not provided —'}
        </div>
      )}

      {err && <p style={{ color: '#b91c1c', fontSize: '0.8125rem', marginTop: '0.5rem', fontWeight: 600 }}>{err}</p>}

      {/* Check-out — chips/code/override for drop-off, simple "collected by" otherwise (HOM-214) */}
      {herePeople.length > 0 && (
        <PickupPanel
          h={h}
          dropOff={dropOff}
          day={day}
          selectedOut={selectedOut}
          checkingOutChild={checkingOutChild}
          post={post}
          revealCode={revealCode}
          smsFailed={smsFailed}
          onCodeIssued={(codeVal, failed) => { setRevealCode(codeVal); setSmsFailed(failed) }}
        />
      )}

      {/* Reset — clears this family's whole day; two-tap guard, no native confirm */}
      {herePeople.length > 0 && (
        <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end' }}>
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

      {historyOpen && <HistorySheet h={h} kind={kind} id={id} onClose={() => setHistoryOpen(false)} />}
    </div>
  )
}
