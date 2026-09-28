/**
 * Mutable check-in / pickup state for a guest at an event. Separate from the
 * immutable waiver record. Keyed by event + waiver record.
 *
 * The pickup code is treated like an API token: only a HASH is stored, the
 * plaintext is shown exactly once (at generation), and it's never returned
 * again — so a refreshed staff screen can't leak one parent's code to another.
 * The code is per EVENT, not per day — it persists across a multi-day camp's
 * days (HOM-213).
 *
 * Attendance is tracked per studio-local day (`days[YYYY-MM-DD]`) so a
 * multi-day event (a camp sold as one Square Class covering several dates)
 * can check the same household in on each day independently — see
 * `presenceOn`/`childStillHere`. A single-day event just has one key.
 *
 * Netlify Blobs in prod, `.data/checkins/` on disk in dev.
 */
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'
import { studioDate } from '@lib/studio-time'
import type { By } from '@lib/staff-auth'
import type { AuthorizedPickup } from '@lib/waiver-store'

const logger = createLogger('checkin-store')
const kv = makeKvStore('checkins', 'checkins')
const EVENTS_CAP = 2000

/**
 * One person's attendance on ONE day. Person ids are stable — `adult` for
 * the signer, `child:0`, `child:1`, … for minors by waiver order.
 */
export interface PersonPresence {
  inAt: string // ISO — checked in / marked present
  outAt: string | null // ISO — picked up / left
}

/** Attendance for one studio-local day. */
export interface DayState {
  presence: Record<string, PersonPresence>
}

/** Append-only record of every custody action taken for this family. */
export interface CheckinEvent {
  at: string // ISO
  action:
    | 'checkin'
    | 'undo-checkin'
    | 'pickup'
    | 'pickup-denied'
    | 'undo-pickup'
    | 'reissue-code'
    | 'set-pickup'
    | 'code-sent'
    | 'pickup-override'
    | 'locked'
    | 'unlocked'
  personIds: string[]
  /** @deprecated legacy free-text "collected by" note. New pickup/
   *  pickup-override events write `collectedBy` instead (HOM-214). */
  pickedUpBy?: string
  /** Who actually collected, on a `pickup`/`pickup-override` event (HOM-214). */
  collectedBy?: string
  /** Whether staff confirmed photo ID for an unlisted collector (HOM-214). */
  idChecked?: boolean
  /** Structured reason on a `pickup-override` (the radio choice) or a
   *  `pickup-denied` (e.g. `'not-authorized'`, `'code-mismatch'`) — HOM-214. */
  reason?: string
  note?: string
  /** Which staff member took the action. Absent on legacy events. */
  by?: By
  /** Studio-local day (YYYY-MM-DD) this action applied to (HOM-213). Absent
   *  on events recorded before multi-day rosters existed. */
  day?: string
}

export interface CheckinState {
  /**
   * Person ids the family said are coming to THIS event (set at RSVP time).
   * Soft intent for headcount + to seed the check-in selector — never a gate.
   * `null` means the family didn't specify (treat as "everyone on the waiver").
   */
  expected: string[] | null
  /** Attendance per studio-local day (YYYY-MM-DD) — HOM-213. A single-day
   *  event has exactly one key; a multi-day event tracks each day
   *  independently. Never read directly outside this module — use
   *  `presenceOn`/`childStillHere`. */
  days: Record<string, DayState>
  /** @deprecated free-text note of who collected — legacy only. New releases
   *  write a structured entry into `releasedTo` instead (HOM-214). */
  pickedUpBy: string | null
  /** Staff-confirmed authorized pickup people (drop-off events). Seeded once,
   *  at first child check-in, from the RSVP's pickup override if the
   *  household set one on the returning screen, else from the waiver itself
   *  (HOM-212). Event-scoped, not per-day. */
  confirmedPickup: AuthorizedPickup[]
  /** Anyone flagged as NOT allowed to collect this household's child(ren) —
   *  same seed source/timing as `confirmedPickup` (HOM-212). '' when none. */
  notAuthorized: string
  /** SHA-256 of the ONE family pickup code — never the plaintext. Persists
   *  across every day of the event (HOM-213); see `checkin.json.ts` for the
   *  retirement rule. */
  pickupCodeHash: string | null
  /** Consecutive wrong-code attempts since the last correct code or the last
   *  fresh code issue (HOM-214). Resets to 0 on a correct code, on
   *  `reissue-code`, or on a `pickup-override`. */
  codeAttempts: number
  /** ISO timestamp of the 5th wrong attempt, or `null` when not locked. While
   *  set, `pickup` refuses every code (right or wrong) — only
   *  `pickup-override` can release a child. Cleared by `pickup-override` or
   *  by issuing a fresh code (HOM-214). */
  lockedAt: string | null
  /** Who actually walked out with each person, and when/which day — one
   *  entry per released person id, overwritten if they're re-released after
   *  an undo (HOM-214). The structured replacement for legacy `pickedUpBy`. */
  releasedTo: Record<string, { name: string; at: string; day: string }>
  /** Append-only audit log of all custody events. Never exposed to clients. */
  events: CheckinEvent[]
}

