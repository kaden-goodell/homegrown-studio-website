import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { agesLabel } from '@lib/workshop-copy'
import WorkshopTile from '@components/workshops/WorkshopTile'
import type { Pass, Session } from '@lib/classes/types'
import { newId } from '@lib/classes/validate'
import { firstError, hasMore, isSimple, MORE_KEYS, previewOf, type Errors, type FieldKey, type Form } from './class-form'
import { uploadPhoto } from './photo'

type SetForm = (fn: (cur: Form) => Form) => void

/** Move to the first thing to fix: scroll it into view and put the cursor in it. */
export function focusFirstError(root: HTMLElement | null, errors: Errors): void {
  const k = firstError(errors)
  if (!root || !k) return
  const area = root.querySelector<HTMLElement>(`[data-field="${k}"]`)
  const target = area?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=file]), textarea, select, button') ?? area
  area?.scrollIntoView?.({ block: 'center' })
  target?.focus({ preventScroll: true })
}

/** A field's own error, under it (outside the label, so it isn't read as part of the box's name). */
function Err({ text }: { text?: string }) {
  return text ? <p role="alert" className="adm-error adm-fielderr">{text}</p> : null
}

/** A label and its box; the hint sits under the box (described by it, not part of its name), then the box's own error. */
function Field({ label, hint, error, field, children }: { label: string; hint?: ReactNode; error?: string; field?: FieldKey; children: ReactNode }) {
  const id = useId()
  const box = hint && isValidElement(children) ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': id }) : children
  return (
    <div className="adm-fldwrap" {...(field ? { 'data-field': field } : {})}>
      <label className={`adm-fld${hint ? ' has-hint' : ''}`}>
        <span>{label}</span>
        {box}
      </label>
      {hint && <small id={id} className="adm-hint">{hint}</small>}
      <Err text={error} />
    </div>
  )
}

