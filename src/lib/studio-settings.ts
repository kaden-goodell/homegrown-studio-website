/**
 * Studio settings the owners edit on /admin: the studio's weekly hours (which
 * also say which weekdays it opens), Craft Café's weekly hours, its special
 * days, and the closed days. One document, written compare-and-set,
 * with the last 50 changes kept (who, when, what, and what it was before).
 *
 * Until an owner first saves, there is no document and everything reads the
 * config (src/config/hours.ts, src/config/closures.ts): production behaves
 * exactly as it did before this existed. A document saved before studio hours
 * were editable has none: the config's studio hours apply until a save adds them.
 *
 * Readers on the server call getStudioDays() (or getClosures()/getCafeHours())
 * and pass the answer to the pure date rules (closureOn, studioOpenOn,
 * cafeHoursOn, cafeRunsOn, partyStartsForDate…). The answer is remembered for
 * 60 seconds per server instance; a save replaces it at once on the instance
 * that saved.
 *
 * Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { assertClassWritesAllowed } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import type { By } from '@lib/staff-auth'
import type { Closure, Holiday } from '@config/closures'
import { CONFIG_STUDIO_WEEKLY, WEEKDAYS, type CafeSpecialDay, type CafeWeekly, type Weekday } from '@config/hours'
import { CONFIG_STUDIO_DAYS, type StudioDays } from '@config/studio-days'
import type { CafeHours } from '@config/hours'
import { SettingsError } from '@lib/settings-error'
import { CAS_ATTEMPTS, casPause } from '@lib/cas-retry'

const logger = createLogger('studio-settings')
const kv = makeKvStore('studio-settings', 'studio-settings')
const KEY = 'settings'
export const CACHE_MS = 60_000
export const HISTORY_CAP = 50
export const NAME_MAX = 60
const MAX_ROWS = 120
const HOLIDAYS: Holiday[] = ['halloween', 'thanksgiving', 'christmas']

export interface StoredClosure extends Closure { id: string }

/** What an owner edits. */
export interface SettingsInput {
  /** The studio's weekly hours: one row per open weekday. */
  studioWeekly: CafeWeekly[]
  cafeWeekly: CafeWeekly[]
  cafeSpecialDays: CafeSpecialDay[]
  closures: StoredClosure[]
}

export interface SettingsChange {
  at: string
  by: By
  /** In the owner's words: "Craft Café hours", "Added a special day: Sat Nov 7", "Removed a closed day: Thanksgiving" */
  changed: string[]
  before: SettingsInput
}

export interface StudioSettings extends SettingsInput {
  updatedAt: string
  by: By
  history: SettingsChange[]
}

/** The settings as the owners see them: what's saved, or the config when nothing is. */
export interface SettingsView extends SettingsInput {
  /** null until an owner first saves (the config is in use). */
  updatedAt: string | null
  by: By | null
  history: SettingsChange[]
}

export { SettingsError }

/** The config as editable settings. Config closures get a stable id from their first day. */
export function configSettings(): SettingsInput {
  return {
    studioWeekly: CONFIG_STUDIO_DAYS.studio.map((w) => ({ ...w })),
    cafeWeekly: CONFIG_STUDIO_DAYS.cafe.weekly.map((w) => ({ ...w })),
    cafeSpecialDays: CONFIG_STUDIO_DAYS.cafe.special.map((d) => ({ ...d })),
    closures: CONFIG_STUDIO_DAYS.closures.map((c) => ({ ...c, id: c.id ?? `cfg-${c.from}` })),
  }
}

export function toStudioDays(s: SettingsInput): StudioDays {
  return {
    closures: s.closures,
    cafe: { weekly: s.cafeWeekly, special: s.cafeSpecialDays },
    studio: s.studioWeekly,
  }
}

// ---------------------------------------------------------------- validation

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const YMD = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[A-Za-z0-9_-]{1,40}$/

