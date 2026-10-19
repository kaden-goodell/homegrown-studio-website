/**
 * Party times as pure rules over the owners' party settings: which days and
 * starts are on offer, the checks on what an owner saves, and the facts the
 * public booking page needs. Every booking path, the calendar and the
 * browser use these with the settings they loaded (getPartySettings() on the
 * server; the API payload in the browser).
 *
 * Until an owner first saves Parties setup, the settings are the config
 * (configPartySettings()), and the answers are exactly today's: the
 * equivalence is pinned by tests/lib/parties/party-times.test.ts.
 *
 * Cleanup (60 minutes) and the Craft Café gap (60 minutes) stay in code
 * (S2-R11), not settings.
 *
 * Client-safe: no `node:` imports, no stores, no env.
 */
import { partyConfig, partyDays, partyDateOverrides, CAFE_PARTY_GAP_MINUTES } from '../../config/party.config'
import { closureOn } from '../../config/closures'
import { STUDIO_HOURS, WEEKDAYS } from '../../config/hours'
import { CONFIG_STUDIO_DAYS, type StudioDays } from '../../config/studio-days'
import { cafeOn } from '../cafe-days'
import { SettingsError } from '../settings-error'
import type { PartyAddOn, PartyPackage, PartySettings, PartySettingsInput, PartyTimes, WeekdayKey } from './types'

/** = partyConfig.cleanupBufferMinutes (S2-R11: code, not settings). */
export const PARTY_CLEANUP_MINUTES = 60

const DAY_MS = 86_400_000
const WEEKDAY_KEYS: WeekdayKey[] = ['0', '1', '2', '3', '4', '5', '6']

// ---------------------------------------------------------------- studio-local time

/** Local hour (0–23) of an ISO timestamp in the studio's timezone. */
export function localHour(iso: string, tz: string = partyConfig.timezone): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: tz,
  }).formatToParts(new Date(iso))
  return parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
}

/** Local YYYY-MM-DD of an ISO timestamp in the studio's timezone. */
export function localDate(iso: string, tz: string = partyConfig.timezone): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: tz,
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Convert a studio-local date (YYYY-MM-DD) + time (HH:MM) to a UTC ISO string. */
export function localToUtcISO(ymd: string, hhmm: string, tz: string = partyConfig.timezone): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm))
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(guess)
  const p: Record<string, string> = {}
  for (const x of parts) p[x.type] = x.value
  const asSeen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  const offset = asSeen - guess.getTime()
  return new Date(guess.getTime() - offset).toISOString()
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