/** A thumbnail, Choose / Change / Remove; the native file input stays hidden behind the button. Cropped to the card (4 by 3). */
export function PhotoPicker({ url, onChange, error }: { url: string | null; onChange: (url: string | null) => void; error?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  async function pick(file: File | undefined) {
    if (!file) return
    setFailed('')
    setBusy(true)
    const r = await uploadPhoto(file)
    setBusy(false)
    if ('url' in r) onChange(r.url)
    else setFailed(r.error)
    if (input.current) input.current.value = ''
  }
  return (
    <div className="adm-photo" data-field="photo">
      <div className="adm-photo-thumb" aria-hidden={!url}>
        {url ? <img src={url} alt="Class photo" /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>}
      </div>
      <div className="adm-photo-side">
        <b>{url ? 'Class photo' : 'Add a photo'}</b>
        <span className="adm-small adm-muted">{busy ? 'Uploading…' : 'Cropped to the card’s shape.'}</span>
        <div className="adm-photo-btns">
          <button type="button" className="adm-btn is-ghost is-sm" disabled={busy} onClick={() => input.current?.click()}>{url ? 'Change' : 'Choose photo'}</button>
          {url && <button type="button" className="adm-btn is-ghost is-sm" disabled={busy} onClick={() => onChange(null)}>Remove</button>}
        </div>
        <input ref={input} className="sr-only" type="file" accept="image/*" aria-label="Photo" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <Err text={failed || error} />
    </div>
  )
}

/**
 * Name, photo, price per seat, ages and description, then "More options"
 * (Ways to book · Seat prices · Extras · Questions · Ages and booking rules,
 * and the teacher), folded unless it has something in it or an error.
 * `usual`: the library's "How long it usually runs" and "Seats it usually
 * has" (library only). `children` go between the price and the description
 * (New class puts the dates there).
 */
export function DetailsFields({ f, set, errors, sessions, usual, children }: {
  f: Form
  set: SetForm
  errors: Errors
  /** The dates on screen, for "Set dates" ways to book. */
  sessions: { id: string; label: string }[]
  usual?: boolean
  children?: ReactNode
}) {
  const patch = (p: Partial<Form>) => set((cur) => ({ ...cur, ...p }))
  const setPrice = (passId: string, ticketId: string, v: string) =>
    set((cur) => ({ ...cur, prices: { ...cur.prices, [passId]: { ...(cur.prices[passId] ?? {}), [ticketId]: v } } }))
  const [more, setMore] = useState(() => hasMore(f))
  const moreError = MORE_KEYS.some((k) => errors[k])
  useEffect(() => { if (moreError) setMore(true) }, [moreError])
  const pass = f.passes[0], ticket = f.ticketTypes[0]

  return (
    <>
      <PhotoPicker url={f.imageUrl} onChange={(imageUrl) => patch({ imageUrl })} error={errors.photo} />
      <Field label="Name" field="name" error={errors.name}>
        <input maxLength={80} value={f.name} placeholder="Like: Punch Needle Coasters" aria-invalid={!!errors.name || undefined} onChange={(e) => patch({ name: e.target.value })} />
      </Field>
      {children}
      <div className="adm-two">
        {isSimple(f) && pass && ticket
          ? (
            <Field label="Price per seat ($)" field="price" error={errors.price}>
              <input inputMode="decimal" placeholder="$" aria-invalid={!!errors.price || undefined} value={f.prices[pass.id]?.[ticket.id] ?? ''} onChange={(e) => setPrice(pass.id, ticket.id, e.target.value)} />
            </Field>
          )
          : <p className="adm-small adm-muted adm-pricenote" data-field="price">Prices are under More options › Ways to book.</p>}
        <Field label="Ages" field="ages" error={errors.ages} hint={f.ages.trim() ? `Shows as: ${agesLabel(f.ages)}` : 'Like 8 and up. Blank shows none.'}>
          <input value={f.ages} onChange={(e) => patch({ ages: e.target.value })} />
        </Field>
      </div>
      <Field label="Description" field="description" error={errors.description} hint="Blank lines make paragraphs. The first one shows on the card.">
        <textarea rows={5} value={f.description} onChange={(e) => patch({ description: e.target.value })} />
      </Field>
      {usual && (
        <div className="adm-two" data-field="usual">
          <Field label="How long it usually runs (minutes)"><input inputMode="numeric" value={f.defaultMinutes} onChange={(e) => patch({ defaultMinutes: e.target.value })} /></Field>
          <Field label="Seats it usually has"><input inputMode="numeric" value={f.defaultCapacity} onChange={(e) => patch({ defaultCapacity: e.target.value })} /></Field>
          <Err text={errors.usual} />
        </div>
      )}
      <h3 className="adm-fold-h">
        <button type="button" className="adm-fold" aria-expanded={more} onClick={() => setMore(!more)}>
          <span>More options</span>
          <span className="adm-fold-sum">{more ? '' : moreSummary(f)}</span>
          <i className="adm-chevron" aria-hidden="true" />
        </button>
      </h3>
      {more && <MoreOptions f={f} set={set} errors={errors} sessions={sessions} setPrice={setPrice} />}
    </>
  )
}

/** "Off · 2 extras" while folded: what's under More options at a glance. */
function moreSummary(f: Form): string {
  const bits: string[] = []
  if (!isSimple(f)) bits.push(`${f.passes.length > 1 ? `${f.passes.length} ways to book` : ''}${f.passes.length > 1 && f.ticketTypes.length > 1 ? ', ' : ''}${f.ticketTypes.length > 1 ? `${f.ticketTypes.length} seat prices` : ''}`)
  if (f.addOns.length) bits.push(`${f.addOns.length} extra${f.addOns.length === 1 ? '' : 's'}`)
  if (f.questions.length) bits.push(`${f.questions.length} question${f.questions.length === 1 ? '' : 's'}`)
  if (f.minCount.trim()) bits.push(`needs ${f.minCount.trim()}`)
  return bits.join(' · ')
}

function Sub({ title, note, error, field, children }: { title: string; note?: string; error?: string; field: FieldKey; children: ReactNode }) {
  return (
    <section aria-label={title} className="adm-sub" data-field={field}>
      <h4>{title}</h4>
      {note && <p className="adm-small adm-muted">{note}</p>}
      <Err text={error} />
      {children}
    </section>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="adm-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function MoreOptions({ f, set, errors, sessions, setPrice }: {
  f: Form; set: SetForm; errors: Errors; sessions: { id: string; label: string }[]
  setPrice: (passId: string, ticketId: string, v: string) => void
}) {
  const patch = (p: Partial<Form>) => set((cur) => ({ ...cur, ...p }))
  const setRules = (p: Partial<Form['rules']>) => set((cur) => ({ ...cur, rules: { ...cur.rules, ...p } }))
  const setPass = (i: number, p: Partial<Pass>) => set((cur) => ({ ...cur, passes: cur.passes.map((x, n) => (n === i ? { ...x, ...p } : x)) }))
  const removePass = (i: number) => set((cur) => {
    const { [cur.passes[i].id]: _gone, ...prices } = cur.prices
    return { ...cur, passes: cur.passes.filter((_, n) => n !== i), prices }
  })
  const setTicket = (j: number, label: string) => set((cur) => ({ ...cur, ticketTypes: cur.ticketTypes.map((t, n) => (n === j ? { ...t, label } : t)) }))
  const removeTicket = (j: number) => set((cur) => {
    const id = cur.ticketTypes[j].id
    const prices: Form['prices'] = {}
    for (const [p, cells] of Object.entries(cur.prices)) { const { [id]: _gone, ...rest } = cells; prices[p] = rest }
    return { ...cur, ticketTypes: cur.ticketTypes.filter((_, n) => n !== j), prices }
  })
  const setList = <K extends 'questions' | 'addOns'>(k: K, i: number, p: Partial<Form[K][number]>) =>
    set((cur) => ({ ...cur, [k]: (cur[k] as any[]).map((x, n) => (n === i ? { ...x, ...p } : x)) }))

  return (
    <div className="adm-more">
      <Field label="Teacher" hint="Leave blank to show no name.">
        <input value={f.instructor} onChange={(e) => patch({ instructor: e.target.value })} />
      </Field>

      <Sub title="Ways to book" field="prices" error={errors.prices} note="Each way someone can book, with a price for each kind of seat. Leave a price empty when it isn’t sold.">
        {f.passes.map((p, i) => {
          const name = p.label || `Way ${i + 1}`
          return (
            <div key={p.id} className="adm-pkg">
              <label className="adm-fld"><span>{`Way to book ${i + 1}`}</span><input aria-label={`Way to book ${i + 1} name`} value={p.label} onChange={(e) => setPass(i, { label: e.target.value })} /></label>
              <Includes pass={p} sessions={sessions} countText={f.chooseCounts[p.id] ?? (p.covers.kind === 'choose' ? String(p.covers.count) : '1')}
                onCountText={(v) => set((cur) => ({ ...cur, chooseCounts: { ...cur.chooseCounts, [p.id]: v } }))}
                onChange={(covers) => setPass(i, { covers })} />
              <div className="adm-two">
                {f.ticketTypes.map((t, j) => (
                  <label key={t.id} className="adm-fld">
                    <span>{`${t.label || `Seat ${j + 1}`} ($)`}</span>
                    <input aria-label={`${name} ${t.label || `Seat ${j + 1}`} price ($)`} inputMode="decimal" placeholder="Not sold" value={f.prices[p.id]?.[t.id] ?? ''} onChange={(e) => setPrice(p.id, t.id, e.target.value)} />
                  </label>
                ))}
              </div>
              {f.passes.length > 1 && <button type="button" className="adm-btn is-ghost is-sm" onClick={() => removePass(i)}>{`Remove ${name}`}</button>}
            </div>
          )
        })}
        <button type="button" className="adm-btn is-ghost is-sm" onClick={() => patch({ passes: [...f.passes, { id: newId('pas'), label: '', covers: { kind: 'all' } }] })}>+ Add a way to book</button>
      </Sub>

      <Sub title="Seat prices" field="tickets" error={errors.tickets} note="Kinds of seat with their own price, like Adult and Kid.">
        {f.ticketTypes.map((t, j) => (
          <div key={t.id} className="adm-inline">
            <label className="adm-fld"><span>{`Kind of seat ${j + 1}`}</span><input value={t.label} onChange={(e) => setTicket(j, e.target.value)} /></label>
            {f.ticketTypes.length > 1 && <button type="button" className="adm-btn is-ghost is-sm" onClick={() => removeTicket(j)}>{`Remove ${t.label || `kind of seat ${j + 1}`}`}</button>}
          </div>
        ))}
        <button type="button" className="adm-btn is-ghost is-sm" onClick={() => patch({ ticketTypes: [...f.ticketTypes, { id: newId('tkt'), label: '' }] })}>+ Add a kind of seat</button>
      </Sub>

      <Sub title="Extras" field="addons" error={errors.addons} note="Extras someone can add to a seat, like a second mug.">
        {f.addOns.map((a, i) => (
          <div key={a.id} className="adm-pkg">
            <label className="adm-fld"><span>{`Extra ${i + 1}`}</span><input value={a.label} onChange={(e) => setList('addOns', i, { label: e.target.value })} /></label>
            <div className="adm-two">
              <label className="adm-fld"><span>{`Extra ${i + 1} price ($)`}</span><input inputMode="decimal" value={a.price} onChange={(e) => setList('addOns', i, { price: e.target.value })} /></label>
              <label className="adm-fld"><span>{`Extra ${i + 1} most per seat`}</span><input inputMode="numeric" value={a.maxPerSeat} onChange={(e) => setList('addOns', i, { maxPerSeat: e.target.value })} /></label>
            </div>
            <button type="button" className="adm-btn is-ghost is-sm" onClick={() => patch({ addOns: f.addOns.filter((_, n) => n !== i) })}>{`Remove extra ${i + 1}`}</button>
          </div>
        ))}
        <button type="button" className="adm-btn is-ghost is-sm" onClick={() => patch({ addOns: [...f.addOns, { id: newId('add'), label: '', price: '', maxPerSeat: '1' }] })}>+ Add an extra</button>
      </Sub>

      <Sub title="Questions" field="questions" error={errors.questions} note="Asked for each seat, like which colour glaze.">
        {f.questions.map((q, i) => (
          <div key={q.id} className="adm-pkg">
            <label className="adm-fld"><span>{`Question ${i + 1}`}</span><input value={q.label} onChange={(e) => setList('questions', i, { label: e.target.value })} /></label>
            <label className="adm-fld"><span>{`Question ${i + 1} choices`}</span><input placeholder="Separate choices with commas" value={q.choices} onChange={(e) => setList('questions', i, { choices: e.target.value })} /></label>
            <button type="button" className="adm-btn is-ghost is-sm" onClick={() => patch({ questions: f.questions.filter((_, n) => n !== i) })}>{`Remove question ${i + 1}`}</button>
          </div>
        ))}
        <button type="button" className="adm-btn is-ghost is-sm" onClick={() => patch({ questions: [...f.questions, { id: newId('q'), label: '', choices: '' }] })}>+ Add a question</button>
      </Sub>

      <Sub title="Ages and booking rules" field="rules" error={errors.rules}>
        <Check label="Drop-off (grown-ups can leave)" checked={f.rules.dropOff} onChange={(v) => setRules({ dropOff: v })} />
        <Check label="Made to order (we prepare each seat ahead)" checked={f.rules.madeToOrder} onChange={(v) => setRules({ madeToOrder: v })} />
        <Check label="Add sales tax" checked={f.rules.taxable} onChange={(v) => setRules({ taxable: v })} />
        <Check label="Only people with the link can find it" checked={f.rules.linkOnly} onChange={(v) => setRules({ linkOnly: v })} />
        <Check label="People can join after it starts" checked={f.rules.joinPartway} onChange={(v) => setRules({ joinPartway: v })} />
        <Check label="Can share the room with another class" checked={f.rules.canShareRoom} onChange={(v) => setRules({ canShareRoom: v })} />
        <div className="adm-two">
          <label className="adm-fld"><span>Most people per booking</span><input inputMode="numeric" value={f.maxPerBooking} onChange={(e) => patch({ maxPerBooking: e.target.value })} /></label>
          <label className="adm-fld"><span>Sign-ups close (hours before)</span><input inputMode="numeric" value={f.cutoff} placeholder="Usual" onChange={(e) => patch({ cutoff: e.target.value })} /></label>
        </div>
        <p className="adm-small adm-muted">Blank sign-up close is the usual: at the start, or 24 hours before when it’s made to order or has questions.</p>
        <fieldset className="adm-min">
          <legend>Minimum to run</legend>
          <div className="adm-minrow">
            <span aria-hidden="true">Needs</span>
            <input aria-label="Minimum people" inputMode="numeric" value={f.minCount} placeholder="6" onChange={(e) => patch({ minCount: e.target.value })} />
            <span aria-hidden="true">by</span>
            <input aria-label="Decide by day" type="date" value={f.minDay} onChange={(e) => patch({ minDay: e.target.value })} />
            <input aria-label="Decide by time" type="time" value={f.minTime} onChange={(e) => patch({ minTime: e.target.value })} />
          </div>
          <small className="adm-hint">Studio time. Leave blank if it runs whatever the numbers.</small>
        </fieldset>
      </Sub>
    </div>
  )
}

function Includes({ pass, sessions, countText, onCountText, onChange }: {
  pass: Pass; sessions: { id: string; label: string }[]; countText: string; onCountText: (v: string) => void; onChange: (c: Pass['covers']) => void
}) {
  const c = pass.covers
  const name = pass.label || 'This way to book'
  return (
    <>
      <label className="adm-fld">
        <span>Includes</span>
        <select
          aria-label={`${name} includes`}
          value={c.kind}
          onChange={(e) => {
            const k = e.target.value as Pass['covers']['kind']
            onChange(k === 'choose' ? { kind: 'choose', count: 1 } : k === 'fixed' ? { kind: 'fixed', sessionIds: sessions.map((s) => s.id) } : { kind: k })
          }}
        >
          <option value="all">Every date</option>
          <option value="choose">They pick dates</option>
          <option value="remaining">Dates not started yet</option>
          {sessions.length > 0 && <option value="fixed">Set dates</option>}
        </select>
      </label>
      {c.kind === 'choose' && (
        <label className="adm-fld"><span>How many they pick</span><input aria-label={`${name} how many they pick`} inputMode="numeric" value={countText} onChange={(e) => onCountText(e.target.value)} /></label>
      )}
      {c.kind === 'fixed' && sessions.map((s) => (
        <Check key={s.id} label={s.label} checked={c.sessionIds.includes(s.id)} onChange={(v) => onChange({ kind: 'fixed', sessionIds: v ? [...c.sessionIds, s.id] : c.sessionIds.filter((x) => x !== s.id) })} />
      ))}
    </>
  )
}

/** "Preview": the real public card, from what's typed. */
export function PreviewButton({ f, sessions }: { f: Form; sessions: Session[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="adm-preview">
      <button type="button" className="adm-btn is-ghost is-sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide preview' : 'Preview'}</button>
      {open && (
        <section aria-label="How the card looks" className="adm-preview-card">
          <WorkshopTile workshop={previewOf(f, sessions)} closedNote="Booking opens from the public page." />
        </section>
      )}
    </div>
  )
}
