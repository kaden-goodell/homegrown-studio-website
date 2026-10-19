/**
 * Which party times are really free: the owners' party times (Parties setup,
 * or the config until they save), less closed days and the Craft Café gap
 * (both inside partyStartsForDate), less anything on the shared studio
 * schedule a party would clash with: our classes, Square classes, the party
 * book's held and booked parties, Square-booked parties (read only), blocked
 * time and closed days (`clashes({ kind: 'party' })`, cleanup gap included).
 * A party and its cleanup never run past midnight.
 *
 * Fails closed: party settings, studio days, the party book, our classes,
 * blocked time and (while the owners' switch is on) Square party bookings are
 * all read strictly, and any failure throws. Callers answer 503 with
 * PARTY_TIMES_UNREADABLE; no time is ever shown or sold unchecked (R10 ends).
 * The one exception is a failed Square CLASS lookup, read as none on the party
 * offering path (spec E).
 */
import { getStudioDays } from '@lib/studio-settings'
import { studioDayUtcRange } from '@lib/studio-time'
import { busyBetween, clashes, clashMessage, type Busy } from '@lib/classes/studio-schedule'
import type { StudioDays } from '@config/studio-days'
import { bookableDates, localDate, localToUtcISO, partyStartsForDate, partyStartsInRange, PARTY_CLEANUP_MINUTES } from './party-times'
import { getPartySettings } from './settings-store'
import type { PartySettings } from './types'

export const PARTY_TIMES_UNREADABLE = "We couldn't load party times. Try again in a minute."

export interface PartyWant {
  /** The package's length; default the shortest package everyone can book. */
  packageId?: string
  /** Extras by id → count; extra time lengthens the party. */
  addOns?: Record<string, number>
  /** Owners: notice and window ignored (never a past start, R37). */
  admin?: boolean
  /** A party moving past its own time. */
  ignorePartyId?: string
}

const MINUTE = 60_000
// Everything that can reach a party candidate: the cleanup gap and the café gap are 60 minutes.
const PAD_MS = 2 * 60 * MINUTE

/** The party's length in minutes: the package (or the default one) plus extra time chosen. */
export function partyMinutes(s: PartySettings, want: Pick<PartyWant, 'packageId' | 'addOns'> = {}): number {
  const live = s.packages.filter((p) => !p.archived)
  const pkg = (want.packageId ? live.find((p) => p.id === want.packageId) : undefined)
    ?? live.filter((p) => p.who === 'everyone').sort((a, b) => a.minutes - b.minutes)[0]
    ?? live[0]
  let minutes = pkg?.minutes ?? 90
  for (const [id, n] of Object.entries(want.addOns ?? {})) {
    const a = s.addOns.find((x) => x.id === id && !x.archived)
    const count = Number.isInteger(n) && n > 0 ? n : 0
    if (a && count) minutes += a.extraMinutes * count
  }
  return minutes
}

const endOf = (startIso: string, minutes: number) => new Date(Date.parse(startIso) + minutes * MINUTE).toISOString()

/** True when the party plus its cleanup ends on its start's studio-local day (exactly midnight is fine). */
function endsByMidnight(startIso: string, minutes: number): boolean {
  const lastMoment = Date.parse(startIso) + (minutes + PARTY_CLEANUP_MINUTES) * MINUTE - 1
  return localDate(new Date(lastMoment).toISOString()) === localDate(startIso)
}

function clashesFor(startIso: string, minutes: number, busy: Busy[], ignorePartyId?: string): Busy[] {
  return clashes(
    { kind: 'party', startIso, endIso: endOf(startIso, minutes), ignoreIds: ignorePartyId ? [ignorePartyId] : [] },
    busy,
  )
}

/** `labels`: name the parties in the way (owners only; public reads skip the record reads). */
async function scheduleAround(fromIso: string, toIso: string, days: StudioDays, labels = false): Promise<Busy[]> {
  return busyBetween(
    new Date(Date.parse(fromIso) - PAD_MS).toISOString(),
    new Date(Date.parse(toIso) + PAD_MS).toISOString(),
    days,
    { legacyClasses: 'ignore-failure', partyLabels: labels },
  )
}

async function load(): Promise<{ settings: PartySettings; days: StudioDays }> {
  const [settings, days] = await Promise.all([getPartySettings({ strict: true }), getStudioDays({ strict: true })])
  return { settings, days }
}

/** Offered starts, the ones nothing but a party is in the way of, and the open ones. */
export interface PartyStartsView {
  minutes: number
  /** The party times set for the range (closed days and café gap already out). */
  offered: string[]
  /** Offered and clear of everything except other parties. */
  unblocked: string[]
  /** Really free: clear of everything. */
  open: string[]
}

