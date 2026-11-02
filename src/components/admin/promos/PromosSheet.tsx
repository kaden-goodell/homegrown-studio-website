/**
 * More › Promotions (stage 4, Task 6): codes that take money off class seats.
 *
 *   PromosSheet   the list ("10% off · every class · ends Mon Nov 30 · 3 of 20 used") and + New code
 *   PromoSheet    one code (`#promo-FALLFRIENDS`, `#promo-new`): what it does, who used it,
 *                 Give this use back, Turn off / on, Edit
 *   PromoForm     make or edit a code in a few taps
 *
 * Built for Catherine on an iPad: plain words, one sheet at a time, every
 * confirm in the sheet (never a browser dialog), and a clear warning before a
 * code that makes bookings free goes out with no use limit (review M4).
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PromoChoice, PromoGivenBackView, PromoUseView, PromoView } from '@pages/api/admin/promos.json'
import type { PromoFields } from '@lib/promos/types'
import { couldBeFree, describePromo, forWhat, promoState, usesText, validatePromo } from '@lib/promos/rules'
import { formatMoney } from '@lib/money'
import { localDate } from '@lib/party-slots'
import { api, PROMOS } from '../classes/api'
import { dayLabel, today } from '../classes/dates'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheet, useSheetDirty } from '../shell/Sheet'
import { DIDNT_SAVE, useToast } from '../shell/Toast'
import { useRefresh } from '../shell/data'

const STATE_TAG = { off: 'Off', ended: 'Ended', 'used-up': 'Used up', on: '' } as const

/** "Sat Oct 24" for a moment. */
const whenOf = (iso: string) => dayLabel(localDate(iso))

/** A label, its box, a hint under it and the box's own error. */
function Field({ label, hint, error, field, children }: { label: string; hint?: ReactNode; error?: string; field: string; children: (ids: { describedBy?: string; invalid?: boolean }) => ReactNode }) {
  const hintId = useId()
  const errId = useId()
  const describedBy = [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className="adm-fldwrap" data-field={field}>
      <label className={`adm-fld${hint ? ' has-hint' : ''}`}>
        <span>{label}</span>
        {children({ describedBy, invalid: !!error })}
      </label>
      {hint && <small id={hintId} className="adm-hint">{hint}</small>}
      {error && <p id={errId} role="alert" className="adm-error adm-fielderr">{error}</p>}
    </div>
  )
}

// ── The list ────────────────────────────────────────────────────────────

