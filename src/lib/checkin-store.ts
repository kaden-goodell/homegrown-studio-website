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

const logger = createLogger('checkin-store')

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
}

/** What the client is allowed to see — no hash, no plaintext, just presence. */
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

const STORE_NAME = 'checkins'

function key(partyId: string, recordId: string): string {
  return `${partyId}__${recordId}`
}

async function getBlobStore() {
  const { getStore } = await import('@netlify/blobs')
  const store = getStore(STORE_NAME)
  await store.get('__probe__')
  return store
}

async function fsWrite(k: string, json: string): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const dir = new URL('../../.data/checkins/', import.meta.url)
  await mkdir(dir, { recursive: true })
  await writeFile(new URL(`${k}.json`, dir), json, 'utf8')
}

async function fsRead(k: string): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises')
    const dir = new URL('../../.data/checkins/', import.meta.url)
    return await readFile(new URL(`${k}.json`, dir), 'utf8')
  } catch {
    return null
  }
}

function emptyState(): CheckinState {
  return { expected: null, presence: {}, pickedUpBy: null, confirmedPickup: [], pickupCodeHash: null }
}

/** Normalize a stored record onto the current shape, dropping legacy fields. */
function normalize(raw: any): CheckinState {
  return {
    expected: Array.isArray(raw?.expected) ? raw.expected.map(String) : null,
    presence: raw?.presence && typeof raw.presence === 'object' ? raw.presence : {},
    pickedUpBy: typeof raw?.pickedUpBy === 'string' ? raw.pickedUpBy : null,
    confirmedPickup: Array.isArray(raw?.confirmedPickup) ? raw.confirmedPickup.map(String) : [],
    pickupCodeHash: typeof raw?.pickupCodeHash === 'string' ? raw.pickupCodeHash : null,
  }
}

export async function getCheckin(partyId: string, recordId: string): Promise<CheckinState> {
  const k = key(partyId, recordId)
  let json: string | null = null
  try {
    const store = await getBlobStore()
    json = await store.get(k, { type: 'text' })
  } catch {
    json = await fsRead(k)
  }
  if (json) return normalize(JSON.parse(json))
  return emptyState()
}

/**
 * Record who a family said is coming (RSVP time). Merges into any existing
 * check-in state so it never clobbers presence/code if re-signed. Public write
 * path (no staff auth) — only ever sets the soft `expected` intent.
 */
export async function setExpected(partyId: string, recordId: string, expected: string[]): Promise<void> {
  const state = await getCheckin(partyId, recordId)
  state.expected = expected
  await setCheckin(partyId, recordId, state)
}

export async function setCheckin(partyId: string, recordId: string, state: CheckinState): Promise<void> {
  const k = key(partyId, recordId)
  const json = JSON.stringify(state)
  try {
    const store = await getBlobStore()
    await store.set(k, json)
  } catch {
    await fsWrite(k, json)
  }
  logger.info('Checkin state set', { partyId, recordId })
}