function judge(offered: string[], minutes: number, busy: Busy[], ignorePartyId?: string): PartyStartsView {
  const fits = offered.filter((s) => endsByMidnight(s, minutes))
  const notParty = busy.filter((b) => b.kind !== 'party')
  const unblocked = fits.filter((s) => clashesFor(s, minutes, notParty, ignorePartyId).length === 0)
  const open = unblocked.filter((s) => clashesFor(s, minutes, busy, ignorePartyId).length === 0)
  return { minutes, offered, unblocked, open }
}

/** The day's view (see PartyStartsView). Throws when anything can't be read. */
export async function partyStartsOnDate(date: string, want: PartyWant = {}, now: Date = new Date()): Promise<PartyStartsView> {
  const { settings, days } = await load()
  const minutes = partyMinutes(settings, want)
  const offered = partyStartsForDate(settings, date, now, days, { minutes, admin: want.admin })
  if (offered.length === 0) return { minutes, offered, unblocked: [], open: [] }
  const { startIso, endIso } = studioDayUtcRange(date)
  return judge(offered, minutes, await scheduleAround(startIso, endIso, days), want.ignorePartyId)
}

/** Open party starts (UTC ISO) on a studio-local date. Throws when anything can't be read. */
export async function openPartyStarts(date: string, want: PartyWant = {}, now: Date = new Date()): Promise<string[]> {
  return (await partyStartsOnDate(date, want, now)).open
}

/**
 * The view across the online booking window (or [now, now + days] when
 * `days` is given, still inside the window). Throws when anything can't be read.
 */
export async function partyStartsInWindow(
  now: Date = new Date(),
  want: { packageId?: string; addOns?: Record<string, number>; days?: number } = {},
): Promise<PartyStartsView & { windowDays: number }> {
  const { settings, days } = await load()
  const minutes = partyMinutes(settings, want)
  const windowDays = want.days ?? settings.times.bookingWindowDays
  const none = { minutes, windowDays, offered: [], unblocked: [], open: [] }
  const { first, last } = bookableDates(settings.times, now)
  if (first > last) return none
  const from = new Date(Math.max(Date.parse(localToUtcISO(first, '00:00')), now.getTime()))
  let to = Date.parse(studioDayUtcRange(last).endIso)
  if (want.days !== undefined) to = Math.min(to, now.getTime() + want.days * 86_400_000)
  if (to <= from.getTime()) return none
  const toIso = new Date(to).toISOString()
  const offered = partyStartsInRange(settings, from.toISOString(), toIso, now, days, { minutes })
  if (offered.length === 0) return { ...none, offered }
  return { ...judge(offered, minutes, await scheduleAround(from.toISOString(), toIso, days)), windowDays }
}

/** Every open party start online across the booking window. Throws when anything can't be read. */
export async function openPartyStartsInWindow(now: Date = new Date(), want: { packageId?: string } = {}): Promise<string[]> {
  return (await partyStartsInWindow(now, want)).open
}

const NOT_OFFERED = 'That party time isn’t offered. Please pick another time.'
const NOT_OPEN = 'That party time was just taken. Please pick another time.'
const PAST = 'That time has already passed. Pick a later time.'
const MIDNIGHT = 'A party and its hour of cleanup have to finish by midnight.'

/**
 * Can a party of `minutes` start at exactly `startIso`? Online: only an
 * offered party time, and the refusal never names who is in the way. Owners
 * (`admin`): any time not in the past (R37) that the shared schedule allows
 * (OWNER-3), and the refusal names the clash. Throws when anything can't be read.
 */
export async function isStartOpen(
  startIso: string,
  minutes: number,
  opts: { admin?: boolean; ignorePartyId?: string } = {},
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = await checkStart(startIso, minutes, opts, now)
  return r.ok ? { ok: true } : r
}

/**
 * isStartOpen, also giving the schedule it judged against when open, so a
 * checkout can hold the time against the very same read.
 */
export async function checkStart(
  startIso: string,
  minutes: number,
  opts: { admin?: boolean; ignorePartyId?: string } = {},
  now: Date = new Date(),
): Promise<{ ok: true; busy: Busy[] } | { ok: false; message: string }> {
  const start = Date.parse(startIso)
  if (!Number.isFinite(start) || !(minutes > 0)) return { ok: false, message: NOT_OFFERED }
  const iso = new Date(start).toISOString()
  if (start <= now.getTime()) return { ok: false, message: PAST }
  if (!endsByMidnight(iso, minutes)) return { ok: false, message: MIDNIGHT }
  const { settings, days } = await load()
  if (!opts.admin) {
    const offered = partyStartsForDate(settings, localDate(iso), now, days, { minutes })
    if (!offered.some((s) => Date.parse(s) === start)) return { ok: false, message: NOT_OFFERED }
  }
  const busy = await scheduleAround(iso, endOf(iso, minutes), days, !!opts.admin)
  const found = clashesFor(iso, minutes, busy, opts.ignorePartyId)
  if (found.length === 0) return { ok: true, busy }
  return { ok: false, message: opts.admin ? clashMessage(found) : NOT_OPEN }
}
