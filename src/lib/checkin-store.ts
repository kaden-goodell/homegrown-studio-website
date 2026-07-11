/**
 * Mutable check-in / pickup state for a guest at a party. Separate from the
 * immutable waiver record. Keyed by party + waiver record.
 *
 * The pickup code is treated like an API token: only a HASH is stored, the
 * plaintext is shown exactly once (at generation), and it's never returned
 * again — so a refreshed staff screen can't leak one parent's code to another.
 *
 * Netlify Blobs in prod, `.data/checkins/` on disk in dev.
 */
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'

const logger = createLogger('checkin-store')
const kv = makeKvStore('checkins', 'checkins')

/**
 * One person's attendance. Presence is per-person because the waiver is an
 * *eligibility* list, not an attendance list: a household of four may drop off
 * two kids, or an adult may come to a party with none. Person ids are stable —
 * `adult` for the signer, `child:0`, `child:1`, … for minors by waiver order.
 */
export interface PersonPresence {
  inAt: string // ISO — checked in / marked present
  outAt: string | null // ISO — picked up / left
}

/** Append-only record of every custody action taken for this family. */
export interface CheckinEvent {
  at: string // ISO
  action: 'checkin' | 'undo-checkin' | 'pickup' | 'pickup-denied' | 'undo-pickup' | 'reissue-code' | 'set-pickup'
  personIds: string[]
  pickedUpBy?: string
  note?: string
}

export interface CheckinState {
  /**
   * Person ids the family said are coming to THIS party (set at RSVP time).
   * Soft intent for headcount + to seed the check-in selector — never a gate.
   * `null` means the family didn't specify (treat as "everyone on the waiver").
   */
  expected: string[] | null
  /** person id → presence. A missing key means that person never arrived. */
  presence: Record<string, PersonPresence>
  /** Optional free-text note of who collected (the code is the real gate). */
  pickedUpBy: string | null
  /** Staff-confirmed authorized pickup names (drop-off events). */
  confirmedPickup: string[]
  /** SHA-256 of the ONE family pickup code — never the plaintext. */
  pickupCodeHash: string | null
  /** Append-only audit log of all custody events. Never exposed to clients. */
  events: CheckinEvent[]
}

/** What the client is allowed to see — no hash, no plaintext, no audit log. */
export interface PublicCheckin {
  expected: string[] | null
  presence: Record<string, PersonPresence>
  pickedUpBy: string | null
  confirmedPickup: string[]
  hasPickupCode: boolean
}

export function toPublicCheckin(s: CheckinState): PublicCheckin {
  return {
    expected: s.expected,
    presence: s.presence,
    pickedUpBy: s.pickedUpBy,
    confirmedPickup: s.confirmedPickup,
    hasPickupCode: !!s.pickupCodeHash,
  }
}

/** Is anyone in this household still on-site (checked in, not yet picked up)? */
export function anyPresent(s: CheckinState): boolean {
  return Object.values(s.presence).some((p) => !p.outAt)
}

/** Is a given person id currently on-site? */
export function personPresent(s: CheckinState, id: string): boolean {
  const p = s.presence[id]
  return !!p && !p.outAt
}

function key(partyId: string, recordId: string): string {
  return `${partyId}__${recordId}`
}

function emptyState(): CheckinState {
  return { expected: null, presence: {}, pickedUpBy: null, confirmedPickup: [], pickupCodeHash: null, events: [] }
}

/** Normalize a stored record onto the current shape, dropping legacy fields. */
export function normalize(raw: any): CheckinState {
  return {
    expected: Array.isArray(raw?.expected) ? raw.expected.map(String) : null,
    presence: raw?.presence && typeof raw.presence === 'object' ? raw.presence : {},
    pickedUpBy: typeof raw?.pickedUpBy === 'string' ? raw.pickedUpBy : null,
    confirmedPickup: Array.isArray(raw?.confirmedPickup) ? raw.confirmedPickup.map(String) : [],
    pickupCodeHash: typeof raw?.pickupCodeHash === 'string' ? raw.pickupCodeHash : null,
    events: Array.isArray(raw?.events) ? raw.events : [],
  }
}

export async function getCheckin(partyId: string, recordId: string): Promise<CheckinState> {
  const k = key(partyId, recordId)
  const json = await kv.get(k)
  if (json) return normalize(JSON.parse(json))
  return emptyState()
}

/**
 * Record who a family said is coming (RSVP time). Merges into any existing
 * check-in state so it never clobbers presence/code if re-signed. Public write
 * path (no staff auth) — only ever sets the soft `expected` intent.
 */
export async function setExpected(partyId: string, recordId: string, expected: string[]): Promise<void> {
  await mutateCheckin(partyId, recordId, (state) => {
    state.expected = expected
  })
}

export async function setCheckin(partyId: string, recordId: string, state: CheckinState): Promise<void> {
  const k = key(partyId, recordId)
  // Normalize on every write — ensures legacy fields are handled and events[] exists.
  state = normalize(state)
  state.events = state.events.slice(-500)
  await kv.set(k, JSON.stringify(state))
  logger.info('Checkin state set', { partyId, recordId })
}

/** Apply a mutation with optimistic concurrency (3 attempts). */
export async function mutateCheckin(partyId: string, recordId: string, fn: (s: CheckinState) => void | Promise<void>): Promise<CheckinState> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(key(partyId, recordId))
    const state = value ? normalize(JSON.parse(value)) : emptyState()
    await fn(state)
    state.events = state.events.slice(-500)
    if (await kv.setIfMatch(key(partyId, recordId), JSON.stringify(state), etag, value !== null)) return state
  }
  throw new Error('Concurrent update — please retry')
}