const hhmmOf = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`

function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

/** Studio-local YYYY-MM-DD, `days` after the studio's today. */
function studioDatePlus(days: number, now: Date): string {
  const [y, m, d] = localDate(now.toISOString()).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10)
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

// ---------------------------------------------------------------- the config as settings

/** Today's step rule: from firstStart, every (party + cleanup), while start + party + cleanup ≤ lastWrap. */
function stepStarts(cfg: { firstStart: string; lastWrap: string }): string[] {
  const step = partyConfig.durationMinutes + partyConfig.cleanupBufferMinutes
  const wrap = minutesOfDay(cfg.lastWrap)
  const out: string[] = []
  for (let t = minutesOfDay(cfg.firstStart); t + step <= wrap; t += step) out.push(hhmmOf(t))
  return out
}

/** The config (party.config.ts) as party settings: what is used until an owner first saves. */
export function configPartySettings(): PartySettings {
  const weekly = Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, partyDays[Number(k)] ? stepStarts(partyDays[Number(k)]) : []])) as PartyTimes['weekly']
  const dates = Object.fromEntries(Object.entries(partyDateOverrides).sort(([a], [b]) => a.localeCompare(b)).map(([ymd, cfg]) => [ymd, stepStarts(cfg)]))
  return {
    times: {
      weekly,
      dates,
      bookingWindowDays: partyConfig.bookingWindowDays,
      minLeadDays: partyConfig.minLeadDays,
      opensDate: partyConfig.bookingOpensDate,
    },
    packages: [{
      id: 'pkg_whole',
      name: 'Whole studio',
      priceCents: partyConfig.basePriceCents,
      minutes: partyConfig.durationMinutes,
      minGuests: partyConfig.minGuests,
      maxGuests: partyConfig.maxGuests,
      defaultGuests: partyConfig.defaultGuests,
      quickPicks: [...partyConfig.guestQuickPicks],
      who: 'everyone',
      archived: false,
    }],
    addOns: [],
    readSquareBookings: true,
    updatedAt: null,
    by: null,
    history: [],
  }
}

// ---------------------------------------------------------------- which days and starts

/** The studio-local 'HH:MM' starts set for a date: its dated entry, else its weekday's. Sorted. */
export function startsOn(t: PartyTimes, ymd: string): string[] {
  const list = has(t.dates, ymd) ? t.dates[ymd] : t.weekly[String(weekdayOf(ymd)) as WeekdayKey]
  return [...(list ?? [])].sort()
}

/**
 * The dates a party can be booked for online, both ends included
 * (studio-local YYYY-MM-DD): not before the first party day (a dated day
 * with times before it pulls the start back), not with less than the notice,
 * not further ahead than the window.
 */
export function bookableDates(t: PartyTimes, now: Date): { first: string; last: string } {
  const soonest = studioDatePlus(t.minLeadDays, now)
  const early = Object.keys(t.dates).filter((d) => t.dates[d].length > 0 && d >= soonest && d < t.opensDate).sort()[0]
  const opens = early ?? t.opensDate
  return { first: soonest > opens ? soonest : opens, last: studioDatePlus(t.bookingWindowDays, now) }
}

/** Why a date is or isn't on offer online. */
export function bookableOn(t: PartyTimes, ymd: string, now: Date, days: StudioDays): 'ok' | 'before_opening' | 'closed' | 'too_soon' | 'too_far' {
  if (ymd < t.opensDate && !(has(t.dates, ymd) && t.dates[ymd].length > 0)) return 'before_opening'
  if (closureOn(ymd, days.closures)) return 'closed'
  const { first, last } = bookableDates(t, now)
  if (ymd < first) return 'too_soon'
  if (ymd > last) return 'too_far'
  return 'ok'
}

/** The shortest package everyone can book: what the café gap is measured with by default. */
function defaultMinutes(s: PartySettingsInput): number {
  const open = s.packages.filter((p) => !p.archived && p.who === 'everyone').map((p) => p.minutes)
  return open.length ? Math.min(...open) : partyConfig.durationMinutes
}

/**
 * Offered party starts (UTC ISO) on a studio-local date. Online: empty for any
 * date bookableOn refuses. `admin`: owners ignore the notice and the window,
 * but not closed days or the first party day. Never a start that has begun
 * (R37). Parties step aside for Craft Café with a 60-minute gap each side,
 * measured with `minutes` (default: the shortest package everyone can book).
 */
export function partyStartsForDate(
  s: PartySettings,
  ymd: string,
  now: Date,
  days: StudioDays,
  opts: { minutes?: number; admin?: boolean } = {},
): string[] {
  const why = bookableOn(s.times, ymd, now, days)
  const refused = opts.admin ? why === 'before_opening' || why === 'closed' : why !== 'ok'
  if (refused) return []
  let out = startsOn(s.times, ymd).map((hhmm) => localToUtcISO(ymd, hhmm))
  const cafe = cafeOn(ymd, days)
  if (cafe) {
    const gap = CAFE_PARTY_GAP_MINUTES * 60_000
    const length = (opts.minutes ?? defaultMinutes(s)) * 60_000
    const opens = Date.parse(localToUtcISO(ymd, cafe.opens)) - gap
    const closes = Date.parse(localToUtcISO(ymd, cafe.closes)) + gap
    out = out.filter((iso) => {
      const start = Date.parse(iso)
      return start + length <= opens || start >= closes
    })
  }
  const nowMs = now.getTime()
  return out.filter((iso) => Date.parse(iso) > nowMs)
}

/** All offered starts whose start falls within [fromIso, toIso], sorted. */
export function partyStartsInRange(
  s: PartySettings,
  fromIso: string,
  toIso: string,
  now: Date,
  days: StudioDays,
  opts: { minutes?: number; admin?: boolean } = {},
): string[] {
  const startMs = new Date(fromIso).getTime()
  const endMs = new Date(toIso).getTime()
  const seen = new Set<string>()
  const out: string[] = []
  for (let t = startMs; t <= endMs + DAY_MS; t += DAY_MS) {
    const ymd = localDate(new Date(Math.min(t, endMs)).toISOString())
    if (seen.has(ymd)) continue
    seen.add(ymd)
    for (const iso of partyStartsForDate(s, ymd, now, days, opts)) {
      const ms = new Date(iso).getTime()
      if (ms >= startMs && ms <= endMs) out.push(iso)
    }
  }
  return out.sort()
}

// ---------------------------------------------------------------- what /book shows

export interface PublicPartyFacts {
  packages: PartyPackage[]
  addOns: PartyAddOn[]
  times: PartyTimes
  days: StudioDays
  first: string
  last: string
}

/** What the public booking page may know: packages everyone can book (+ the named link one), online extras, the times. */
export function publicPartyFacts(s: PartySettings, days: StudioDays, now: Date, opts: { packageId?: string } = {}): PublicPartyFacts {
  const packages = s.packages.filter((p) => !p.archived && (p.who === 'everyone' || (p.who === 'link' && opts.packageId !== undefined && p.id === opts.packageId)))
  const addOns = s.addOns.filter((a) => !a.archived && a.online)
  return { packages, addOns, times: s.times, days, ...bookableDates(s.times, now) }
}

/** The facts /book has before the saved ones arrive: the config's (first paint only). */
export function configPublicFacts(now: Date = new Date()): PublicPartyFacts {
  return publicPartyFacts(configPartySettings(), CONFIG_STUDIO_DAYS, now)
}

/**
 * The facts as party settings, so the browser can run the same rules
 * (partyStartsForDate, pricing.ts quoteParty) the server runs. Holds only
 * what /book may know: packages it can book and online extras.
 */
export function settingsFromFacts(f: Pick<PublicPartyFacts, 'packages' | 'addOns' | 'times'>): PartySettings {
  return { times: f.times, packages: f.packages, addOns: f.addOns, readSquareBookings: false, updatedAt: null, by: null, history: [] }
}

// ---------------------------------------------------------------- owner-readable words

const PLURAL_DAY = WEEKDAYS.map((d) => `${d}s`)

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** 18:30 → "6:30 PM", 21:00 → "9 PM", 24:00 → "midnight". */
function clockLabel(t: number): string {
  if (t >= 24 * 60) return 'midnight'
  const h = Math.floor(t / 60)
  const m = t % 60
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${m ? `${hour}:${String(m).padStart(2, '0')}` : hour} ${h < 12 ? 'AM' : 'PM'}`
}