/** What the client is allowed to see — no hash, no plaintext, no audit log. */
export interface PublicCheckin {
  expected: string[] | null
  days: Record<string, DayState>
  /** Convenience mirror of `days[today]` (studio-local) — `{ presence: {} }`
   *  when nothing's happened today. Callers that care about a specific
   *  (possibly non-today) day should read `days` directly. */
  today: DayState
  pickedUpBy: string | null
  confirmedPickup: AuthorizedPickup[]
  notAuthorized: string
  hasPickupCode: boolean
  /** Consecutive wrong-code attempts so far — drives the "N tries left" UI
   *  (HOM-214). */
  codeAttempts: number
  /** Whether the family is currently locked out of code entry (HOM-214). */
  locked: boolean
  /** Who collected each already-released person, and when (HOM-214). */
  releasedTo: Record<string, { name: string; at: string; day: string }>
}

export function toPublicCheckin(s: CheckinState): PublicCheckin {
  const today = studioDate(new Date().toISOString())
  return {
    expected: s.expected,
    days: s.days,
    today: s.days[today] ?? { presence: {} },
    pickedUpBy: s.pickedUpBy,
    confirmedPickup: s.confirmedPickup,
    notAuthorized: s.notAuthorized,
    hasPickupCode: !!s.pickupCodeHash,
    codeAttempts: s.codeAttempts,
    locked: !!s.lockedAt,
    releasedTo: s.releasedTo,
  }
}

/** Presence map for one studio-local day. Missing day → empty (never arrived
 *  that day). Read-only — mutate via `mutateCheckin`'s callback. */
export function presenceOn(s: CheckinState, day: string): Record<string, PersonPresence> {
  return s.days[day]?.presence ?? {}
}

/** Is anyone present (any person id) on a given day still on-site? */
export function anyPresent(s: CheckinState, day: string): boolean {
  return Object.values(presenceOn(s, day)).some((p) => !p.outAt)
}

/** Is a given person id currently on-site on a given day? */
export function personPresent(s: CheckinState, id: string, day: string): boolean {
  const p = presenceOn(s, day)[id]
  return !!p && !p.outAt
}

/** Is any CHILD still on-site on a given day (checked in, not yet picked up)?
 *  The gate for whether the family's pickup code is still needed. */
export function childStillHere(s: CheckinState, day: string): boolean {
  return Object.entries(presenceOn(s, day)).some(([id, p]) => id.startsWith('child:') && !p.outAt)
}

function key(eventKey: string, recordId: string): string {
  return `${eventKey}__${recordId}`
}

function emptyState(): CheckinState {
  return {
    expected: null,
    days: {},
    pickedUpBy: null,
    confirmedPickup: [],
    notAuthorized: '',
    pickupCodeHash: null,
    codeAttempts: 0,
    lockedAt: null,
    releasedTo: {},
    events: [],
  }
}

/**
 * Convert one raw `confirmedPickup` entry onto the current `{name, phone}`
 * shape. Pre-HOM-212 states stored bare name strings; tolerate those forever
 * (never migrated in place) alongside the current object shape.
 */
function normalizePickupEntry(e: unknown): AuthorizedPickup | null {
  if (typeof e === 'string') return e.trim() ? { name: e.trim(), phone: '' } : null
  if (e && typeof e === 'object') {
    const name = String((e as any).name ?? '').trim()
    const phone = String((e as any).phone ?? '').trim()
    return name ? { name, phone } : null
  }
  return null
}

/** Earliest `inAt` timestamp among a legacy presence map, as a studio-local
 *  day — used to place migrated attendance on a real day when the caller
 *  doesn't know the event's first day. `null` if nothing usable is found. */
