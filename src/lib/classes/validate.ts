/**
 * Validation for our own classes. Pure functions. Error messages are plain
 * sentences the owner reads in the class form.
 */
import type { AddOn, Cents, ClassContent, ClassRules, Pass, PassCovers, SeatQuestion, Session, TicketType } from './types'

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; field?: string }

const fail = (error: string, field?: string): { ok: false; error: string; field?: string } => ({ ok: false, error, field })

export function defaultRules(): ClassRules {
  return {
    ages: '',
    dropOff: false,
    madeToOrder: false,
    taxable: true,
    maxPerBooking: 10,
    signupCutoffHours: null,
    minimumToRun: null,
    linkOnly: false,
    joinPartway: true,
    waitlistCutoffHours: 2,
    canShareRoom: false,
  }
}

export function newId(prefix: 'cls' | 'ses' | 'lib' | 'blk' | 'pas' | 'tkt' | 'q' | 'add' | 'led' | 'bkg' | 'rfe'): string {
  let rand = ''
  while (rand.length < 4) rand += Math.random().toString(36).slice(2)
  return `${prefix}_${Date.now().toString(36)}${rand.slice(0, 4)}`
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
/** Full ISO datetime with Z or an offset, as a canonical Z string; null if not. */
export function toIso(v: unknown): string | null {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return null
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const inRange = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

function validateRules(raw: unknown): Result<ClassRules> {
  const base = defaultRules()
  if (raw === undefined || raw === null) return { ok: true, value: base }
  if (!isObj(raw)) return fail('The class rules are not readable.', 'rules')
  const r: ClassRules = { ...base }
  if (raw.ages !== undefined) r.ages = str(raw.ages)
  for (const k of ['dropOff', 'madeToOrder', 'taxable', 'linkOnly', 'joinPartway', 'canShareRoom'] as const) {
    // M5: only a real yes is yes; "false", 0 or "" never turn a rule on.
    if (raw[k] !== undefined) r[k] = raw[k] === true || raw[k] === 'true'
  }
  if (raw.maxPerBooking !== undefined) {
    if (!inRange(raw.maxPerBooking, 1, 40)) return fail('The most people per booking is 1 to 40.', 'rules.maxPerBooking')
    r.maxPerBooking = raw.maxPerBooking
  }
  if (raw.signupCutoffHours !== undefined && raw.signupCutoffHours !== null) {
    if (!inRange(raw.signupCutoffHours, 0, 720)) return fail('The sign-up cutoff is 0 to 720 hours.', 'rules.signupCutoffHours')
    r.signupCutoffHours = raw.signupCutoffHours
  }
  if (raw.waitlistCutoffHours !== undefined) {
    if (!inRange(raw.waitlistCutoffHours, 0, 720)) return fail('The waitlist cutoff is 0 to 720 hours.', 'rules.waitlistCutoffHours')
    r.waitlistCutoffHours = raw.waitlistCutoffHours
  }
  if (raw.minimumToRun !== undefined && raw.minimumToRun !== null) {
    const m = raw.minimumToRun
    const decideBy = isObj(m) ? toIso(m.decideByIso) : null
    if (!isObj(m) || !inRange(m.count, 1, 999) || !decideBy) {
      return fail('The minimum to run needs a head count and a decide-by date.', 'rules.minimumToRun')
    }
    r.minimumToRun = { count: m.count, decideByIso: decideBy }
  }
  return { ok: true, value: r }
}

function validateCovers(raw: unknown, label: string): Result<PassCovers> {
  if (!isObj(raw)) return fail(`${label} needs to say what it covers.`, 'passes')
  switch (raw.kind) {
    case 'all': return { ok: true, value: { kind: 'all' } }
    case 'remaining': return { ok: true, value: { kind: 'remaining' } }
    case 'choose':
      if (!inRange(raw.count, 1, 60)) return fail(`${label} needs to let people pick at least 1 session.`, 'passes')
      return { ok: true, value: { kind: 'choose', count: raw.count } }
    case 'fixed': {
      const ids = Array.isArray(raw.sessionIds) ? raw.sessionIds.map(String).filter(Boolean) : []
      if (ids.length < 1) return fail(`${label} needs at least one session.`, 'passes')
      return { ok: true, value: { kind: 'fixed', sessionIds: ids } }
    }
    default: return fail(`${label} needs to say what it covers.`, 'passes')
  }
}

export function validateContent(raw: unknown): Result<ClassContent> {
  if (!isObj(raw)) return fail('The class is not readable.')
  const name = str(raw.name)
  if (!name) return fail('Give the class a name.', 'name')
  if (name.length > 80) return fail('The class name can be up to 80 characters.', 'name')

  const rules = validateRules(raw.rules)
  if (!rules.ok) return rules

  const ticketsRaw = raw.ticketTypes === undefined ? [{ id: 'person', label: 'Person' }] : raw.ticketTypes
  if (!Array.isArray(ticketsRaw) || ticketsRaw.length < 1) return fail('Add at least one ticket type.', 'ticketTypes')
  const ticketTypes: TicketType[] = []
  for (const t of ticketsRaw) {
    const id = str(t?.id), label = str(t?.label)
    if (!id || !label) return fail('Each ticket type needs a name.', 'ticketTypes')
    if (ticketTypes.some((o) => o.id === id)) return fail('Each ticket type needs its own id.', 'ticketTypes')
    ticketTypes.push({ id, label })
  }

  if (!Array.isArray(raw.passes) || raw.passes.length < 1) return fail('Add at least one pass.', 'passes')
  const passes: Pass[] = []
  for (const p of raw.passes) {
    const id = str(p?.id), label = str(p?.label)
    if (!id || !label) return fail('Each pass needs a name.', 'passes')
    if (passes.some((o) => o.id === id)) return fail('Each pass needs its own id.', 'passes')
    const covers = validateCovers(p?.covers, label)
    if (!covers.ok) return covers
    passes.push({ id, label, covers: covers.value })
  }

  const prices: Record<string, Record<string, Cents>> = {}
  if (!isObj(raw.prices)) return fail('Add at least one price.', 'prices')
  let priceCount = 0
  for (const [passId, row] of Object.entries(raw.prices)) {
    if (!passes.some((p) => p.id === passId)) return fail('A price belongs to a pass that does not exist.', 'prices')
    if (!isObj(row)) return fail('A price row is not readable.', 'prices')
    for (const [tid, cents] of Object.entries(row)) {
      if (!ticketTypes.some((t) => t.id === tid)) return fail('A price belongs to a ticket type that does not exist.', 'prices')
      if (!isCents(cents)) return fail('Prices must be whole cents of zero or more.', 'prices')
      ;(prices[passId] ??= {})[tid] = cents
      priceCount++
    }
  }
  if (priceCount < 1) return fail('Add at least one price.', 'prices')

  const questions: SeatQuestion[] = []
  for (const q of Array.isArray(raw.questions) ? raw.questions : []) {
    const id = str(q?.id), label = str(q?.label)
    if (!id || !label) return fail('Each question needs a label.', 'questions')
    if (questions.some((o) => o.id === id)) return fail('Each question needs its own id.', 'questions')
    const choices = Array.isArray(q?.choices) ? q.choices.map(str).filter(Boolean) : []
    if (choices.length < 2) return fail(`${label} needs at least two choices.`, 'questions')
    questions.push({ id, label, choices })
  }

  const addOns: AddOn[] = []
  for (const a of Array.isArray(raw.addOns) ? raw.addOns : []) {
    const id = str(a?.id), label = str(a?.label)
    if (!id || !label) return fail('Each add-on needs a name.', 'addOns')
    if (addOns.some((o) => o.id === id)) return fail('Each add-on needs its own id.', 'addOns')
    if (!isCents(a?.priceCents)) return fail(`${label} needs a price of zero or more, in whole cents.`, 'addOns')
    const maxPerSeat = a?.maxPerSeat === undefined ? 1 : a.maxPerSeat
    if (!inRange(maxPerSeat, 1, 40)) return fail(`${label} can be added 1 to 40 times per seat.`, 'addOns')
    addOns.push({ id, label, priceCents: a.priceCents, maxPerSeat })
  }

  const defaultCapacity = raw.defaultCapacity === undefined ? 12 : raw.defaultCapacity
  if (!inRange(defaultCapacity, 1, 999)) return fail('The default capacity is 1 to 999.', 'defaultCapacity')
  const defaultMinutes = raw.defaultMinutes === undefined ? 90 : raw.defaultMinutes
  if (!inRange(defaultMinutes, 5, 1440)) return fail('The default length is 5 to 1440 minutes.', 'defaultMinutes')

  const image = str(raw.imageUrl)
  return {
    ok: true,
    value: {
      name,
      description: typeof raw.description === 'string' ? raw.description.trim() : '',
      imageUrl: image || null,
      instructor: str(raw.instructor) || null,
      rules: rules.value,
      ticketTypes,
      passes,
      prices,
      questions,
      addOns,
      defaultCapacity,
      defaultMinutes,
    },
  }
}

export const MAX_SESSIONS = 60

export function validateSessions(raw: unknown): Result<Session[]> {
  if (!Array.isArray(raw) || raw.length < 1) return fail('Add at least one session.', 'sessions')
  if (raw.length > MAX_SESSIONS) return fail(`A class can have up to ${MAX_SESSIONS} sessions.`, 'sessions')
  const out: Session[] = []
  for (const s of raw) {
    const id = str(s?.id)
    if (!id) return fail('Each session needs an id.', 'sessions')
    if (out.some((o) => o.id === id)) return fail('Each session needs its own id.', 'sessions')
    const startIso = toIso(s?.startIso), endIso = toIso(s?.endIso)
    if (!startIso || !endIso) return fail('Each session needs a start and an end time.', 'sessions')
    if (Date.parse(endIso) <= Date.parse(startIso)) return fail('A session has to end after it starts.', 'sessions')
    if (!inRange(s?.capacity, 1, 999)) return fail('Session capacity is 1 to 999.', 'sessions')
    out.push({ id, startIso, endIso, capacity: s.capacity })
  }
  out.sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
  for (let i = 1; i < out.length; i++) {
    if (Date.parse(out[i].startIso) < Date.parse(out[i - 1].endIso)) return fail('Two sessions of the same class overlap.', 'sessions')
  }
  return { ok: true, value: out }
}

export function sellableCells(content: ClassContent): { passId: string; ticketTypeId: string; cents: Cents }[] {
  const cells: { passId: string; ticketTypeId: string; cents: Cents }[] = []
  for (const p of content.passes) {
    for (const t of content.ticketTypes) {
      const cents = content.prices[p.id]?.[t.id]
      if (cents !== undefined) cells.push({ passId: p.id, ticketTypeId: t.id, cents })
    }
  }
  return cells
}