/** 150 → "2 hours 30 minutes", 180 → "3 hours", 45 → "45 minutes". */
function lengthLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const parts: string[] = []
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`)
  if (m || !h) parts.push(`${m} minute${m === 1 ? '' : 's'}`)
  return parts.join(' ')
}

// ---------------------------------------------------------------- validation

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const YMD = /^\d{4}-\d{2}-\d{2}$/
const PKG_ID = /^pkg_[A-Za-z0-9_-]{1,40}$/
const ADD_ID = /^add_[A-Za-z0-9_-]{1,40}$/
const NAME_MAX = 60
const MAX_PACKAGES = 20
const MAX_ADDONS = 20
const MAX_DATES = 120
const MAX_PRICE = 1_000_000
const EXTRA_MINUTES = [0, 15, 30, 45, 60] as const

function realDate(s: unknown): s is string {
  if (typeof s !== 'string' || !YMD.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

let idSeq = 0
function newId(prefix: 'pkg' | 'add'): string {
  idSeq = (idSeq + 1) % 1000
  return `${prefix}_${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function label(v: unknown, field: string, missing: string): string {
  const n = (typeof v === 'string' ? v.trim() : '').replace(/\s+/g, ' ')
  if (!n) throw new SettingsError(400, missing, field)
  if (n.length > NAME_MAX) throw new SettingsError(400, `Keep the name to ${NAME_MAX} characters.`, field)
  return n
}

function price(v: unknown, field: string): number {
  if (!intIn(v, 0, MAX_PRICE)) throw new SettingsError(400, 'Prices go from $0 to $10,000.', field)
  return v
}

function startList(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.length > 48 || !v.every((x) => typeof x === 'string' && HHMM.test(x))) {
    throw new SettingsError(400, 'Write times like 13:30.', field)
  }
  return [...v].sort()
}

