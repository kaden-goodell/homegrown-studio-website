import { useEffect, useRef, useState } from 'react'
import DoorSearch, { signOnIpadForCafe, type HouseholdMatch } from '@components/staff/DoorSearch'
import QrModal from '@components/staff/QrModal'
import { card, btn, field, Badge } from '@components/staff/ui'
import { formatRange } from '@config/hours'
import { formatCalendarDay, formatTime, studioDate } from '@lib/studio-time'

/**
 * Craft Café as an event on /staff (Kaden, 2 Nov 2026: "so we can add people
 * to craft cafe if people show up. Would be good to track."):
 *
 *  - `CafeRow`: the tappable "☕ Craft Café 9 AM – 1 PM · 6 here" row on This
 *    week and Today.
 *  - `CraftCafeSheet`: that day's list — everyone checked in (family, who,
 *    when, who checked them in), totals, "Add someone", Undo, and "Waiting on
 *    a waiver" for new families who started signing. No waiver, no crafting:
 *    there is no way to count someone in without one.
 *  - `CafeAddPanel`: find a family on file and check them in, or start a new
 *    family on the waiver (on this iPad, by text, or by QR). Also the door's
 *    "What are they here for? › Craft Café".
 */

export interface CafeTotals { households: number; people: number; adults: number; kids: number }
export interface CafeEntry { recordId: string; name: string; people: string[]; at: string; by: string; adults: number; kids: number }
export interface CafeWaitingRow {
  id: string; name: string; how: 'ipad' | 'text' | 'qr'; at: string; by: string; signed: HouseholdMatch | null
  /** More than one signed family has this name: the crew search and pick. */
  signedMany?: number
  /** Their waiver text didn't send. */
  textFailed?: true
}
export interface CafeDay {
  date: string
  count: number
  /** The café's hours that day (same as `hours`), or null when it doesn't run. */
  cafe: { opens: string; closes: string } | null
  hours: { opens: string; closes: string } | null
  totals: CafeTotals
  isToday: boolean
  entries?: CafeEntry[]
  waiting?: CafeWaitingRow[]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "6 people · 2 adults · 4 kids · 3 families" */
export function totalsLine(t: CafeTotals): string {
  return [plural(t.people, 'person', 'people'), plural(t.adults, 'adult'), plural(t.kids, 'kid'), plural(t.households, 'family', 'families')].join(' · ')
}

/** The tappable Craft Café row (This week, Today). `here` is shown only when known (today). */
export function CafeRow({ date, hours, here, onOpen }: { date: string; hours: { opens: string; closes: string }; here?: number | null; onOpen: () => void }) {
  const range = formatRange(hours.opens, hours.closes)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Craft Café ${range}${typeof here === 'number' ? `, ${here} here` : ''}. Open the Craft Café list for ${formatCalendarDay(date)}`}
      style={{ ...card, background: 'rgba(255,255,255,0.85)', width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem', minHeight: '2.75rem' }}
    >
      <span style={{ fontWeight: 600, color: 'var(--color-dark)' }}>☕ Craft Café {range}</span>
      {typeof here === 'number' && <span data-testid="cafe-here" style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>{`· ${here} here`}</span>}
    </button>
  )
}

const HOW_LABEL: Record<CafeWaitingRow['how'], string> = { ipad: 'Signing on the iPad', text: 'Texted the link', qr: 'Scanning the QR' }

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init })
    const json = await res.json().catch(() => null)
    return res.ok ? { ok: true, data: json?.data } : { ok: false, error: json?.error ?? 'Something went wrong. Try again.' }
  } catch {
    return { ok: false, error: 'Couldn’t reach the studio server — check wifi and try again.' }
  }
}

/** New family at Craft Café: their name, then sign on this iPad, text them the link, or show the QR. */
function NewCafeFamily({ date, initialName, onBack, onStarted }: { date: string; initialName: string; onBack: () => void; onStarted: () => void }) {
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState<null | 'ipad' | 'text' | 'qr'>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [qr, setQr] = useState(false)
  const inFlight = useRef(false)
  const digits = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  const who = name.trim() || 'They'
  // One word and no mobile: the list can't spot their waiver once signed (Kim could be anyone).
  const firstNameOnly = name.trim().length >= 2 && name.trim().split(/\s+/).length === 1 && digits.length !== 10

  async function start(how: 'ipad' | 'text' | 'qr') {
    if (inFlight.current) return // a double tap never starts (or texts) twice
    inFlight.current = true
    setBusy(how)
    setError(null)
    setStatus(null)
    const r = await call('/api/staff/cafe-waiting.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ how, name: name.trim(), ...(how === 'text' ? { phone: digits } : {}) }),
    })
    inFlight.current = false
    setBusy(null)
    if (!r.ok) { setError(r.error ?? 'Something went wrong.'); return }
    onStarted()
    if (how === 'ipad') { signOnIpadForCafe(r.data.id, date); return }
    if (how === 'qr') { setQr(true); setStatus(`${who} ${name.trim() ? 'is' : 'are'} under Waiting on a waiver. Check them in once they’ve signed.`); return }
    // "Already texted" only when the earlier text actually went; a failed one is sent again.
    if (r.data.alreadySent) setStatus(`Already texted. ${who} ${name.trim() ? 'is' : 'are'} under Waiting on a waiver.`)
    else if (r.data.sent === false) setError('The text didn’t send. Tap Text them the waiver link to try again, or Show QR and let them scan it.')
    else setStatus(`✓ Texted the link. ${who} ${name.trim() ? 'is' : 'are'} under Waiting on a waiver — check them in once they’ve signed.`)
  }

  return (
    <div role="group" aria-label="New family" style={{ ...card, background: 'rgba(255,255,255,0.9)' }}>
      <button type="button" onClick={onBack} style={{ ...btn(), marginBottom: '0.8rem' }}>← Search families</button>
      <p style={{ margin: '0 0 0.6rem', fontWeight: 700, color: 'var(--color-dark)' }}>New family: they sign the waiver first</p>
      <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.6rem' }}>
        Their name
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="So you can find them once they’ve signed" style={{ ...field, width: '100%', boxSizing: 'border-box', marginTop: '0.25rem' }} />
      </label>
      {firstNameOnly && (
        <p role="note" data-testid="cafe-name-hint" style={{ margin: '-0.3rem 0 0.6rem', fontSize: '0.8125rem', color: 'rgb(180,83,9)', fontWeight: 600 }}>
          Add a last name or mobile so we can find their waiver.
        </p>
      )}
      <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.8rem' }}>
        Mobile number (only to text the link)
        <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="off" style={{ ...field, width: '100%', boxSizing: 'border-box', marginTop: '0.25rem' }} />
      </label>
      {error && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.6rem' }}>{error}</p>}
      {status && <p role="status" style={{ color: 'rgb(21,128,61)', fontSize: '0.875rem', fontWeight: 700, margin: '0 0 0.6rem' }}>{status}</p>}
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <button type="button" disabled={!!busy} onClick={() => start('ipad')} style={{ ...btn(true), minHeight: '3rem', opacity: busy ? 0.7 : 1 }}>{busy === 'ipad' ? 'Opening…' : 'Sign on this iPad'}</button>
        <button type="button" disabled={!!busy || digits.length !== 10 || name.trim().length < 2} onClick={() => start('text')} style={{ ...btn(), minHeight: '3rem', opacity: busy || digits.length !== 10 || name.trim().length < 2 ? 0.6 : 1 }}>{busy === 'text' ? 'Texting…' : 'Text them the waiver link'}</button>
        <button type="button" disabled={!!busy || name.trim().length < 2} onClick={() => start('qr')} style={{ ...btn(), minHeight: '3rem', opacity: busy || name.trim().length < 2 ? 0.6 : 1 }}>Show QR</button>
      </div>
      <p style={{ margin: '0.6rem 0 0', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
        Signing on this iPad checks them in when they finish. By text or QR, type their name first; they show under Waiting on a waiver until you check them in.
      </p>
      {qr && <QrModal onClose={() => setQr(false)} />}
    </div>
  )
}

/** Add someone to today's Craft Café: find a family on file, or start a new family on the waiver. */
export function CafeAddPanel({ date, onChanged }: { date: string; onChanged?: () => void }) {
  const [step, setStep] = useState<{ type: 'search' } | { type: 'new'; name: string }>({ type: 'search' })
  const [round, setRound] = useState(0)
  if (step.type === 'new') {
    return <NewCafeFamily date={date} initialName={step.name} onBack={() => { setStep({ type: 'search' }); setRound((n) => n + 1) }} onStarted={() => onChanged?.()} />
  }
  return (
    <div key={round}>
      <button type="button" onClick={() => setStep({ type: 'new', name: '' })} style={{ ...btn(), width: '100%', minHeight: '2.75rem', marginBottom: '1rem', fontWeight: 700 }}>
        ✍️ New family? Get them signed
      </button>
      <DoorSearch onCheckedIn={onChanged} onNewFamily={(typed) => setStep({ type: 'new', name: /\d|@/.test(typed) ? '' : typed })} />
    </div>
  )
}

/** "Undo" and "Remove" ask once, in the app (never a browser pop-up). */
function ConfirmInline({ question, yes, busy, onYes, onNo }: { question: string; yes: string; busy: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div role="group" aria-label={question} style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.875rem', color: 'var(--color-dark)', fontWeight: 600 }}>{question}</span>
      <button type="button" disabled={busy} onClick={onYes} style={{ ...btn(true), background: '#b91c1c', opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : yes}</button>
      <button type="button" disabled={busy} onClick={onNo} style={btn()}>Keep</button>
    </div>
  )
}

const POLL_MS = 30_000

/** One day of Craft Café: who's here, totals, Add someone, Undo, and Waiting on a waiver. */
export function CraftCafeSheet({ date, onClose }: { date: string; onClose: () => void }) {
  const [day, setDay] = useState<CafeDay | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [asking, setAsking] = useState<string | null>(null) // "undo:<recordId>" | "remove:<id>"
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [checkingIn, setCheckingIn] = useState<CafeWaitingRow | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const isToday = date === studioDate(new Date().toISOString())

  async function load(quiet = false) {
    const r = await call(`/api/staff/open-studio.json?date=${date}&detail=1`)
    if (r.ok) { setDay(r.data); setError(null) } else if (!quiet) setError(r.error ?? 'Couldn’t load Craft Café.')
  }
  useEffect(() => {
    load()
    closeRef.current?.focus()
    const t = setInterval(() => load(true), POLL_MS)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { clearInterval(t); window.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  async function act(url: string) {
    if (busy) return
    setBusy(true)
    setActionError(null)
    const r = await call(url, { method: 'DELETE' })
    setBusy(false)
    if (!r.ok) { setActionError(r.error ?? 'That didn’t save. Try again.'); return }
    setAsking(null)
    load(true)
  }

  const hours = day?.hours ?? null
  const entries = day?.entries ?? []
  const waiting = day?.waiting ?? []
  const future = !isToday && date > studioDate(new Date().toISOString())

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Craft Café, ${formatCalendarDay(date)}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', justifyContent: 'flex-end', background: 'rgba(0, 0, 0, 0.4)' }}
    >
      <div style={{
        width: '100%', maxWidth: '30rem', height: '100%', overflowY: 'auto', padding: '1.25rem 1.25rem 2rem', boxSizing: 'border-box',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(255,255,255,0.96) 100%)', boxShadow: '-12px 0 40px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.6rem' }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>☕ Craft Café</h3>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.875rem', color: 'var(--color-muted)' }}>
              {isToday ? `Today · ${formatCalendarDay(date)}` : formatCalendarDay(date)}{hours ? ` · ${formatRange(hours.opens, hours.closes)}` : day && !day.cafe ? ' · not a café day' : ''}
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" style={{ ...btn(), padding: '0.35rem 0.6rem' }}>✕</button>
        </div>

        {error && (
          <div role="alert" style={{ ...card, background: 'rgba(255,255,255,0.85)' }}>
            <p style={{ margin: '0 0 0.5rem', color: 'var(--color-error, #b91c1c)' }}>{error}</p>
            <button type="button" onClick={() => load()} style={btn()}>Retry</button>
          </div>
        )}
        {!day && !error && <p style={{ color: 'var(--color-muted)' }}>Loading…</p>}

        {day && (
          <>
            <p data-testid="cafe-totals" style={{ margin: '0 0 1rem', fontWeight: 700, color: 'var(--color-dark)' }}>
              {day.totals.people === 0 ? (isToday ? 'No one checked in yet.' : future ? 'Check-ins open on the day.' : 'No one was checked in.') : `${isToday ? 'Here today' : 'Came'}: ${totalsLine(day.totals)}`}
            </p>

            {isToday && (adding
              ? (
                <section aria-label="Add someone" style={{ marginBottom: '1rem' }}>
                  <button type="button" onClick={() => setAdding(false)} style={{ ...btn(), marginBottom: '0.8rem' }}>Done adding</button>
                  <CafeAddPanel date={date} onChanged={() => load(true)} />
                </section>
              )
              : <button type="button" onClick={() => { setAdding(true); setCheckingIn(null) }} style={{ ...btn(true), width: '100%', minHeight: '3rem', marginBottom: '1rem' }}>+ Add someone</button>)}

            {actionError && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.875rem', fontWeight: 600 }}>{actionError}</p>}

            {isToday && waiting.length > 0 && (
              <section aria-label="Waiting on a waiver" style={{ marginBottom: '1rem' }}>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-primary)' }}>Waiting on a waiver ({waiting.length})</h4>
                {waiting.map((w) => (
                  <div key={w.id} style={{ ...card, background: w.signed ? 'rgba(34,197,94,0.05)' : 'rgba(217,119,6,0.05)', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-dark)' }}>{w.name}</span>
                      {w.signed ? <Badge tone="muted">✓ Signed</Badge> : <Badge tone="warn">Not signed yet</Badge>}
                    </div>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>{`${HOW_LABEL[w.how]} · ${formatTime(w.at)}${w.by ? ` · ${w.by}` : ''}`}</p>
                    {w.textFailed && !w.signed && <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: '#b91c1c', fontWeight: 600 }}>The text didn’t send. Text them again, or show them the QR.</p>}
                    {!w.signed && (w.signedMany ?? 0) > 1 && (
                      <p data-testid="cafe-signed-many" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--color-dark)', fontWeight: 600 }}>
                        {`${w.signedMany} families named ${w.name} have signed. Tap + Add someone and search to pick the right one.`}
                      </p>
                    )}
                    {!w.signed && !w.signedMany && w.how === 'ipad' && Date.now() - Date.parse(w.at) > 10 * 60_000 && (
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Finished signing? Find them with + Add someone.</p>
                    )}
                    {checkingIn?.id === w.id && w.signed ? (
                      <div style={{ marginTop: '0.6rem' }}>
                        <DoorSearch initialHousehold={w.signed} cafeWaitingId={w.id} onCheckedIn={() => { setCheckingIn(null); load(true) }} />
                        <button type="button" onClick={() => setCheckingIn(null)} style={btn()}>Not now</button>
                      </div>
                    ) : asking === `remove:${w.id}` ? (
                      <ConfirmInline question={`Take ${w.name} off this list?`} yes="Take off" busy={busy} onYes={() => act(`/api/staff/cafe-waiting.json?id=${encodeURIComponent(w.id)}`)} onNo={() => setAsking(null)} />
                    ) : (
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        {w.signed && <button type="button" onClick={() => { setCheckingIn(w); setAdding(false) }} style={btn(true)}>Check them in</button>}
                        <button type="button" onClick={() => setAsking(`remove:${w.id}`)} style={btn()}>Remove</button>
                      </div>
                    )}
                  </div>
                ))}
                <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-muted)' }}>No waiver, no crafting. Once they’ve signed, tap Check them in.</p>
              </section>
            )}

            {entries.length > 0 && (
              <section aria-label={isToday ? 'Checked in' : 'Who came'}>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-primary)' }}>{isToday ? 'Checked in' : 'Who came'} ({entries.length})</h4>
                {entries.map((e) => (
                  <div key={e.recordId} data-testid="cafe-entry" style={{ ...card, background: 'rgba(255,255,255,0.85)', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-dark)' }}>{e.name}</span>
                      <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>{plural(e.adults + e.kids, 'person', 'people')}</span>
                    </div>
                    {e.people.length > 0 && <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--color-dark)' }}>{e.people.join(', ')}</p>}
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>{`${formatTime(e.at)}${e.by ? ` · checked in by ${e.by}` : ''}`}</p>
                    {isToday && (asking === `undo:${e.recordId}`
                      ? <ConfirmInline question={`Take ${e.name} off today’s list?`} yes="Take off" busy={busy} onYes={() => act(`/api/staff/open-studio.json?recordId=${encodeURIComponent(e.recordId)}`)} onNo={() => setAsking(null)} />
                      : <button type="button" onClick={() => setAsking(`undo:${e.recordId}`)} aria-label={`Undo ${e.name}’s check-in`} style={{ ...btn(), marginTop: '0.5rem' }}>Undo</button>)}
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** `?cafe=YYYY-MM-DD` (the iPad coming back from a café waiver): read and strip it. */
export function readCafeParam(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('cafe')
    if (raw === null) return null
    params.delete('cafe')
    const qs = params.toString()
    history.replaceState(history.state, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
  } catch {
    return null
  }
}
