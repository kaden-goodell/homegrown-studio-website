import { useMemo, useState, type ReactNode } from 'react'
import { agesLabel } from '@lib/workshop-copy'
import WorkshopTile from '@components/workshops/WorkshopTile'
import type { PersonToTell } from '@lib/classes/admin-actions'
import type { AddOn, ClassContent, ClassRules, ClassStatus, LibraryClass, Pass, ScheduledClass, SeatQuestion, Session, TicketType } from '@lib/classes/types'
import { defaultRules, newId } from '@lib/classes/validate'
import { api, BOOKINGS, CLASSES, LIBRARY } from './api'
import { addDays, partsOf, today, toIsoAt } from './dates'
import { uploadPhoto } from './photo'
import { previewData } from './preview'
import { box, errorText, input, muted, row, warnText } from './ui'

export type EditorMode =
  | { kind: 'new' }
  | { kind: 'from-library'; lib: LibraryClass }
  | { kind: 'edit'; cls: ScheduledClass }
  | { kind: 'library'; lib?: LibraryClass }

export interface EditorSaved { cls?: ScheduledClass; lib?: LibraryClass; warning?: string }

type SectionKey = 'basics' | 'sessions' | 'prices' | 'tickets' | 'questions' | 'addons' | 'rules'
const SECTION_TITLE: Record<SectionKey, string> = {
  basics: 'Basics', sessions: 'Sessions', prices: 'Passes & prices', tickets: 'Ticket types', questions: 'Questions', addons: 'Add-ons', rules: 'Rules',
}

interface SessionRow { id: string; day: string; start: string; end: string; capacity: string }
interface AddOnRow { id: string; label: string; price: string; maxPerSeat: string }
interface QuestionRow { id: string; label: string; choices: string }
interface Form {
  name: string
  description: string
  imageUrl: string | null
  instructor: string
  defaultCapacity: string
  defaultMinutes: string
  status: ClassStatus
  ticketTypes: TicketType[]
  passes: Pass[]
  /** prices[passId][ticketTypeId] as typed; '' or missing = not sold. */
  prices: Record<string, Record<string, string>>
  questions: QuestionRow[]
  addOns: AddOnRow[]
  rules: ClassRules
  cutoff: string
  minCount: string
  minDecideBy: string
  /** Typed as text so a box can be cleared and retyped; checked in build(). */
  maxPerBooking: string
  /** "How many they pick" per 'choose' pass, as typed. */
  chooseCounts: Record<string, string>
  sessions: SessionRow[]
}

const dollars = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2))
const MONEY_RE = /^\d+(\.\d{1,2})?$/
const toCents = (s: string) => Math.round(parseFloat(s) * 100)
const intOf = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN)

function blankContent(): ClassContent {
  return {
    name: '', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [{ id: newId('pas'), label: 'Full class', covers: { kind: 'all' } }],
    prices: {}, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 90,
  }
}

function addMinutes(day: string, hhmm: string, minutes: number): { day: string; time: string } {
  return partsOf(new Date(Date.parse(toIsoAt(day, hhmm)) + minutes * 60_000).toISOString())
}

function newSessionRow(c: { defaultMinutes: number; defaultCapacity: number }, after?: SessionRow): SessionRow {
  const day = after ? addDays(after.day, 7) : addDays(today(), 7)
  const start = after?.start || '10:00'
  return { id: newId('ses'), day, start, end: addMinutes(day, start, c.defaultMinutes).time, capacity: String(c.defaultCapacity) }
}

function sessionRow(s: Session): SessionRow {
  const a = partsOf(s.startIso), b = partsOf(s.endIso)
  return { id: s.id, day: a.day, start: a.time, end: b.time, capacity: String(s.capacity) }
}

function toForm(content: ClassContent, sessions: SessionRow[], status: ClassStatus): Form {
  const prices: Form['prices'] = {}
  for (const [p, rowCells] of Object.entries(content.prices)) for (const [t, c] of Object.entries(rowCells)) (prices[p] ??= {})[t] = dollars(c)
  const r = content.rules
  return {
    name: content.name, description: content.description, imageUrl: content.imageUrl, instructor: content.instructor ?? '',
    defaultCapacity: String(content.defaultCapacity), defaultMinutes: String(content.defaultMinutes), status,
    ticketTypes: content.ticketTypes.map((t) => ({ ...t })), passes: structuredClone(content.passes), prices,
    questions: content.questions.map((q) => ({ id: q.id, label: q.label, choices: q.choices.join(', ') })),
    addOns: content.addOns.map((a) => ({ id: a.id, label: a.label, price: dollars(a.priceCents), maxPerSeat: String(a.maxPerSeat) })),
    rules: { ...r },
    cutoff: r.signupCutoffHours === null ? '' : String(r.signupCutoffHours),
    maxPerBooking: String(r.maxPerBooking),
    chooseCounts: Object.fromEntries(content.passes.flatMap((p) => (p.covers.kind === 'choose' ? [[p.id, String(p.covers.count)]] : []))),
    minCount: r.minimumToRun ? String(r.minimumToRun.count) : '',
    minDecideBy: r.minimumToRun ? partsOf(r.minimumToRun.decideByIso).day : '',
    sessions,
  }
}