function hoursOf(weekday: number): { opens: number; closes: number } | null {
  const name = WEEKDAYS[weekday]
  const h = STUDIO_HOURS.find((e) => e.days.includes(name))
  return h ? { opens: minutesOfDay(h.opens), closes: minutesOfDay(h.closes) } : null
}

/**
 * One day's starts: far enough apart for the longest package and its
 * cleanup, inside the studio's hours with the longest package, the largest
 * extra time and cleanup, and never past midnight (no party or its cleanup
 * crosses into the next day).
 */
function checkDay(starts: string[], weekday: number, name: string, field: string, longest: number, extra: number): void {
  const gap = longest + PARTY_CLEANUP_MINUTES
  const need = longest + extra + PARTY_CLEANUP_MINUTES
  const mins = starts.map(minutesOfDay)
  for (let i = 1; i < mins.length; i++) {
    if (mins[i] - mins[i - 1] < gap) throw new SettingsError(400, `Party times on ${name} must be at least ${lengthLabel(gap)} apart.`, field)
  }
  const hours = hoursOf(weekday)
  for (const t of mins) {
    if (hours && t < hours.opens) throw new SettingsError(400, `Party times on ${name} can’t start before the studio opens at ${clockLabel(hours.opens)}.`, field)
    const end = hours ? Math.min(hours.closes, 24 * 60) : 24 * 60
    if (t + need > end) {
      const why = hours ? `end by closing at ${clockLabel(hours.closes)}` : 'end by midnight'
      throw new SettingsError(400, `Party times on ${name} must start by ${clockLabel(end - need)}, so the party and its cleanup ${why}.`, field)
    }
  }
}

function validPackage(p: any, field: string): PartyPackage {
  if (!p || typeof p !== 'object') throw new SettingsError(400, 'Give the package a name.', field)
  const name = label(p.name, field, 'Give the package a name.')
  const priceCents = price(p.priceCents, field)
  if (!intIn(p.minutes, 15, 480)) throw new SettingsError(400, 'A party lasts from 15 minutes to 8 hours.', field)
  if (!intIn(p.minGuests, 1, 60) || !intIn(p.maxGuests, 1, 60) || !intIn(p.defaultGuests, 1, 60)) throw new SettingsError(400, 'Guests go from 1 to 60.', field)
  if (!(p.minGuests <= p.defaultGuests && p.defaultGuests <= p.maxGuests)) {
    throw new SettingsError(400, 'The usual number of guests has to be between the fewest and the most.', field)
  }
  if (!['everyone', 'link', 'admin'].includes(p.who)) throw new SettingsError(400, 'Choose who can book the package.', field)
  const picks = Array.isArray(p.quickPicks) ? p.quickPicks : []
  const quickPicks = [...new Set<number>(picks.filter((n: unknown) => intIn(n, p.minGuests, p.maxGuests)))].sort((a, b) => a - b).slice(0, 10)
  return {
    id: typeof p.id === 'string' && PKG_ID.test(p.id) ? p.id : newId('pkg'),
    name, priceCents, minutes: p.minutes,
    minGuests: p.minGuests, maxGuests: p.maxGuests, defaultGuests: p.defaultGuests, quickPicks,
    who: p.who, archived: p.archived === true,
  }
}