function realDate(s: unknown): s is string {
  if (typeof s !== 'string' || !YMD.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function times(opens: unknown, closes: unknown, field: string): { opens: string; closes: string } {
  if (typeof opens !== 'string' || !HHMM.test(opens)) throw new SettingsError(400, 'Pick when it opens.', field)
  if (typeof closes !== 'string' || !HHMM.test(closes)) throw new SettingsError(400, 'Pick when it closes.', field)
  if (closes <= opens) throw new SettingsError(400, 'It has to close after it opens.', field)
  return { opens, closes }
}

function name(v: unknown, field: string, fallback: string): string {
  const n = str(v).replace(/\s+/g, ' ')
  if (n.length > NAME_MAX) throw new SettingsError(400, `Keep the name to ${NAME_MAX} characters.`, field)
  return n || fallback
}

/**
 * A special day's announcement (the site-wide bar and the big card, and the
 * flyer's headline): owners set it in /admin › Hours & Craft Café ("Announce it
 * on the website": a headline up to 60 characters, shown from 0–90 days
 * before). Anything malformed is left off.
 */
function announceOf(v: any): CafeSpecialDay['announce'] | undefined {
  const headline = str(v?.headline).replace(/\s+/g, ' ')
  const daysBefore = Number(v?.daysBefore)
  if (!headline || headline.length > NAME_MAX || !Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 90) return undefined
  return { headline, daysBefore }
}

let idSeq = 0
function newClosureId(): string {
  idSeq = (idSeq + 1) % 1000
  return `clo_${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1

/**
 * Checks and tidies what an owner sent. Throws a SettingsError naming the
 * field (`cafeWeekly.0`, `cafeSpecialDays.2`, `closures.1`) on the first problem.
 */
export function validateSettings(body: any, current: { studioWeekly: CafeWeekly[] } = { studioWeekly: CONFIG_STUDIO_WEEKLY }): SettingsInput {
  if (!body || typeof body !== 'object') throw new SettingsError(400, 'Nothing to save.')
  // A page loaded before studio hours were editable sends none: keep what's in force.
  const studioIn = Array.isArray(body.studioWeekly) ? body.studioWeekly : body.studioWeekly === undefined ? current.studioWeekly : null
  if (!studioIn) throw new SettingsError(400, 'Send the studio hours.', 'studioWeekly')
  if (studioIn.length > 7) throw new SettingsError(400, 'That is more rows than the studio needs.', 'studioWeekly')
  const studioWeekly: CafeWeekly[] = studioIn.map((w: any, i: number) => {
    const field = `studioWeekly.${i}`
    if (!WEEKDAYS.includes(w?.weekday)) throw new SettingsError(400, 'Pick a day of the week.', field)
    return { weekday: w.weekday as Weekday, ...times(w.opens, w.closes, field) }
  })
  const seenStudio = new Set<string>()
  studioWeekly.forEach((w, i) => {
    if (seenStudio.has(w.weekday)) throw new SettingsError(400, `${w.weekday} is in the list twice.`, `studioWeekly.${i}`)
    seenStudio.add(w.weekday)
  })
  if (!studioWeekly.length) throw new SettingsError(400, 'Keep at least one open day. To close for a while, add closed days instead.', 'studioWeekly')
  studioWeekly.sort((a, b) => WEEK_ORDER.indexOf(a.weekday) - WEEK_ORDER.indexOf(b.weekday))
  const weeklyIn = Array.isArray(body.cafeWeekly) ? body.cafeWeekly : null
  const specialIn = Array.isArray(body.cafeSpecialDays) ? body.cafeSpecialDays : null
  const closuresIn = Array.isArray(body.closures) ? body.closures : null
  if (!weeklyIn || !specialIn || !closuresIn) throw new SettingsError(400, 'Send the café hours, special days and closed days together.')
  if (weeklyIn.length > 7 || specialIn.length > MAX_ROWS || closuresIn.length > MAX_ROWS) throw new SettingsError(400, 'That is more rows than the studio needs.')

  const cafeWeekly: CafeWeekly[] = weeklyIn.map((w: any, i: number) => {
    const field = `cafeWeekly.${i}`
    if (!WEEKDAYS.includes(w?.weekday)) throw new SettingsError(400, 'Pick a day of the week.', field)
    return { weekday: w.weekday as Weekday, ...times(w.opens, w.closes, field) }
  })
  const seenDays = new Set<string>()
  cafeWeekly.forEach((w, i) => {
    if (seenDays.has(w.weekday)) throw new SettingsError(400, `${w.weekday} is in the list twice.`, `cafeWeekly.${i}`)
    seenDays.add(w.weekday)
    // Weekly café runs inside the studio's hours; a special day can be any day.
    const open = studioWeekly.find((s) => s.weekday === w.weekday)
    if (!open) throw new SettingsError(400, `The studio is closed on ${w.weekday}s. Add ${w.weekday} studio hours first, or make it a special day.`, `cafeWeekly.${i}`)
    if (w.opens < open.opens || w.closes > open.closes) {
      throw new SettingsError(400, `Craft Café on ${w.weekday}s has to be inside the studio hours (${clock(open.opens)} – ${clock(open.closes)}).`, `cafeWeekly.${i}`)
    }
  })

  const cafeSpecialDays: CafeSpecialDay[] = specialIn.map((d: any, i: number) => {
    const field = `cafeSpecialDays.${i}`
    if (!realDate(d?.date)) throw new SettingsError(400, 'Pick the day.', field)
    const announce = announceOf(d.announce)
    return { date: d.date, ...times(d.opens, d.closes, field), name: name(d.name, field, 'Special hours'), ...(announce ? { announce } : {}) }
  })
  const seenDates = new Set<string>()
  cafeSpecialDays.forEach((d, i) => {
    if (seenDates.has(d.date)) throw new SettingsError(400, 'That day already has special hours.', `cafeSpecialDays.${i}`)
    seenDates.add(d.date)
  })
  cafeSpecialDays.sort((a, b) => a.date.localeCompare(b.date))

  const ids = new Set<string>()
  const closures: StoredClosure[] = closuresIn.map((c: any, i: number) => {
    const field = `closures.${i}`
    if (!realDate(c?.from)) throw new SettingsError(400, 'Pick the first closed day.', field)
    const to = c.to === undefined || c.to === null || c.to === '' ? c.from : c.to
    if (!realDate(to)) throw new SettingsError(400, 'Pick the last closed day, or leave it blank for one day.', field)
    if (to < c.from) throw new SettingsError(400, 'The last closed day can’t be before the first.', field)
    if (dayCount(c.from, to) > 366) throw new SettingsError(400, 'Close up to a year at a time.', field)
    let id = typeof c.id === 'string' && ID.test(c.id) ? c.id : newClosureId()
    while (ids.has(id)) id = newClosureId()
    ids.add(id)
    const holiday = HOLIDAYS.includes(c.holiday) ? (c.holiday as Holiday) : undefined
    return { id, from: c.from, to, name: name(c.name, field, 'a break'), ...(holiday ? { holiday } : {}) }
  })
  closures.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  return { studioWeekly, cafeWeekly, cafeSpecialDays, closures }
}

const WEEK_ORDER: Weekday[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** 09:00 → "9 AM", 13:30 → "1:30 PM". */
function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}

// ---------------------------------------------------------------- what changed

const label = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const rangeLabel = (c: Closure) => (c.from === c.to ? label(c.from) : `${label(c.from)} – ${label(c.to)}`)

/** The closures that are new or whose days changed: the ones to check bookings against. */
export function addedClosures(before: Closure[], after: StoredClosure[]): StoredClosure[] {
  return after.filter((c) => !before.some((b) => b.from === c.from && b.to === c.to))
}

/** What changed, in plain words, for the history and the audit log. */
export function describeChanges(before: SettingsInput, after: SettingsInput): string[] {
  const out: string[] = []
  const wk = (l: CafeWeekly[]) => JSON.stringify([...l].sort((a, b) => a.weekday.localeCompare(b.weekday)))
  if (wk(before.studioWeekly ?? CONFIG_STUDIO_WEEKLY) !== wk(after.studioWeekly)) out.push('Studio hours')
  if (wk(before.cafeWeekly) !== wk(after.cafeWeekly)) out.push('Craft Café weekly hours')
  for (const d of after.cafeSpecialDays) {
    const was = before.cafeSpecialDays.find((x) => x.date === d.date)
    if (!was) out.push(`Added a special day: ${label(d.date)}`)
    else if (was.opens !== d.opens || was.closes !== d.closes || was.name !== d.name) out.push(`Changed a special day: ${label(d.date)}`)
    else if (JSON.stringify(was.announce ?? null) !== JSON.stringify(d.announce ?? null)) out.push(`${d.announce ? 'Announced' : 'Stopped announcing'} a special day: ${label(d.date)}`)
  }
  for (const d of before.cafeSpecialDays) if (!after.cafeSpecialDays.some((x) => x.date === d.date)) out.push(`Removed a special day: ${label(d.date)}`)
  const sameClosure = (a: Closure, b: Closure) => a.from === b.from && a.to === b.to && a.name === b.name && (a.holiday ?? '') === (b.holiday ?? '')
  for (const c of after.closures) if (!before.closures.some((b) => sameClosure(b, c))) out.push(`Closed ${rangeLabel(c)} (${c.name})`)
  for (const c of before.closures) if (!after.closures.some((a) => sameClosure(a, c))) out.push(`Removed a closed day: ${rangeLabel(c)} (${c.name})`)
  return out
}

// ---------------------------------------------------------------- reading

let cached: { at: number; days: StudioDays } | null = null

function parse(json: string): StudioSettings {
  const s = JSON.parse(json) as StudioSettings
  return { ...s, studioWeekly: s.studioWeekly ?? CONFIG_STUDIO_WEEKLY.map((w) => ({ ...w })), cafeWeekly: s.cafeWeekly ?? [], cafeSpecialDays: s.cafeSpecialDays ?? [], closures: s.closures ?? [], history: s.history ?? [] }
}

/**
 * The closed days and café hours a stored settings document means: the
 * document's, or the config when there is none. The one rule getStudioDays
 * uses, shared with scripts that read the production store themselves.
 */
export function studioDaysFromJson(json: string | null): StudioDays {
  return json ? toStudioDays(parse(json)) : CONFIG_STUDIO_DAYS
}

/** The stored settings, or null when an owner has never saved (the config is in use). Throws when the store can't be read. */
export async function readStudioSettings(): Promise<StudioSettings | null> {
  const json = await kv.get(KEY)
  return json ? parse(json) : null
}

/** For /admin: what's saved, or the config dressed as settings. */
export async function getSettingsView(): Promise<SettingsView> {
  const s = await readStudioSettings()
  if (!s) return { ...configSettings(), updatedAt: null, by: null, history: [] }
  return s
}

/**
 * The closed days and café hours every page and rule uses. Remembered for a
 * minute. When the store can't be read: the last answer this server had, or,
 * with none, the config (logged). `strict` throws instead of falling back to
 * the config (room-clash checks, which never guess).
 */
export async function getStudioDays(opts: { strict?: boolean; fresh?: boolean } = {}): Promise<StudioDays> {
  const now = Date.now()
  if (cached && !opts.fresh && now - cached.at < CACHE_MS) return cached.days
  try {
    const s = await readStudioSettings()
    const days = s ? toStudioDays(s) : CONFIG_STUDIO_DAYS
    cached = { at: now, days }
    return days
  } catch (e) {
    logger.error('Studio settings could not be read', { error: e instanceof Error ? e.message : String(e) })
    if (cached) return cached.days
    if (opts.strict) throw e
    return CONFIG_STUDIO_DAYS
  }
}

export async function getClosures(opts: { strict?: boolean; fresh?: boolean } = {}): Promise<Closure[]> {
  return (await getStudioDays(opts)).closures
}

export async function getCafeHours(opts: { strict?: boolean; fresh?: boolean } = {}): Promise<CafeHours> {
  return (await getStudioDays(opts)).cafe
}

/** Forget the remembered answer (tests). */
export function resetStudioDaysCache(): void {
  cached = null
}

// ---------------------------------------------------------------- writing

export class StaleSettingsError extends SettingsError {
  constructor(public current: SettingsView) { super(409, 'Someone else changed these settings. Check them and save again.') }
}

/**
 * Saves the owners' settings. `expectedUpdatedAt` is what they loaded (null
 * when they were looking at the config): anything newer is refused as stale,
 * with the current settings. Returns the saved settings and what was there
 * before.
 */
export async function saveStudioSettings(
  input: SettingsInput,
  opts: { expectedUpdatedAt: string | null; by: By; now?: Date },
): Promise<{ saved: StudioSettings; before: SettingsInput; changed: string[] }> {
  assertClassWritesAllowed() // R41: never the live café hours or closed days from a test site
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    await casPause(attempt)
    const { value, etag } = await kv.getWithMeta(KEY)
    const cur = value ? parse(value) : null
    if ((cur?.updatedAt ?? null) !== (opts.expectedUpdatedAt ?? null)) {
      throw new StaleSettingsError(cur ?? { ...configSettings(), updatedAt: null, by: null, history: [] })
    }
    const before: SettingsInput = cur
      ? { studioWeekly: cur.studioWeekly, cafeWeekly: cur.cafeWeekly, cafeSpecialDays: cur.cafeSpecialDays, closures: cur.closures }
      : configSettings()
    const changed = describeChanges(before, input)
    const now = opts.now ?? new Date()
    // updatedAt only moves forward, so a stale guard can never match a later save by accident.
    const stamp = cur && now.toISOString() <= cur.updatedAt ? new Date(Date.parse(cur.updatedAt) + 1).toISOString() : now.toISOString()
    const history = [{ at: stamp, by: opts.by, changed, before }, ...(cur?.history ?? [])].slice(0, HISTORY_CAP)
    const saved: StudioSettings = { ...input, updatedAt: stamp, by: opts.by, history }
    if (await kv.setIfMatch(KEY, JSON.stringify(saved), etag, value !== null)) {
      cached = { at: Date.now(), days: toStudioDays(saved) }
      return { saved, before, changed }
    }
  }
  throw new SettingsError(503, 'Someone else is saving at the same moment. Try again.')
}