function initialForm(mode: EditorMode): Form {
  switch (mode.kind) {
    case 'edit': return toForm(mode.cls.content, mode.cls.sessions.map(sessionRow), mode.cls.status)
    case 'from-library': {
      const c = mode.lib.versions[mode.lib.versions.length - 1].content
      return toForm(c, [newSessionRow(c)], 'open')
    }
    case 'library': {
      const c = mode.lib ? mode.lib.versions[mode.lib.versions.length - 1].content : blankContent()
      return toForm(c, [], 'open')
    }
    default: {
      const c = blankContent()
      return toForm(c, [newSessionRow(c)], 'open')
    }
  }
}

/** Errors by section, plus 'price' for the single price box in Basics and 'form' for the save bar. */
type Errors = Partial<Record<SectionKey | 'form' | 'price', string>>
type Built = { ok: true; content: ClassContent; sessions: Session[] } | { ok: false; errors: Errors }

const isSimple = (f: Pick<Form, 'passes' | 'ticketTypes'>) => f.passes.length === 1 && f.ticketTypes.length === 1

/** Which section a server `field` belongs to. */
function sectionOf(field: string | undefined, f: Form): SectionKey | 'form' | 'price' {
  if (!field) return 'form'
  const head = field.split('.')[0]
  if (head === 'sessions') return 'sessions'
  if (head === 'passes' || head === 'prices') return isSimple(f) && head === 'prices' ? 'price' : 'prices'
  if (head === 'ticketTypes') return 'tickets'
  if (head === 'questions') return 'questions'
  if (head === 'addOns') return 'addons'
  if (head === 'rules') return 'rules'
  return 'basics'
}