/** More › Promotions: every code, newest decisions first (working codes on top), and + New code. */
export function PromosSheet() {
  const { open } = useSheet()
  const [data, setData] = useState<{ codes: PromoView[]; names: Record<string, string> } | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    api<{ codes: PromoView[]; names: Record<string, string> }>(PROMOS).then((r) => {
      if (!live) return
      if (r.ok && r.data) setData(r.data)
      else setError(r.error ?? '')
    })
    return () => { live = false }
  }, [tries])
  const now = new Date()
  const order = { on: 0, 'used-up': 1, ended: 2, off: 3 } as const
  const codes = data ? [...data.codes].sort((a, b) => order[promoState(a, now)] - order[promoState(b, now)] || a.code.localeCompare(b.code)) : []
  const working = codes.filter((c) => promoState(c, now) === 'on').length
  return (
    <SheetFrame
      tall
      title="Promotions"
      subtitle={data ? (codes.length ? `${working} working · ${codes.length} in all` : 'No codes yet') : 'Codes for money off classes'}
      footer={<button type="button" className="adm-btn is-pri" onClick={() => open({ kind: 'promo', id: 'new' })}>+ New code</button>}
    >
      <p className="adm-note">Customers type a code when they pay for a class, online or on the iPad at the door. The money comes off their seats.</p>
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !data && <Skeleton rows={3} label="Loading the codes" />}
      {data && codes.length === 0 && <p className="adm-empty">No codes yet. Make one with + New code.</p>}
      {codes.length > 0 && (
        <ul className="adm-mlist" aria-label="Codes">
          {codes.map((p) => {
            const state = promoState(p, now)
            return (
              <li key={p.code}>
                <button type="button" className="adm-mrow" onClick={() => open({ kind: 'promo', id: p.code })}>
                  <span className="adm-rm">
                    <b>{p.code}</b>
                    <small>{`${describePromo(p, data!.names)} · ${usesText(p)}`}</small>
                  </span>
                  {STATE_TAG[state] && <span className="adm-tag is-grey">{STATE_TAG[state]}</span>}
                  <span className="adm-chev" aria-hidden="true">›</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="adm-small adm-muted">Early-bird prices are set on each class, under its price.</p>
    </SheetFrame>
  )
}

// ── One code ────────────────────────────────────────────────────────────

interface OneCode { code: PromoView; names: Record<string, string>; uses: PromoUseView[]; givenBack: PromoGivenBackView[] }

/** `#promo-<CODE>` (one code) or `#promo-new` (the form). */
export function PromoSheet({ id }: { id: string }) {
  if (id === 'new') return <PromoForm />
  return <PromoDetail code={id} />
}

function PromoDetail({ code }: { code: string }) {
  const { open } = useSheet()
  const toast = useToast()
  const { bump } = useRefresh()
  const [d, setD] = useState<OneCode | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  useEffect(() => {
    let live = true
    setError('')
    api<OneCode>(`${PROMOS}?code=${encodeURIComponent(code)}`).then((r) => {
      if (!live) return
      if (r.ok && r.data) setD(r.data)
      else setError(r.error ?? '')
    })
    return () => { live = false }
  }, [code, tries])

  if (editing && d) {
    return <PromoForm existing={d.code} onSaved={(saved) => { setD({ ...d, code: saved }); setEditing(false) }} onCancel={() => setEditing(false)} />
  }

  async function setActive(active: boolean, from: PromoView, undoable = true) {
    setBusy(true)
    setActionError('')
    const r = await api<{ code: PromoView }>(PROMOS, { action: 'active', code: from.code, active, expectedUpdatedAt: from.updatedAt })
    setBusy(false)
    if (!r.ok || !r.data) {
      if (r.status === 409) { setTries((n) => n + 1); setActionError('Someone changed this code just now. Check it, then try again.'); return }
      setActionError(r.error ?? DIDNT_SAVE)
      return
    }
    const saved = r.data.code
    setD((cur) => (cur ? { ...cur, code: saved } : cur))
    bump()
    toast(active ? `${saved.code} is on. Customers can use it.` : `${saved.code} is off. Nobody can use it now.`,
      undoable ? { undo: () => { void setActive(!active, saved, false) } } : undefined)
  }

  async function giveBack(bookingId: string) {
    if (!d) return
    setBusy(true)
    setActionError('')
    const r = await api<{ code: PromoView; uses: PromoUseView[]; givenBack: PromoGivenBackView[] }>(PROMOS, { action: 'give-back', code: d.code.code, bookingId })
    setBusy(false)
    setAsking(null)
    if (!r.ok || !r.data) { setActionError(r.error ?? DIDNT_SAVE); if (r.status === 409) setTries((n) => n + 1); return }
    setD({ ...d, ...r.data })
    bump()
    toast(`Use given back. ${d.code.code} works once more.`)
  }

  const p = d?.code
  const now = new Date()
  const state = p ? promoState(p, now) : 'on'
  const footer = p
    ? (
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
        {p.active
          ? <button type="button" className="adm-btn is-danger" disabled={busy} onClick={() => setActive(false, p)}>Turn off</button>
          : <button type="button" className="adm-btn is-pri" disabled={busy} onClick={() => setActive(true, p)}>Turn on</button>}
      </div>
    )
    : undefined
  return (
    <SheetFrame
      tall
      title={p ? p.code : code}
      subtitle={p ? <>{usesText(p)}{STATE_TAG[state] && <span className="adm-tag is-grey">{STATE_TAG[state]}</span>}</> : 'Promotion'}
      footer={footer}
    >
      <button type="button" className="adm-btn is-ghost is-sm" onClick={() => open({ kind: 'more', page: 'promos' })}>‹ All codes</button>
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !d && <Skeleton rows={4} label="Loading the code" />}
      {p && d && (
        <>
          <p className="adm-lbl">What it does</p>
          <div className="adm-kv"><span>Money off</span><span>{p.off.kind === 'percent' ? `${p.off.percent}% off` : `${formatMoney(p.off.cents)} off ${p.per === 'seat' ? 'each person' : 'the whole booking'}`}</span></div>
          <div className="adm-kv"><span>For</span><span>{p.appliesTo.kind === 'all' ? 'Every class' : forWhatList(p, d.names)}</span></div>
          <div className="adm-kv"><span>Extras</span><span>{p.includeExtras ? 'Comes off extras too' : 'Seats only'}</span></div>
          <div className="adm-kv"><span>Last day</span><span>{p.endsYmd ? `${dayLabel(p.endsYmd)}, until midnight` : 'No end'}</span></div>
          <div className="adm-kv"><span>Use limit</span><span>{p.maxUses === null ? 'No limit' : `${p.maxUses} booking${p.maxUses === 1 ? '' : 's'}`}</span></div>
          <div className="adm-kv"><span>On or off</span><span>{p.active ? 'On' : 'Off'}</span></div>
          {p.label && <div className="adm-kv"><span>Your note</span><span>{p.label}</span></div>}
          <p className="adm-small adm-muted">{`Made by ${p.by.name}${p.createdAt ? ` on ${whenOf(p.createdAt)}` : ''}.`}</p>
          {state === 'ended' && <p className="adm-note">This code has ended. To use it again, Edit and pick a new last day.</p>}
          {state === 'used-up' && <p className="adm-note">Every use is taken. To let more people use it, Edit and raise the use limit.</p>}
          {actionError && <p className="adm-error" role="alert">{actionError}</p>}

          <p className="adm-lbl">{`Who used it (${d.uses.length})`}</p>
          {d.uses.length === 0 && <p className="adm-empty">Nobody yet.</p>}
          {d.uses.map((u) => (
            <div key={u.bookingId} className="adm-card adm-promo-use">
              <div className="adm-bk">
                <div className="adm-rm">
                  <b>{u.who}</b>
                  <small>{`${u.className} · used ${whenOf(u.at)}${u.seats > 1 ? ` · ${u.seats} seats` : ''}`}</small>
                </div>
                {u.cancelled && <span className="adm-tag is-grey">Refunded</span>}
              </div>
              {p.maxUses !== null && (asking === u.bookingId
                ? (
                  <div className="adm-panel" role="group" aria-label={`Give ${u.who}’s use back?`}>
                    <b>{`Give ${u.who}’s use back?`}</b>
                    <span className="adm-small">{`${p.code} then works one more time.`}</span>
                    <div className="adm-two">
                      <button type="button" className="adm-btn is-ghost" disabled={busy} onClick={() => setAsking(null)}>Keep it used</button>
                      <button type="button" className="adm-btn is-pri" disabled={busy} onClick={() => giveBack(u.bookingId)}>{busy ? 'Giving it back…' : 'Give it back'}</button>
                    </div>
                  </div>
                )
                : <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setAsking(u.bookingId)}>Give this use back</button>)}
            </div>
          ))}
          {p.maxUses !== null && d.uses.length > 0 && (
            <p className="adm-small adm-muted">A refund doesn’t give a use back by itself. If someone with a one-time code cancels, give their use back so they can book again.</p>
          )}
          {d.givenBack.length > 0 && (
            <>
              <p className="adm-lbl">{`Given back (${d.givenBack.length})`}</p>
              {d.givenBack.map((g) => (
                <div key={`${g.bookingId}-${g.at}`} className="adm-kv"><span>{`${g.who} · ${g.className}`}</span><span>{`by ${g.by}, ${whenOf(g.at)}`}</span></div>
              ))}
            </>
          )}
        </>
      )}
    </SheetFrame>
  )
}

/** Every picked class by name, one per line's worth: "Clay Camp (every date), Looms · Sat Oct 24". */
function forWhatList(p: PromoView, names: Record<string, string>): string {
  if (p.appliesTo.kind !== 'classes') return forWhat(p, names)
  const all = [...p.appliesTo.libraryIds.map((id) => (names[id] ? `${names[id]} (every date)` : '')), ...p.appliesTo.classIds.map((id) => names[id] ?? '')]
  const known = all.filter(Boolean)
  const gone = all.length - known.length
  return [...known, gone ? `${gone} class${gone === 1 ? '' : 'es'} no longer listed` : ''].filter(Boolean).join(', ')
}

// ── The form ────────────────────────────────────────────────────────────

interface Draft {
  code: string
  label: string
  offKind: 'amount' | 'percent'
  amount: string
  per: 'booking' | 'seat'
  scope: 'all' | 'classes'
  libraryIds: string[]
  classIds: string[]
  includeExtras: boolean
  endsYmd: string
  maxUses: string
  active: boolean
}
type DraftErrors = Partial<Record<'code' | 'label' | 'off' | 'appliesTo' | 'endsYmd' | 'maxUses' | 'form', string>>
const FIELD_ORDER = ['code', 'off', 'appliesTo', 'endsYmd', 'maxUses', 'label'] as const

const MONEY_RE = /^\d+(\.\d{1,2})?$/

function draftOf(p?: PromoView): Draft {
  if (!p) return { code: '', label: '', offKind: 'percent', amount: '', per: 'booking', scope: 'all', libraryIds: [], classIds: [], includeExtras: false, endsYmd: '', maxUses: '', active: true }
  return {
    code: p.code, label: p.label,
    offKind: p.off.kind, amount: p.off.kind === 'percent' ? String(p.off.percent) : (p.off.cents % 100 === 0 ? String(p.off.cents / 100) : (p.off.cents / 100).toFixed(2)),
    per: p.per, scope: p.appliesTo.kind,
    libraryIds: p.appliesTo.kind === 'classes' ? [...p.appliesTo.libraryIds] : [],
    classIds: p.appliesTo.kind === 'classes' ? [...p.appliesTo.classIds] : [],
    includeExtras: p.includeExtras, endsYmd: p.endsYmd ?? '', maxUses: p.maxUses === null ? '' : String(p.maxUses), active: p.active,
  }
}

/** The draft as what the server saves, or what to fix (the same rules the server uses). */
function fieldsOf(d: Draft, isNew: boolean): { ok: true; fields: PromoFields } | { ok: false; errors: DraftErrors } {
  const amount = d.amount.trim().replace(/^\$/, '').replace(/%$/, '')
  if (!amount) return { ok: false, errors: { off: d.offKind === 'percent' ? 'Type the percent off, like 10.' : 'Type the dollars off, like 5.' } }
  if (d.offKind === 'amount' && !MONEY_RE.test(amount)) return { ok: false, errors: { off: 'Dollars off is an amount, like 5 or 2.50.' } }
  const max = d.maxUses.trim()
  const raw = {
    code: d.code, label: d.label,
    off: d.offKind === 'percent' ? { kind: 'percent', percent: Number(amount) } : { kind: 'amount', cents: Math.round(parseFloat(amount) * 100) },
    per: d.per,
    appliesTo: d.scope === 'all' ? { kind: 'all' } : { kind: 'classes', libraryIds: d.libraryIds, classIds: d.classIds },
    includeExtras: d.includeExtras,
    endsYmd: d.endsYmd || null,
    maxUses: max ? (/^\d+$/.test(max) ? Number(max) : NaN) : null,
    active: d.active,
  }
  const v = validatePromo(raw, isNew ? { todayYmd: today() } : {})
  if (!v.ok) return { ok: false, errors: { [(v.field ?? 'form') as keyof DraftErrors]: v.error } }
  return { ok: true, fields: v.value }
}

/** Make a code (no `existing`) or edit one. */
export function PromoForm({ existing, onSaved, onCancel }: { existing?: PromoView; onSaved?: (p: PromoView) => void; onCancel?: () => void }) {
  const { open } = useSheet()
  const toast = useToast()
  const { bump } = useRefresh()
  const isNew = !existing
  const [start] = useState(() => draftOf(existing))
  const [d, setD] = useState<Draft>(start)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [saving, setSaving] = useState(false)
  const [askLimit, setAskLimit] = useState(false)
  const [choices, setChoices] = useState<PromoChoice[] | null>(null)
  const [choicesError, setChoicesError] = useState('')
  const [find, setFind] = useState('')
  const body = useRef<HTMLDivElement>(null)
  const limitBox = useRef<HTMLInputElement>(null)
  useSheetDirty(JSON.stringify(d) !== JSON.stringify(start))
  const patch = (p: Partial<Draft>) => { setD((cur) => ({ ...cur, ...p })); setAskLimit(false) }

  useEffect(() => {
    let live = true
    api<{ choices: PromoChoice[] }>(PROMOS).then((r) => {
      if (!live) return
      if (r.ok && r.data) setChoices(r.data.choices)
      else setChoicesError(r.error ?? 'The classes didn’t load.')
    })
    return () => { live = false }
  }, [])

  // M4: a code that could make bookings free, with no use limit.
  const amountNow = d.amount.trim().replace(/^\$/, '').replace(/%$/, '')
  const offNow = d.offKind === 'percent' ? { kind: 'percent' as const, percent: Number(amountNow) || 0 } : { kind: 'amount' as const, cents: Math.round((parseFloat(amountNow) || 0) * 100) }
  const free = couldBeFree(offNow)
  const risky = !!free && !d.maxUses.trim()
  const freeWords = free === 'free' ? 'Anyone with this code books for free.' : 'Anyone with this code may book for free.'

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase()
    const list = choices ?? []
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list
  }, [choices, find])
  const picked = d.libraryIds.length + d.classIds.length

  function focusFirst(e: DraftErrors) {
    const k = FIELD_ORDER.find((f) => e[f])
    if (!k) return
    requestAnimationFrame(() => {
      const area = body.current?.querySelector<HTMLElement>(`[data-field="${k}"]`)
      area?.scrollIntoView?.({ block: 'center' })
      ;(area?.querySelector<HTMLElement>('input') ?? area?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true })
    })
  }

  async function save(withoutLimit = false) {
    const b = fieldsOf(d, isNew)
    if (!b.ok) { setErrors(b.errors); focusFirst(b.errors); return }
    if (risky && !withoutLimit) { setErrors({}); setAskLimit(true); return }
    setErrors({})
    setAskLimit(false)
    setSaving(true)
    const r = await api<{ code: PromoView }>(PROMOS, { action: 'save', fields: b.fields, expectedUpdatedAt: existing ? existing.updatedAt : null })
    setSaving(false)
    if (!r.ok || !r.data) {
      const field = (r.extra.field as keyof DraftErrors | undefined) ?? 'form'
      const e = { [field]: r.error ?? DIDNT_SAVE } as DraftErrors
      setErrors(e)
      if (field !== 'form') focusFirst(e)
      else toast(DIDNT_SAVE)
      return
    }
    const saved = r.data.code
    bump()
    toast(isNew ? `${saved.code} is ready. Customers can type it when they pay.` : `${saved.code} saved.`)
    if (onSaved) onSaved(saved)
    else open({ kind: 'promo', id: saved.code })
  }

  function setLimitNow() {
    setAskLimit(false)
    requestAnimationFrame(() => { limitBox.current?.scrollIntoView?.({ block: 'center' }); limitBox.current?.focus() })
  }

  const toggle = (kind: 'library' | 'class', id: string, on: boolean) => {
    const key = kind === 'library' ? 'libraryIds' : 'classIds'
    setD((cur) => ({ ...cur, [key]: on ? [...cur[key], id] : cur[key].filter((x) => x !== id) }))
  }

  const footer = askLimit
    ? (
      <div className="adm-panel is-warn" role="group" aria-label="Save with no use limit?">
        <b>{`${freeWords} Save it with no use limit?`}</b>
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={setLimitNow}>Set a use limit</button>
          <button type="button" className="adm-btn is-danger" disabled={saving} onClick={() => save(true)}>Save with no limit</button>
        </div>
      </div>
    )
    : (
      <div className="adm-two">
        {onCancel && <button type="button" className="adm-btn is-ghost" onClick={onCancel}>Cancel</button>}
        <button type="button" className="adm-btn is-pri" disabled={saving} onClick={() => save()}>{saving ? 'Saving…' : isNew ? 'Make the code' : 'Save'}</button>
      </div>
    )

  return (
    <SheetFrame tall title={isNew ? 'New code' : `Edit ${existing!.code}`} subtitle="Money off class seats" footer={footer}>
      <div ref={body}>
        {errors.form && <p className="adm-error" role="alert">{errors.form}</p>}
        {isNew
          ? (
            <Field label="Code" field="code" error={errors.code}
              hint={risky ? 'Make it hard to guess. Not FREE or GIFT.' : 'Letters and numbers, 3 to 20. Customers type it when they pay.'}>
              {({ describedBy, invalid }) => (
                <input value={d.code} maxLength={30} autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
                  placeholder="Like FALLFRIENDS" aria-describedby={describedBy} aria-invalid={invalid || undefined}
                  onChange={(e) => patch({ code: e.target.value.toUpperCase() })} />
              )}
            </Field>
          )
          : (
            <div className="adm-fldwrap" data-field="code">
              <div className="adm-kv"><span>Code</span><span><b>{existing!.code}</b></span></div>
              <small className="adm-hint">A code can’t be renamed. Make a new code instead.</small>
            </div>
          )}

        <div data-field="off">
          <Seg label="Money off" value={d.offKind} options={[['percent', '% off'], ['amount', '$ off']]} onChange={(offKind) => patch({ offKind })} />
          <Field label={d.offKind === 'percent' ? 'Percent off' : 'Dollars off ($)'} field="off-amount" error={errors.off}
            hint={d.offKind === 'percent' ? '100 makes the class free.' : undefined}>
            {({ describedBy, invalid }) => (
              <input inputMode={d.offKind === 'percent' ? 'numeric' : 'decimal'} value={d.amount} placeholder={d.offKind === 'percent' ? '10' : '5'}
                aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => patch({ amount: e.target.value })} />
            )}
          </Field>
          {d.offKind === 'amount' && (
            <Seg label="Off each person or the whole booking" value={d.per} options={[['booking', 'Whole booking'], ['seat', 'Each person']]} onChange={(per) => patch({ per })} />
          )}
        </div>

        <div data-field="appliesTo">
          <p className="adm-lbl">For</p>
          <Seg label="Which classes" value={d.scope} options={[['all', 'Every class'], ['classes', 'Pick classes']]} onChange={(scope) => patch({ scope })} />
          {errors.appliesTo && <p role="alert" className="adm-error adm-fielderr">{errors.appliesTo}</p>}
          {d.scope === 'classes' && (
            <div className="adm-promo-pick">
              <label className="adm-fld">
                <span>Find a class</span>
                <input type="search" value={find} placeholder="Type part of the name" onChange={(e) => setFind(e.target.value)} />
              </label>
              <p className="adm-small adm-muted" aria-live="polite">{picked ? `${picked} picked` : 'None picked yet'}</p>
              {choicesError && <p className="adm-error" role="alert">{choicesError}</p>}
              {!choices && !choicesError && <Skeleton rows={2} label="Loading the classes" />}
              {choices && shown.length === 0 && <p className="adm-empty">{find ? 'No class by that name.' : 'No classes yet.'}</p>}
              {shown.some((c) => c.kind === 'library') && <p className="adm-small adm-muted">Every date of</p>}
              {shown.filter((c) => c.kind === 'library').map((c) => (
                <label key={c.id} className="adm-check">
                  <input type="checkbox" checked={d.libraryIds.includes(c.id)} onChange={(e) => toggle('library', c.id, e.target.checked)} />
                  <span>{`${c.name} · every date`}</span>
                </label>
              ))}
              {shown.some((c) => c.kind === 'class') && <p className="adm-small adm-muted">One date only</p>}
              {shown.filter((c) => c.kind === 'class').map((c) => (
                <label key={c.id} className="adm-check">
                  <input type="checkbox" checked={d.classIds.includes(c.id)} onChange={(e) => toggle('class', c.id, e.target.checked)} />
                  <span>{c.day ? `${c.name} · ${dayLabel(c.day)}` : c.name}</span>
                </label>
              ))}
            </div>
          )}
          <label className="adm-check">
            <input type="checkbox" checked={d.includeExtras} onChange={(e) => patch({ includeExtras: e.target.checked })} />
            <span>Take it off extras too</span>
          </label>
        </div>

        <div className="adm-two">
          <Field label="Last day (optional)" field="endsYmd" error={errors.endsYmd} hint="Works until midnight that night. Blank means no end.">
            {({ describedBy, invalid }) => (
              <input type="date" value={d.endsYmd} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => patch({ endsYmd: e.target.value })} />
            )}
          </Field>
          <Field label="Use limit (optional)" field="maxUses" error={errors.maxUses} hint="How many bookings can use it. Blank means no limit.">
            {({ describedBy, invalid }) => (
              <input ref={limitBox} inputMode="numeric" value={d.maxUses} placeholder="No limit" aria-describedby={describedBy} aria-invalid={invalid || undefined}
                onChange={(e) => patch({ maxUses: e.target.value })} />
            )}
          </Field>
        </div>
        {risky && (
          <div className="adm-panel is-warn" role="status" data-testid="free-warning">
            <b>{`${freeWords} Set a use limit?`}</b>
            <span className="adm-small">One per person you give it to is safest. Anyone who hears the code can use it.</span>
          </div>
        )}

        <Field label="Your note (optional)" field="label" error={errors.label} hint="Only you see this, like Grand opening.">
          {({ describedBy, invalid }) => (
            <input value={d.label} maxLength={80} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => patch({ label: e.target.value })} />
          )}
        </Field>
        <label className="adm-check">
          <input type="checkbox" checked={d.active} onChange={(e) => patch({ active: e.target.checked })} />
          <span>On (customers can use it)</span>
        </label>
      </div>
    </SheetFrame>
  )
}