function validAddOn(a: any, field: string): PartyAddOn {
  if (!a || typeof a !== 'object') throw new SettingsError(400, 'Give the extra a name.', field)
  const name = label(a.label, field, 'Give the extra a name.')
  const priceCents = price(a.priceCents, field)
  if (a.per !== 'party' && a.per !== 'guest') throw new SettingsError(400, 'Choose per party or per guest.', field)
  if (!EXTRA_MINUTES.includes(a.extraMinutes)) throw new SettingsError(400, 'Extra time comes in 15, 30, 45 or 60 minutes.', field)
  if (!intIn(a.maxQty, 1, 60)) throw new SettingsError(400, 'Allow from 1 to 60 of each extra.', field)
  if (a.extraMinutes > 0 && a.maxQty !== 1) throw new SettingsError(400, 'Extra time can be added once per party.', field)
  return {
    id: typeof a.id === 'string' && ADD_ID.test(a.id) ? a.id : newId('add'),
    label: name, priceCents, per: a.per, extraMinutes: a.extraMinutes, maxQty: a.maxQty,
    online: a.online === true, archived: a.archived === true,
  }
}

/**
 * Checks and tidies what an owner sent. Throws a SettingsError (400) with a
 * sentence an owner can act on and the field it is about (`times.weekly.0`,
 * `times.dates.2026-11-14`, `packages.1`, `addOns.0`…). Dated days before
 * today (`now`, default the clock) are kept as they are and not checked
 * against the hours: they can no longer be booked.
 */
export function validatePartySettings(raw: unknown, opts: { now?: Date } = {}): PartySettingsInput {
  const body = raw as any
  if (!body || typeof body !== 'object') throw new SettingsError(400, 'Nothing to save.')
  const t = body.times
  if (!t || typeof t !== 'object' || !t.weekly || typeof t.weekly !== 'object' || !t.dates || typeof t.dates !== 'object' || Array.isArray(t.dates)) {
    throw new SettingsError(400, 'Send the party times.', 'times')
  }
  if (!Array.isArray(body.packages)) throw new SettingsError(400, 'Send the packages.', 'packages')
  if (!Array.isArray(body.addOns)) throw new SettingsError(400, 'Send the extras.', 'addOns')

  // times
  if (!intIn(t.bookingWindowDays, 1, 365)) throw new SettingsError(400, 'Take bookings from 1 to 365 days ahead.', 'times.bookingWindowDays')
  if (!intIn(t.minLeadDays, 0, 60)) throw new SettingsError(400, 'Ask for 0 to 60 days of notice.', 'times.minLeadDays')
  if (!realDate(t.opensDate)) throw new SettingsError(400, 'Pick the first day parties can be booked.', 'times.opensDate')
  const weekly = Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, startList(t.weekly[k], `times.weekly.${k}`)])) as PartyTimes['weekly']
  const dateKeys = Object.keys(t.dates)
  if (dateKeys.length > MAX_DATES) throw new SettingsError(400, `Keep it to ${MAX_DATES} dated party days.`, 'times.dates')
  if (!dateKeys.every(realDate)) throw new SettingsError(400, 'Pick a real day for each dated party day.', 'times.dates')
  const dates: Record<string, string[]> = {}
  for (const ymd of dateKeys.sort()) dates[ymd] = startList(t.dates[ymd], `times.dates.${ymd}`)
  const times: PartyTimes = { weekly, dates, bookingWindowDays: t.bookingWindowDays, minLeadDays: t.minLeadDays, opensDate: t.opensDate }

  // packages
  if (body.packages.length > MAX_PACKAGES) throw new SettingsError(400, `Keep it to ${MAX_PACKAGES} packages.`, 'packages')
  const packages: PartyPackage[] = []
  body.packages.forEach((p: unknown, i: number) => {
    const pkg = validPackage(p, `packages.${i}`)
    if (packages.some((x) => x.id === pkg.id)) throw new SettingsError(400, 'Two packages have the same id.', `packages.${i}`)
    packages.push(pkg)
  })
  if (!packages.some((p) => !p.archived && p.who === 'everyone')) throw new SettingsError(400, 'Keep at least one package that everyone can book.', 'packages')

  // extras
  if (body.addOns.length > MAX_ADDONS) throw new SettingsError(400, `Keep it to ${MAX_ADDONS} extras.`, 'addOns')
  const addOns: PartyAddOn[] = []
  body.addOns.forEach((a: unknown, i: number) => {
    const add = validAddOn(a, `addOns.${i}`)
    if (addOns.some((x) => x.id === add.id)) throw new SettingsError(400, 'Two extras have the same id.', `addOns.${i}`)
    addOns.push(add)
  })

  if (typeof body.readSquareBookings !== 'boolean') throw new SettingsError(400, 'Say whether to read parties booked in Square.', 'readSquareBookings')

  // each day's starts against the longest package, the largest extra time, cleanup and the studio hours
  const longest = Math.max(...packages.filter((p) => !p.archived).map((p) => p.minutes))
  const extra = Math.max(0, ...addOns.filter((a) => !a.archived).map((a) => a.extraMinutes))
  for (const k of WEEKDAY_KEYS) checkDay(weekly[k], Number(k), PLURAL_DAY[Number(k)], `times.weekly.${k}`, longest, extra)
  const today = localDate((opts.now ?? new Date()).toISOString())
  for (const ymd of Object.keys(dates)) {
    if (ymd < today) continue
    checkDay(dates[ymd], weekdayOf(ymd), dayLabel(ymd), `times.dates.${ymd}`, longest, extra)
  }

  return { times, packages, addOns, readSquareBookings: body.readSquareBookings }
}

