/**
 * A class's details as the /admin forms hold them (typed text, so a box can
 * be cleared and retyped), and the checks that turn them back into
 * ClassContent. Used by the class sheet's Details tab, New class and the
 * library's Edit details. Dates live in DateRows, not here.
 */
import type { AddOn, ClassContent, ClassRules, Pass, SeatQuestion, Session, TicketType } from '@lib/classes/types'
import { defaultRules, newId } from '@lib/classes/validate'
import { partsOf, toIsoAt } from './dates'
import { previewData } from './preview'

export interface AddOnRow { id: string; label: string; price: string; maxPerSeat: string }
export interface QuestionRow { id: string; label: string; choices: string }
export interface Form {
  name: string
  description: string
  imageUrl: string | null
  instructor: string
  ages: string
  ticketTypes: TicketType[]
  passes: Pass[]
  /** prices[passId][ticketTypeId] as typed; '' or missing = not sold. */
  prices: Record<string, Record<string, string>>
  questions: QuestionRow[]
  addOns: AddOnRow[]
  rules: ClassRules
  cutoff: string
  maxPerBooking: string
  /** "How many they pick" per 'choose' pass, as typed. */
  chooseCounts: Record<string, string>
  /** Minimum to run: "Needs [count] by [day] [time]", studio time. */
  minCount: string
  minDay: string
  minTime: string
  /** Library only: how long it usually runs (minutes) and the seats it usually has. */
  defaultMinutes: string
  defaultCapacity: string
}

/** Where an error shows, in the order the form reads (the first one gets the focus). */
export const FIELD_ORDER = ['photo', 'name', 'price', 'ages', 'description', 'dates', 'prices', 'tickets', 'addons', 'questions', 'rules', 'usual'] as const
export type FieldKey = (typeof FIELD_ORDER)[number]
export type Errors = Partial<Record<FieldKey | 'form', string>>
/** Errors that live under More options. */
export const MORE_KEYS: FieldKey[] = ['prices', 'tickets', 'addons', 'questions', 'rules']

/** "Fix the price." for the footer line, so an error far up the form is never missed. */
const WHAT: Record<FieldKey, string> = {
  photo: 'the photo', name: 'the name', price: 'the price', ages: 'the ages', description: 'the description', dates: 'the dates',
  prices: 'the prices under Ways to book', tickets: 'Seat prices', addons: 'the extras', questions: 'the questions', rules: 'Ages and booking rules',
  usual: 'the usual length or seats',
}
export function firstError(e: Errors): FieldKey | null {
  return FIELD_ORDER.find((k) => e[k]) ?? null
}
export function fixLine(e: Errors, where = ''): string {
  const k = firstError(e)
  return k ? `Fix ${WHAT[k]}${where ? ` ${where}` : ''}.` : ''
}

export const dollars = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2))
const MONEY_RE = /^\d+(\.\d{1,2})?$/
const toCents = (s: string) => Math.round(parseFloat(s) * 100)
export const intOf = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN)

export function blankContent(): ClassContent {
  return {
    name: '', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [{ id: newId('pas'), label: 'Full class', covers: { kind: 'all' } }],
    prices: {}, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 120,
  }
}

export function toForm(content: ClassContent): Form {
  const prices: Form['prices'] = {}
  for (const [p, cells] of Object.entries(content.prices)) for (const [t, c] of Object.entries(cells)) (prices[p] ??= {})[t] = dollars(c)
  const r = content.rules
  const min = r.minimumToRun ? partsOf(r.minimumToRun.decideByIso) : null
  return {
    name: content.name, description: content.description, imageUrl: content.imageUrl, instructor: content.instructor ?? '',
    ages: r.ages,
    ticketTypes: content.ticketTypes.map((t) => ({ ...t })), passes: structuredClone(content.passes), prices,
    questions: content.questions.map((q) => ({ id: q.id, label: q.label, choices: q.choices.join(', ') })),
    addOns: content.addOns.map((a) => ({ id: a.id, label: a.label, price: dollars(a.priceCents), maxPerSeat: String(a.maxPerSeat) })),
    rules: { ...r },
    cutoff: r.signupCutoffHours === null ? '' : String(r.signupCutoffHours),
    maxPerBooking: String(r.maxPerBooking),
    chooseCounts: Object.fromEntries(content.passes.flatMap((p) => (p.covers.kind === 'choose' ? [[p.id, String(p.covers.count)]] : []))),
    minCount: r.minimumToRun ? String(r.minimumToRun.count) : '',
    minDay: min?.day ?? '',
    minTime: min?.time ?? '',
    defaultMinutes: String(content.defaultMinutes),
    defaultCapacity: String(content.defaultCapacity),
  }
}

/** One price for one kind of seat: the price box sits with the name, not under More options. */
export const isSimple = (f: Pick<Form, 'passes' | 'ticketTypes'>) => f.passes.length === 1 && f.ticketTypes.length === 1

/** Anything set under More options, so it opens on its own. */
export function hasMore(f: Form): boolean {
  return !isSimple(f)
    || f.ticketTypes[0]?.label !== 'Person'
    || f.passes[0]?.covers.kind !== 'all'
    || f.questions.length > 0
    || f.addOns.length > 0
    || !!f.instructor.trim()
    || !!f.cutoff.trim() || !!f.minCount.trim() || !!f.minDay
    || JSON.stringify({ ...f.rules, ages: '', signupCutoffHours: null, minimumToRun: null, maxPerBooking: 10 }) !== JSON.stringify({ ...defaultRules(), signupCutoffHours: null, minimumToRun: null })
    || f.maxPerBooking.trim() !== String(defaultRules().maxPerBooking)
}