function earliestDay(presence: Record<string, any>): string | null {
  const inAts = Object.values(presence)
    .map((p: any) => (p && typeof p.inAt === 'string' ? p.inAt : null))
    .filter((t): t is string => !!t)
    .sort()
  return inAts.length > 0 ? studioDate(inAts[0]) : null
}

/**
 * Normalize a stored record onto the current shape, dropping legacy fields.
 * A legacy blob (pre-HOM-213) has a top-level `presence` map instead of
 * `days` — migrate it onto `days[firstDay]` on read; the old field is never
 * written back. When `firstDay` isn't supplied (the caller doesn't know the
 * event's days), fall back to the day of the earliest recorded arrival, then
 * to today.
 */
export function normalize(raw: any, firstDay?: string): CheckinState {
  const days: Record<string, DayState> = {}
  if (raw?.days && typeof raw.days === 'object' && !Array.isArray(raw.days)) {
    for (const [day, d] of Object.entries(raw.days as Record<string, any>)) {
      days[day] = {
        presence: d && typeof d === 'object' && d.presence && typeof d.presence === 'object' ? d.presence : {},
      }
    }
  } else if (raw?.presence && typeof raw.presence === 'object' && Object.keys(raw.presence).length > 0) {
    const day = firstDay ?? earliestDay(raw.presence) ?? studioDate(new Date().toISOString())
    days[day] = { presence: raw.presence }
  }
  return {
    expected: Array.isArray(raw?.expected) ? raw.expected.map(String) : null,
    days,
    pickedUpBy: typeof raw?.pickedUpBy === 'string' ? raw.pickedUpBy : null,
    confirmedPickup: Array.isArray(raw?.confirmedPickup)
      ? raw.confirmedPickup.map(normalizePickupEntry).filter((p: AuthorizedPickup | null): p is AuthorizedPickup => p !== null)
      : [],
    notAuthorized: typeof raw?.notAuthorized === 'string' ? raw.notAuthorized : '',
    pickupCodeHash: typeof raw?.pickupCodeHash === 'string' ? raw.pickupCodeHash : null,
    codeAttempts: typeof raw?.codeAttempts === 'number' && raw.codeAttempts >= 0 ? raw.codeAttempts : 0,
    lockedAt: typeof raw?.lockedAt === 'string' ? raw.lockedAt : null,
    releasedTo:
      raw?.releasedTo && typeof raw.releasedTo === 'object' && !Array.isArray(raw.releasedTo) ? raw.releasedTo : {},
    events: Array.isArray(raw?.events) ? raw.events : [],
  }
}

export interface CheckinOpts {
  /** The event's first day (studio-local YYYY-MM-DD) — passed by callers
   *  that already resolved the event, so a legacy single-day blob migrates
   *  onto the right key instead of guessing. */
  firstDay?: string
}

export async function getCheckin(eventKey: string, recordId: string, opts?: CheckinOpts): Promise<CheckinState> {
  const k = key(eventKey, recordId)
  const json = await kv.get(k)
  if (json) return normalize(JSON.parse(json), opts?.firstDay)
  return emptyState()
}

/**
 * Record who a family said is coming (RSVP time). Merges into any existing
 * check-in state so it never clobbers presence/code if re-signed. Public write
 * path (no staff auth) — only ever sets the soft `expected` intent.
 */
export async function setExpected(eventKey: string, recordId: string, expected: string[]): Promise<void> {
  await mutateCheckin(eventKey, recordId, (state) => {
    state.expected = expected
  })
}

export async function setCheckin(eventKey: string, recordId: string, state: CheckinState): Promise<void> {
  const k = key(eventKey, recordId)
  // Normalize on every write — ensures legacy fields are handled and events[] exists.
  state = normalize(state)
  state.events = state.events.slice(-EVENTS_CAP)
  await kv.set(k, JSON.stringify(state))
  logger.info('Checkin state set', { eventKey, recordId })
}

/** Apply a mutation with optimistic concurrency (3 attempts). */
export async function mutateCheckin(
  eventKey: string,
  recordId: string,
  fn: (s: CheckinState) => void | Promise<void>,
  opts?: CheckinOpts,
): Promise<CheckinState> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(key(eventKey, recordId))
    const state = value ? normalize(JSON.parse(value), opts?.firstDay) : emptyState()
    await fn(state)
    state.events = state.events.slice(-EVENTS_CAP)
    if (await kv.setIfMatch(key(eventKey, recordId), JSON.stringify(state), etag, value !== null)) return state
  }
  throw new Error('Concurrent update — please retry')
}