// ---------------------------------------------------------------- what changed

function listChanges<T extends { id: string; archived: boolean }>(before: T[], after: T[], noun: string, nameOf: (x: T) => string): string[] {
  const out: string[] = []
  for (const x of after) {
    const was = before.find((b) => b.id === x.id)
    if (!was) out.push(`Added ${noun}: ${nameOf(x)}`)
    else if (!was.archived && x.archived) out.push(`Archived ${noun}: ${nameOf(x)}`)
    else if (was.archived && !x.archived) out.push(`Brought back ${noun}: ${nameOf(x)}`)
    else if (JSON.stringify(was) !== JSON.stringify(x)) out.push(`Changed ${noun}: ${nameOf(x)}`)
  }
  for (const b of before) if (!after.some((x) => x.id === b.id)) out.push(`Removed ${noun}: ${nameOf(b)}`)
  return out
}

/** What changed, in plain words, for the history and the audit log. */
export function describePartyChanges(before: PartySettingsInput, after: PartySettingsInput): string[] {
  const out: string[] = []
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  for (const k of WEEKDAY_KEYS) {
    if (!same([...(before.times.weekly[k] ?? [])].sort(), [...(after.times.weekly[k] ?? [])].sort())) out.push(`Party times on ${PLURAL_DAY[Number(k)]}`)
  }
  for (const ymd of Object.keys(after.times.dates).sort()) {
    if (!has(before.times.dates, ymd)) out.push(`Added party times on ${dayLabel(ymd)}`)
    else if (!same([...before.times.dates[ymd]].sort(), [...after.times.dates[ymd]].sort())) out.push(`Party times on ${dayLabel(ymd)}`)
  }
  for (const ymd of Object.keys(before.times.dates).sort()) if (!has(after.times.dates, ymd)) out.push(`Removed party times on ${dayLabel(ymd)}`)
  if (before.times.bookingWindowDays !== after.times.bookingWindowDays) out.push('Booking window')
  if (before.times.minLeadDays !== after.times.minLeadDays) out.push('Notice')
  if (before.times.opensDate !== after.times.opensDate) out.push('First party day')
  out.push(...listChanges(before.packages, after.packages, 'a package', (p) => p.name))
  out.push(...listChanges(before.addOns, after.addOns, 'an extra', (a) => a.label))
  if (before.readSquareBookings !== after.readSquareBookings) {
    out.push(after.readSquareBookings ? 'Started reading parties booked in Square' : 'Stopped reading parties booked in Square')
  }
  return out
}