/** Which field a server refusal's `field` belongs to. */
export function fieldOf(field: string | undefined, f: Form): FieldKey | 'form' {
  if (!field) return 'form'
  const head = field.split('.')[0]
  if (head === 'sessions') return 'dates'
  if (head === 'prices') return isSimple(f) ? 'price' : 'prices'
  if (head === 'passes') return 'prices'
  if (head === 'ticketTypes') return 'tickets'
  if (head === 'questions') return 'questions'
  if (head === 'addOns') return 'addons'
  if (head === 'rules') return field === 'rules.ages' ? 'ages' : 'rules'
  if (head === 'defaultCapacity' || head === 'defaultMinutes') return 'usual'
  if (head === 'imageUrl') return 'photo'
  if (head === 'description') return 'description'
  return 'name'
}

export type Built = { ok: true; content: ClassContent } | { ok: false; errors: Errors }

/** The form as ClassContent, or what to fix. `usual`: the library's usual length and seats are typed (Edit details). */
export function build(f: Form, opts: { usual?: boolean } = {}): Built {
  const errors: Errors = {}
  const name = f.name.trim()
  if (!name) errors.name = 'Give the class a name.'

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
  if (!priceError && !Object.keys(prices).length) priceError = 'Add a price.'
  if (f.passes.some((p) => !p.label.trim())) priceError ||= 'Each way to book needs a name.'
  if (priceError) errors[isSimple(f) ? 'price' : 'prices'] = priceError
  if (f.ticketTypes.some((t) => !t.label.trim())) errors.tickets = 'Each kind of seat needs a name.'
  const passes: Pass[] = []
  for (const p of f.passes) {
    const label = p.label.trim()
    if (p.covers.kind !== 'choose') { passes.push({ ...p, label }); continue }
    const count = intOf(f.chooseCounts[p.id] ?? String(p.covers.count))
    if (!(count >= 1 && count <= 60)) { errors.prices ||= `${label || 'A way to book'} needs to let people pick 1 to 60 dates.`; continue }
    passes.push({ ...p, label, covers: { kind: 'choose', count } })
  }

  const defaultCapacity = intOf(f.defaultCapacity), defaultMinutes = intOf(f.defaultMinutes)
  if (!(defaultCapacity >= 1 && defaultCapacity <= 999)) errors.usual = 'The seats it usually has is 1 to 999.'
  else if (!(defaultMinutes >= 5 && defaultMinutes <= 1440)) errors.usual = 'How long it usually runs is 5 to 1440 minutes.'
  if (!opts.usual && errors.usual) delete errors.usual

  const addOns: AddOn[] = []
  for (const a of f.addOns) {
    const price = a.price.trim().replace(/^\$/, '')
    if (!a.label.trim()) { errors.addons = 'Each extra needs a name.'; break }
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

  const rules: ClassRules = { ...f.rules, ages: f.ages.trim() }
  const cutoff = f.cutoff.trim()
  if (cutoff) {
    const n = intOf(cutoff)
    if (!(n >= 0 && n <= 720)) errors.rules = 'Sign-ups close 0 to 720 hours before.'
    else rules.signupCutoffHours = n
  } else rules.signupCutoffHours = null
  if (f.minCount.trim() || f.minDay || f.minTime) {
    const n = intOf(f.minCount)
    if (!(n >= 1 && n <= 999) || !f.minDay || !f.minTime) errors.rules = 'The minimum to run needs how many, a day and a time.'
    else rules.minimumToRun = { count: n, decideByIso: toIsoAt(f.minDay, f.minTime) }
  } else rules.minimumToRun = null
  const maxPer = intOf(f.maxPerBooking)
  if (!(maxPer >= 1 && maxPer <= 40)) errors.rules = 'The most people per booking is 1 to 40.'
  else rules.maxPerBooking = maxPer

  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    content: {
      name, description: f.description.trim(), imageUrl: f.imageUrl, instructor: f.instructor.trim() || null, rules,
      ticketTypes: f.ticketTypes.map((t) => ({ id: t.id, label: t.label.trim() })),
      passes, prices, questions, addOns,
      defaultCapacity: Number.isNaN(defaultCapacity) ? 12 : defaultCapacity,
      defaultMinutes: Number.isNaN(defaultMinutes) ? 120 : defaultMinutes,
    },
  }
}

/** What the preview card can draw from a half-typed form: never throws. */
export function previewOf(f: Form, sessions: Session[]) {
  const prices: ClassContent['prices'] = {}
  for (const p of f.passes) for (const t of f.ticketTypes) {
    const v = (f.prices[p.id]?.[t.id] ?? '').trim().replace(/^\$/, '')
    if (MONEY_RE.test(v)) (prices[p.id] ??= {})[t.id] = toCents(v)
  }
  const content: ClassContent = {
    ...blankContent(), name: f.name, description: f.description, imageUrl: f.imageUrl, instructor: f.instructor || null,
    rules: { ...f.rules, ages: f.ages }, ticketTypes: f.ticketTypes.map((t, i) => ({ ...t, label: t.label || `Seat ${i + 1}` })), prices,
    passes: f.passes.map((p) => (p.covers.kind === 'choose' ? { ...p, covers: { kind: 'choose' as const, count: intOf(f.chooseCounts[p.id] ?? '') || 1 } } : p)),
    defaultMinutes: intOf(f.defaultMinutes) || 120, defaultCapacity: intOf(f.defaultCapacity) || 12,
  }
  return previewData(content, sessions)
}