function build(f: Form, withSessions: boolean): Built {
  const errors: Errors = {}
  const name = f.name.trim()
  if (!name) errors.basics = 'Give the class a name.'

  const prices: ClassContent['prices'] = {}
  let priceError = ''
  for (const p of f.passes) {
    for (const t of f.ticketTypes) {
      const v = (f.prices[p.id]?.[t.id] ?? '').trim().replace(/^\$/, '')
      if (!v) continue
      if (!MONEY_RE.test(v)) { priceError = 'Prices are dollar amounts, like 25 or 12.50.'; continue }
      ;(prices[p.id] ??= {})[t.id] = toCents(v)
    }
  }
  if (!priceError && !Object.keys(prices).length) priceError = 'Add at least one price.'
  if (f.passes.some((p) => !p.label.trim())) priceError ||= 'Each pass needs a name.'
  if (priceError) errors[isSimple(f) ? 'price' : 'prices'] = priceError
  if (f.ticketTypes.some((t) => !t.label.trim())) errors.tickets = 'Each ticket type needs a name.'
  const passes: Pass[] = []
  for (const p of f.passes) {
    const label = p.label.trim()
    if (p.covers.kind !== 'choose') { passes.push({ ...p, label }); continue }
    const count = intOf(f.chooseCounts[p.id] ?? String(p.covers.count))
    if (!(count >= 1 && count <= 60)) { errors.prices ||= `${label || 'A pass'} needs to let people pick 1 to 60 sessions.`; continue }
    passes.push({ ...p, label, covers: { kind: 'choose', count } })
  }

  const defaultCapacity = intOf(f.defaultCapacity), defaultMinutes = intOf(f.defaultMinutes)
  if (!errors.basics && !(defaultCapacity >= 1 && defaultCapacity <= 999)) errors.basics = 'The usual seats is 1 to 999.'
  if (!errors.basics && !(defaultMinutes >= 5 && defaultMinutes <= 1440)) errors.basics = 'The usual length is 5 to 1440 minutes.'

  const addOns: AddOn[] = []
  for (const a of f.addOns) {
    const price = a.price.trim().replace(/^\$/, '')
    if (!a.label.trim()) { errors.addons = 'Each add-on needs a name.'; break }
    if (!MONEY_RE.test(price)) { errors.addons = `${a.label.trim()} needs a price, like 5 or 2.50.`; break }
    const max = intOf(a.maxPerSeat)
    if (!(max >= 1 && max <= 40)) { errors.addons = `${a.label.trim()} can be added 1 to 40 times per seat.`; break }
    addOns.push({ id: a.id, label: a.label.trim(), priceCents: toCents(price), maxPerSeat: max })
  }

  const questions: SeatQuestion[] = []
  for (const q of f.questions) {
    const choices = q.choices.split(',').map((c) => c.trim()).filter(Boolean)
    if (!q.label.trim()) { errors.questions = 'Each question needs a label.'; break }
    if (choices.length < 2) { errors.questions = `${q.label.trim()} needs at least two choices.`; break }
    questions.push({ id: q.id, label: q.label.trim(), choices })
  }

  const rules: ClassRules = { ...f.rules, ages: f.rules.ages.trim() }
  const cutoff = f.cutoff.trim()
  if (cutoff) {
    const n = intOf(cutoff)
    if (!(n >= 0 && n <= 720)) errors.rules = 'The sign-up cutoff is 0 to 720 hours.'
    else rules.signupCutoffHours = n
  } else rules.signupCutoffHours = null
  if (f.minCount.trim() || f.minDecideBy) {
    const n = intOf(f.minCount)
    if (!(n >= 1) || !f.minDecideBy) errors.rules = 'The minimum to run needs a head count and a decide-by date.'
    else rules.minimumToRun = { count: n, decideByIso: toIsoAt(f.minDecideBy, '12:00') }
  } else rules.minimumToRun = null
  const maxPer = intOf(f.maxPerBooking)
  if (!(maxPer >= 1 && maxPer <= 40)) errors.rules = 'The most people per booking is 1 to 40.'
  else rules.maxPerBooking = maxPer

  const sessions: Session[] = []
  if (withSessions) {
    if (!f.sessions.length) errors.sessions = 'Add at least one session.'
    for (const s of f.sessions) {
      if (!s.day || !s.start || !s.end) { errors.sessions = 'Each session needs a start and an end time.'; break }
      if (s.end <= s.start) { errors.sessions = 'A session has to end after it starts.'; break }
      const startIso = toIsoAt(s.day, s.start), endIso = toIsoAt(s.day, s.end)
      const cap = intOf(s.capacity)
      if (!(cap >= 1 && cap <= 999)) { errors.sessions = 'Session capacity is 1 to 999.'; break }
      sessions.push({ id: s.id, startIso, endIso, capacity: cap })
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    sessions,
    content: {
      name, description: f.description.trim(), imageUrl: f.imageUrl, instructor: f.instructor.trim() || null, rules,
      ticketTypes: f.ticketTypes.map((t) => ({ id: t.id, label: t.label.trim() })),
      passes,
      prices, questions, addOns, defaultCapacity, defaultMinutes,
    },
  }
}

/** What the preview card can draw from a half-typed form: never throws. */
function previewOf(f: Form) {
  const prices: ClassContent['prices'] = {}
  for (const p of f.passes) for (const t of f.ticketTypes) {
    const v = (f.prices[p.id]?.[t.id] ?? '').trim().replace(/^\$/, '')
    if (MONEY_RE.test(v)) (prices[p.id] ??= {})[t.id] = toCents(v)
  }
  const sessions: Session[] = f.sessions
    .filter((s) => s.day && s.start && s.end && s.end > s.start)
    .map((s) => ({ id: s.id, startIso: toIsoAt(s.day, s.start), endIso: toIsoAt(s.day, s.end), capacity: intOf(s.capacity) || 0 }))
  const content: ClassContent = {
    ...blankContent(), name: f.name, description: f.description, imageUrl: f.imageUrl, instructor: f.instructor || null,
    rules: f.rules, ticketTypes: f.ticketTypes.map((t, i) => ({ ...t, label: t.label || `Ticket ${i + 1}` })), prices,
    passes: f.passes.map((p) => (p.covers.kind === 'choose' ? { ...p, covers: { kind: 'choose' as const, count: intOf(f.chooseCounts[p.id] ?? '') || 1 } } : p)),
    defaultMinutes: intOf(f.defaultMinutes) || 90, defaultCapacity: intOf(f.defaultCapacity) || 12,
  }
  return previewData(content, sessions)
}

/**
 * One form for a class: Basics and Sessions open; Passes & prices, Ticket
 * types, Questions, Add-ons and Rules folded until they have something in
 * them. Beside it, the real public card, live. Used to add a class, schedule
 * one from the library, edit a scheduled class, or keep a library class.
 */
export default function ClassEditor({ mode, onSaved, onCancel }: { mode: EditorMode; onSaved: (s: EditorSaved) => void; onCancel: () => void }) {
  const [f, setF] = useState<Form>(() => initialForm(mode))
  const [cls, setCls] = useState<ScheduledClass | null>(mode.kind === 'edit' ? mode.cls : null)
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [warning, setWarning] = useState('')
  const [stale, setStale] = useState(false)
  const [toTell, setToTell] = useState<{ people: PersonToTell[]; also: boolean } | null>(null)
  const [photoState, setPhotoState] = useState<'idle' | 'uploading'>('idle')
  const [photoError, setPhotoError] = useState('')
  const [open, setOpen] = useState<Record<SectionKey, boolean>>(() => {
    const init = initialForm(mode)
    return {
      basics: true, sessions: true,
      prices: !isSimple(init),
      tickets: init.ticketTypes.length > 1 || init.ticketTypes[0]?.label !== 'Person',
      questions: init.questions.length > 0,
      addons: init.addOns.length > 0,
      rules: JSON.stringify(init.rules) !== JSON.stringify(defaultRules()),
    }
  })
  const withSessions = mode.kind !== 'library'
  const fromLibrary = mode.kind === 'from-library' || (mode.kind === 'edit' && !!cls?.libraryId)
  const preview = useMemo(() => previewOf(f), [f])

  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }))
  const setRules = (patch: Partial<ClassRules>) => setF((cur) => ({ ...cur, rules: { ...cur.rules, ...patch } }))
  const setPrice = (passId: string, ticketId: string, v: string) =>
    setF((cur) => ({ ...cur, prices: { ...cur.prices, [passId]: { ...(cur.prices[passId] ?? {}), [ticketId]: v } } }))

  function showErrors(e: Errors) {
    setErrors(e)
    setOpen((o) => {
      const next = { ...o }
      for (const k of Object.keys(e)) {
        if (k === 'price') next.basics = true
        else if (k !== 'form') next[k as SectionKey] = true
      }
      return next
    })
  }

  async function save(alsoLibrary: boolean, confirmMove = false) {
    setNotice('')
    setWarning('')
    setStale(false)
    if (!confirmMove) setToTell(null)
    const b = build(f, withSessions)
    if (!b.ok) return showErrors(b.errors)
    setErrors({})
    setSaving(true)
    try {
      if (mode.kind === 'library') {
        const r = await api<{ library: LibraryClass }>(LIBRARY, { action: 'save', ...(mode.lib ? { id: mode.lib.id } : {}), content: b.content, note: '' })
        if (!r.ok || !r.data) return showErrors({ [sectionOf(r.extra.field, f)]: r.error })
        setNotice('Saved to the library.')
        return onSaved({ lib: r.data.library })
      }
      if (mode.kind === 'edit' && cls) {
        const r = await api<{ class: ScheduledClass; peopleToTell?: PersonToTell[] }>(CLASSES, {
          action: 'update', id: cls.id, expectedUpdatedAt: cls.updatedAt, content: b.content, sessions: b.sessions, status: f.status,
          ...(alsoLibrary ? { alsoUpdateLibrary: true } : {}), ...(confirmMove ? { confirmMove: true } : {}),
        })
        if (!r.ok || !r.data) {
          if (r.status === 409 && Array.isArray(r.extra.peopleToTell)) {
            setToTell({ people: r.extra.peopleToTell, also: alsoLibrary })
            return showErrors({ form: r.error })
          }
          if (r.status === 409 && r.extra.stale === true) setStale(true)
          return showErrors({ [sectionOf(r.extra.field, f)]: r.error })
        }
        setCls(r.data.class)
        setToTell(confirmMove && r.data.peopleToTell?.length ? { people: r.data.peopleToTell, also: alsoLibrary } : null)
        setNotice(confirmMove ? 'Moved. Let the people below know.' : 'Saved.')
        if (r.warning) setWarning(r.warning)
        return onSaved({ cls: r.data.class, warning: r.warning })
      }
      // A new class, from the library or from scratch.
      const r = await api<{ class: ScheduledClass }>(CLASSES, {
        action: 'create', ...(mode.kind === 'from-library' ? { libraryId: mode.lib.id } : {}),
        content: b.content, sessions: b.sessions, status: f.status,
      })
      if (!r.ok || !r.data) return showErrors({ [sectionOf(r.extra.field, f)]: r.error })
      let created = r.data.class
      let warn = r.warning
      if (alsoLibrary) {
        // The server saves the library version and points the class at it (a new class gets a new library entry).
        const u = await api<{ class: ScheduledClass }>(CLASSES, { action: 'update', id: created.id, expectedUpdatedAt: created.updatedAt, alsoUpdateLibrary: true })
        if (u.ok && u.data) {
          created = u.data.class
          warn = u.warning ?? warn
        } else {
          warn = [warn, "The class is added. The library didn't update. Open the class and save it with Also update the library."].filter(Boolean).join(' ')
        }
      }
      setCls(created)
      setNotice('Added.')
      if (warn) setWarning(warn)
      return onSaved({ cls: created, warning: warn })
    } finally {
      setSaving(false)
    }
  }

  async function reload() {
    if (!cls) return
    const r = await api<{ class: ScheduledClass }>(`${BOOKINGS}?id=${encodeURIComponent(cls.id)}`)
    if (!r.ok || !r.data) return showErrors({ form: r.error })
    setCls(r.data.class)
    setF(toForm(r.data.class.content, r.data.class.sessions.map(sessionRow), r.data.class.status))
    setErrors({})
    setStale(false)
    setToTell(null)
    setNotice('Reloaded. Make your change again.')
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return
    setPhotoError('')
    setPhotoState('uploading')
    const r = await uploadPhoto(file)
    setPhotoState('idle')
    if ('url' in r) set({ imageUrl: r.url })
    else setPhotoError(r.error)
  }

  const sectionProps = (k: SectionKey) => ({ title: SECTION_TITLE[k], open: open[k], onToggle: () => setOpen((o) => ({ ...o, [k]: !o[k] })), error: errors[k] })
  const singleTicket = f.ticketTypes[0]
  const singlePass = f.passes[0]
  const title = mode.kind === 'edit' ? `Edit ${cls?.content.name ?? ''}` : mode.kind === 'library' ? (mode.lib ? 'Edit library class' : 'New library class') : mode.kind === 'from-library' ? 'Schedule from the library' : 'New class'

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <style>{`
        .class-editor { display: grid; gap: 1rem; grid-template-columns: 1fr; }
        @media (min-width: 960px) { .class-editor { grid-template-columns: minmax(0, 1fr) 20rem; align-items: start; } .class-editor-preview { position: sticky; top: 1rem; } }
        .price-grid { border-collapse: collapse; width: 100%; }
        .price-grid th, .price-grid td { padding: 0.3rem; text-align: left; vertical-align: top; }
      `}</style>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <h1 className="font-heading" style={{ margin: 0, fontSize: '1.6rem', color: 'var(--color-dark)' }}>{title}</h1>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Back</button>
      </div>
      {cls?.status === 'cancelled' && <p style={warnText}>This class is cancelled. Duplicate it to run it again.</p>}
      <div className="class-editor">
        <form onSubmit={(e) => { e.preventDefault(); save(false) }} style={{ display: 'grid', gap: '0.75rem', minWidth: 0 }}>
          <Section {...sectionProps('basics')}>
            <Field label="Name"><input className="field-input" style={input} maxLength={80} value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Description" hint="Blank lines make paragraphs. The first one shows on the card.">
              <textarea className="field-input" style={{ ...input, minHeight: '8rem' }} value={f.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              <label className="field-label" htmlFor="class-photo">Photo</label>
              <input id="class-photo" type="file" accept="image/*" style={{ minHeight: '2.75rem' }} onChange={(e) => pickPhoto(e.target.files?.[0])} />
              <span style={{ ...muted, fontSize: '0.85rem' }}>{photoState === 'uploading' ? 'Uploading…' : 'Cropped to the card’s shape (4 by 3).'}</span>
              {photoError && <p role="alert" style={errorText}>{photoError}</p>}
              {f.imageUrl && <button type="button" className="btn btn-secondary" onClick={() => set({ imageUrl: null })}>Remove photo</button>}
            </div>
            <Field label="Teacher" hint="Leave blank to show no name."><input className="field-input" style={input} value={f.instructor} onChange={(e) => set({ instructor: e.target.value })} /></Field>
            {isSimple(f) && singlePass && singleTicket && (
              <Field label={`Price per ${(singleTicket.label || 'person').toLowerCase()} ($)`} error={errors.price}>
                <input className="field-input" style={input} inputMode="decimal" value={f.prices[singlePass.id]?.[singleTicket.id] ?? ''} onChange={(e) => setPrice(singlePass.id, singleTicket.id, e.target.value)} />
              </Field>
            )}
            <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))' }}>
              <Field label="Usual length (minutes)"><input className="field-input" style={input} inputMode="numeric" value={f.defaultMinutes} onChange={(e) => set({ defaultMinutes: e.target.value })} /></Field>
              <Field label="Usual seats"><input className="field-input" style={input} inputMode="numeric" value={f.defaultCapacity} onChange={(e) => set({ defaultCapacity: e.target.value })} /></Field>
            </div>
            {withSessions && (
              <Field label="Status">
                <select className="field-input" style={input} value={f.status} onChange={(e) => set({ status: e.target.value as ClassStatus })} disabled={cls?.status === 'cancelled'}>
                  <option value="open">Open for booking</option>
                  <option value="draft">Draft (only you see it)</option>
                  <option value="closed">Sign-ups closed</option>
                </select>
              </Field>
            )}
          </Section>

          {withSessions && (
            <Section {...sectionProps('sessions')}>
              {f.sessions.map((s, i) => (
                <div key={s.id} style={{ display: 'grid', gap: '0.4rem', gridTemplateColumns: 'repeat(auto-fit, minmax(7.5rem, 1fr))', alignItems: 'end', paddingBottom: '0.5rem', borderBottom: '1px solid var(--color-line)' }}>
                  <Field label={`Session ${i + 1} day`}><input className="field-input" style={input} type="date" value={s.day} onChange={(e) => setSession(i, { day: e.target.value })} /></Field>
                  <Field label={`Session ${i + 1} start`}><input className="field-input" style={input} type="time" value={s.start} onChange={(e) => setSession(i, { start: e.target.value })} /></Field>
                  <Field label={`Session ${i + 1} end`}><input className="field-input" style={input} type="time" value={s.end} onChange={(e) => setSession(i, { end: e.target.value })} /></Field>
                  <Field label={`Session ${i + 1} seats`}><input className="field-input" style={input} inputMode="numeric" value={s.capacity} onChange={(e) => setSession(i, { capacity: e.target.value })} /></Field>
                  {f.sessions.length > 1 && <button type="button" className="btn btn-secondary" onClick={() => removeSession(i)}>Remove session {i + 1}</button>}
                </div>
              ))}
              <button type="button" className="btn btn-secondary" onClick={() => set({ sessions: [...f.sessions, newSessionRow({ defaultMinutes: intOf(f.defaultMinutes) || 90, defaultCapacity: intOf(f.defaultCapacity) || 12 }, f.sessions[f.sessions.length - 1])] })}>
                Add a session
              </button>
            </Section>
          )}

          <Section {...sectionProps('prices')}>
            <p style={{ ...muted, fontSize: '0.85rem' }}>One row per pass, one column per ticket type. Leave a box empty when that combination isn’t sold.</p>
            <div style={{ overflowX: 'auto' }}>
              <table className="price-grid">
                <thead>
                  <tr><th>Pass</th>{f.ticketTypes.map((t, j) => <th key={t.id}>{t.label || `Ticket type ${j + 1}`}</th>)}</tr>
                </thead>
                <tbody>
                  {f.passes.map((p, i) => {
                    const passName = p.label || `Pass ${i + 1}`
                    return (
                      <tr key={p.id}>
                        <td style={{ minWidth: '11rem' }}>
                          <div style={{ display: 'grid', gap: '0.3rem' }}>
                            <input aria-label={`Pass ${i + 1} name`} className="field-input" style={input} value={p.label} onChange={(e) => setPass(i, { label: e.target.value })} />
                            <CoversPicker
                              pass={p}
                              sessions={f.sessions}
                              withSessions={withSessions}
                              countText={f.chooseCounts[p.id] ?? (p.covers.kind === 'choose' ? String(p.covers.count) : '1')}
                              onCountText={(v) => setF((cur) => ({ ...cur, chooseCounts: { ...cur.chooseCounts, [p.id]: v } }))}
                              onChange={(covers) => setPass(i, { covers })}
                            />
                            {f.passes.length > 1 && <button type="button" className="btn btn-secondary" onClick={() => removePass(i)}>Remove {passName}</button>}
                          </div>
                        </td>
                        {f.ticketTypes.map((t, j) => (
                          <td key={t.id} style={{ minWidth: '6rem' }}>
                            <input aria-label={`${passName} ${t.label || `Ticket type ${j + 1}`} price ($)`} className="field-input" style={input} inputMode="decimal" placeholder="Not sold" value={f.prices[p.id]?.[t.id] ?? ''} onChange={(e) => setPrice(p.id, t.id, e.target.value)} />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => set({ passes: [...f.passes, { id: newId('pas'), label: '', covers: { kind: 'all' } }] })}>Add a pass</button>
          </Section>

          <Section {...sectionProps('tickets')}>
            <p style={{ ...muted, fontSize: '0.85rem' }}>Kinds of seat with their own price, like Adult and Kid.</p>
            {f.ticketTypes.map((t, j) => (
              <div key={t.id} style={{ ...row, alignItems: 'end' }}>
                <div style={{ flex: '1 1 12rem' }}>
                  <Field label={`Ticket type ${j + 1}`}><input className="field-input" style={input} value={t.label} onChange={(e) => setTicket(j, e.target.value)} /></Field>
                </div>
                {f.ticketTypes.length > 1 && <button type="button" className="btn btn-secondary" onClick={() => removeTicket(j)}>Remove {t.label || `ticket type ${j + 1}`}</button>}
              </div>
            ))}
            <button type="button" className="btn btn-secondary" onClick={() => set({ ticketTypes: [...f.ticketTypes, { id: newId('tkt'), label: '' }] })}>Add a ticket type</button>
          </Section>

          <Section {...sectionProps('questions')}>
            <p style={{ ...muted, fontSize: '0.85rem' }}>Asked for each seat, like which colour glaze.</p>
            {f.questions.map((q, i) => (
              <div key={q.id} style={{ display: 'grid', gap: '0.4rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--color-line)' }}>
                <Field label={`Question ${i + 1}`}><input className="field-input" style={input} value={q.label} onChange={(e) => setList('questions', i, { label: e.target.value })} /></Field>
                <Field label={`Question ${i + 1} choices`} hint="Separate choices with commas."><input className="field-input" style={input} value={q.choices} onChange={(e) => setList('questions', i, { choices: e.target.value })} /></Field>
                <button type="button" className="btn btn-secondary" onClick={() => set({ questions: f.questions.filter((_, n) => n !== i) })}>Remove question {i + 1}</button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary" onClick={() => set({ questions: [...f.questions, { id: newId('q'), label: '', choices: '' }] })}>Add a question</button>
          </Section>

          <Section {...sectionProps('addons')}>
            <p style={{ ...muted, fontSize: '0.85rem' }}>Extras someone can add to a seat, like a second mug.</p>
            {f.addOns.map((a, i) => (
              <div key={a.id} style={{ display: 'grid', gap: '0.4rem', gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', alignItems: 'end', paddingBottom: '0.5rem', borderBottom: '1px solid var(--color-line)' }}>
                <Field label={`Add-on ${i + 1}`}><input className="field-input" style={input} value={a.label} onChange={(e) => setList('addOns', i, { label: e.target.value })} /></Field>
                <Field label={`Add-on ${i + 1} price ($)`}><input className="field-input" style={input} inputMode="decimal" value={a.price} onChange={(e) => setList('addOns', i, { price: e.target.value })} /></Field>
                <Field label={`Add-on ${i + 1} most per seat`}><input className="field-input" style={input} inputMode="numeric" value={a.maxPerSeat} onChange={(e) => setList('addOns', i, { maxPerSeat: e.target.value })} /></Field>
                <button type="button" className="btn btn-secondary" onClick={() => set({ addOns: f.addOns.filter((_, n) => n !== i) })}>Remove add-on {i + 1}</button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary" onClick={() => set({ addOns: [...f.addOns, { id: newId('add'), label: '', price: '', maxPerSeat: '1' }] })}>Add an add-on</button>
          </Section>

          <Section {...sectionProps('rules')}>
            <Field label="Ages" hint={`e.g. 8 and up, 8-12, or 18 and up${f.rules.ages.trim() ? ` · Shows as: ${agesLabel(f.rules.ages)}` : ' · Leave blank for none.'}`}><input className="field-input" style={input} value={f.rules.ages} onChange={(e) => setRules({ ages: e.target.value })} /></Field>
            <Check label="Drop-off (grown-ups can leave)" checked={f.rules.dropOff} onChange={(v) => setRules({ dropOff: v })} />
            <Check label="Made to order (we prepare each seat ahead)" checked={f.rules.madeToOrder} onChange={(v) => setRules({ madeToOrder: v })} />
            <Check label="Add sales tax" checked={f.rules.taxable} onChange={(v) => setRules({ taxable: v })} />
            <Check label="Only people with the link can find it" checked={f.rules.linkOnly} onChange={(v) => setRules({ linkOnly: v })} />
            <Check label="People can join after it starts" checked={f.rules.joinPartway} onChange={(v) => setRules({ joinPartway: v })} />
            <Check label="Can share the room with another class" checked={f.rules.canShareRoom} onChange={(v) => setRules({ canShareRoom: v })} />
            <Field label="Most people per booking"><input className="field-input" style={input} inputMode="numeric" value={f.maxPerBooking} onChange={(e) => set({ maxPerBooking: e.target.value })} /></Field>
            <Field label="Sign-ups close this many hours before" hint="Leave blank for the usual (at the start, or 24 hours when made to order or there are questions)."><input className="field-input" style={input} inputMode="numeric" value={f.cutoff} onChange={(e) => set({ cutoff: e.target.value })} /></Field>
            <div style={{ display: 'grid', gap: '0.4rem', gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))' }}>
              <Field label="Minimum to run (people)"><input className="field-input" style={input} inputMode="numeric" value={f.minCount} onChange={(e) => set({ minCount: e.target.value })} /></Field>
              <Field label="Decide by"><input className="field-input" style={input} type="date" value={f.minDecideBy} onChange={(e) => set({ minDecideBy: e.target.value })} /></Field>
            </div>
          </Section>

          <div style={{ ...box, position: 'sticky', bottom: 0, zIndex: 1 }}>
            {errors.form && <p role="alert" style={errorText}>{errors.form}</p>}
            {stale && <button type="button" className="btn btn-primary" onClick={reload}>Reload</button>}
            {toTell && (
              <div style={{ display: 'grid', gap: '0.4rem' }}>
                <ul aria-label="People to tell" style={{ margin: 0, paddingLeft: '1.2rem' }}>
                  {toTell.people.map((p, i) => (
                    <li key={i}>{[p.name || 'No name', p.email, p.phone].filter(Boolean).join(' · ')}{p.sessions.length ? ` (booked ${p.sessions.join(', ')})` : ''}</li>
                  ))}
                </ul>
                {errors.form && <button type="button" className="btn btn-primary" disabled={saving} onClick={() => save(toTell.also, true)}>Move and I’ll tell them</button>}
              </div>
            )}
            {notice && <p role="status" style={{ margin: 0, fontWeight: 600 }}>{notice}</p>}
            {warning && <p role="alert" style={warnText}>{warning}</p>}
            {!toTell?.people.length || !errors.form ? (
              <div style={row}>
                {mode.kind === 'library' && <button type="submit" className="btn btn-primary" disabled={saving}>Save to library</button>}
                {mode.kind !== 'library' && fromLibrary && (
                  <>
                    <button type="button" className="btn btn-primary" disabled={saving || cls?.status === 'cancelled'} onClick={() => save(false)}>Just this date</button>
                    <button type="button" className="btn btn-secondary" disabled={saving || cls?.status === 'cancelled'} onClick={() => save(true)}>Also update the library</button>
                  </>
                )}
                {mode.kind === 'new' && (
                  <>
                    <button type="submit" className="btn btn-primary" disabled={saving}>Add class</button>
                    <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => save(true)}>Add and keep in the library</button>
                  </>
                )}
                {mode.kind === 'edit' && !fromLibrary && <button type="submit" className="btn btn-primary" disabled={saving || cls?.status === 'cancelled'}>Save</button>}
              </div>
            ) : null}
          </div>
        </form>
        <section aria-label="How the card looks" className="class-editor-preview" style={{ display: 'grid', gap: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', color: 'var(--color-muted)' }}>How the card looks</h2>
          <WorkshopTile workshop={preview} closedNote="Booking opens from the public page." />
        </section>
      </div>
    </div>
  )

  function setSession(i: number, patch: Partial<SessionRow>) {
    setF((cur) => ({ ...cur, sessions: cur.sessions.map((s, n) => (n === i ? { ...s, ...patch } : s)) }))
  }
  function removeSession(i: number) {
    setF((cur) => {
      const gone = cur.sessions[i].id
      return {
        ...cur,
        sessions: cur.sessions.filter((_, n) => n !== i),
        passes: cur.passes.map((p) => (p.covers.kind === 'fixed' ? { ...p, covers: { ...p.covers, sessionIds: p.covers.sessionIds.filter((id) => id !== gone) } } : p)),
      }
    })
  }
  function setPass(i: number, patch: Partial<Pass>) {
    setF((cur) => ({ ...cur, passes: cur.passes.map((p, n) => (n === i ? { ...p, ...patch } : p)) }))
  }
  function removePass(i: number) {
    setF((cur) => {
      const { [cur.passes[i].id]: _gone, ...prices } = cur.prices
      return { ...cur, passes: cur.passes.filter((_, n) => n !== i), prices }
    })
  }
  function setTicket(j: number, label: string) {
    setF((cur) => ({ ...cur, ticketTypes: cur.ticketTypes.map((t, n) => (n === j ? { ...t, label } : t)) }))
  }
  function removeTicket(j: number) {
    setF((cur) => {
      const id = cur.ticketTypes[j].id
      const prices: Form['prices'] = {}
      for (const [p, cells] of Object.entries(cur.prices)) { const { [id]: _gone, ...rest } = cells; prices[p] = rest }
      return { ...cur, ticketTypes: cur.ticketTypes.filter((_, n) => n !== j), prices }
    })
  }
  function setList<K extends 'questions' | 'addOns'>(key: K, i: number, patch: Partial<Form[K][number]>) {
    setF((cur) => ({ ...cur, [key]: (cur[key] as any[]).map((x, n) => (n === i ? { ...x, ...patch } : x)) }))
  }
}

function Section({ title, open, onToggle, error, children }: { title: string; open: boolean; onToggle: () => void; error?: string; children: ReactNode }) {
  return (
    <section aria-label={title} style={box}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: '2.75rem', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-dark)', textAlign: 'left' }}
      >
        <span>{title}</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {error && <p role="alert" style={errorText}>{error}</p>}
      {open && children}
    </section>
  )
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  const field = (
    <label className="field" style={{ display: 'grid', gap: '0.25rem', minWidth: 0 }}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span style={{ ...muted, fontSize: '0.8rem' }}>{hint}</span>}
    </label>
  )
  if (!error) return field
  // The error sits under the box, outside the label so it isn't read as part of the box's name.
  return <div data-field={label} style={{ display: 'grid', gap: '0.25rem', minWidth: 0 }}>{field}<p role="alert" style={errorText}>{error}</p></div>
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ ...row, minHeight: '2.75rem', flexWrap: 'nowrap' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 22, height: 22, flex: 'none' }} />
      <span>{label}</span>
    </label>
  )
}

function CoversPicker({ pass, sessions, withSessions, countText, onCountText, onChange }: {
  pass: Pass; sessions: SessionRow[]; withSessions: boolean; countText: string; onCountText: (v: string) => void; onChange: (c: Pass['covers']) => void
}) {
  const c = pass.covers
  return (
    <div style={{ display: 'grid', gap: '0.3rem' }}>
      <select
        aria-label={`${pass.label || 'Pass'} covers`}
        className="field-input"
        style={input}
        value={c.kind}
        onChange={(e) => {
          const k = e.target.value as Pass['covers']['kind']
          onChange(k === 'choose' ? { kind: 'choose', count: 1 } : k === 'fixed' ? { kind: 'fixed', sessionIds: sessions.map((s) => s.id) } : { kind: k })
        }}
      >
        <option value="all">Every session</option>
        <option value="choose">They pick sessions</option>
        <option value="remaining">Sessions not started yet</option>
        {withSessions && <option value="fixed">Set sessions</option>}
      </select>
      {c.kind === 'choose' && (
        <label style={{ display: 'grid', gap: '0.2rem' }}>
          <span className="field-label">How many they pick</span>
          <input className="field-input" style={input} inputMode="numeric" aria-label={`${pass.label || 'Pass'} how many they pick`} value={countText} onChange={(e) => onCountText(e.target.value)} />
        </label>
      )}
      {c.kind === 'fixed' && sessions.map((s, i) => (
        <label key={s.id} style={{ ...row, minHeight: '2.75rem', flexWrap: 'nowrap' }}>
          <input
            type="checkbox"
            style={{ width: 22, height: 22 }}
            checked={c.sessionIds.includes(s.id)}
            onChange={(e) => onChange({ kind: 'fixed', sessionIds: e.target.checked ? [...c.sessionIds, s.id] : c.sessionIds.filter((id) => id !== s.id) })}
          />
          <span>Session {i + 1}</span>
        </label>
      ))}
    </div>
  )
}
