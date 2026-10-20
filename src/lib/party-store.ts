/**
 * Party metadata + host access token.
 *
 * Saved when a party is booked so the host can return to a management view of
 * their party (details + who's RSVP'd) via a link carrying a secret token.
 * The token gates the roster — it holds other guests' kid names, allergies,
 * and emergency contacts, so the party page must never be a guessable URL.
 *
 * Netlify Blobs in prod, `.data/parties/` on disk in dev.
 *
 * Two kinds of record share the store, keyed by `bookingId`:
 * - parties booked in Square (legacy, no `source`): read only; the Square
 *   booking id is the key, so RSVPs, waivers and check-ins keep working;
 * - our own parties (`source: 'ours'`, ids `pty_…`, stage 2): what was bought
 *   (`items`, each keeping the price it was sold at), every payment
 *   (`charges`) and refund (`refunds`), the payment-link key, and a history.
 *
 * Writes: `createPartyRecord` is create-only (a retry finds the first try's
 * party, R35); `updatePartyRecord` is compare-and-set (3 attempts) so a
 * payment and an email fix landing together both stay. `savePartyRecord`
 * (unconditional) is left only for the old Square booking route.
 */
import { randomUUID } from 'node:crypto'
import { createLogger } from '@lib/logger'
import { isPreviewOrDev } from '@lib/deploy-context'
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import type { Cents } from '@lib/parties/types'

const logger = createLogger('party-store')
const kv = makeKvStore('parties', 'parties')

export interface PartyRecord {
  bookingId: string
  hostToken: string
  craftName: string
  startIso: string
  durationMinutes: number | null
  hostName: string
  hostEmail: string
  /** Host's phone — the studio's day-of contact channel. Added 2026-09; older
   *  records predate this field, so consumers must tolerate it being absent. */
  hostPhone?: string
  guestCount: number
  title: string | null
  /**
   * Drop-off event (parents leave). Turns on staff pickup verification: a
   * confirmed pickup list + a pickup code + dropdown check-out. Parties are
   * never drop-off (a responsible adult stays with each child); only
   * studio-run drop-off events (camps, PNO) set this. Read-only here now —
   * the staff console writes drop-off via the `event-meta` overlay
   * (`@lib/event-meta`); this field is a fallback `getEvent` reads for old
   * records written before that store existed.
   */
  dropOff: boolean
  /**
   * In-studio themed-table add-on, when the host booked one. `displayName` is
   * the SELECTED theme (e.g. "The Sweet Sixteen") — never the ledger-collapsed
   * variant — so staff staging the room see the right name. `claimRef` is the
   * reservation key on the shared kit ledger, released when the party cancels.
   */
  theme?: { themeId: string; displayName: string; serves: number; claimRef: string }
  /** Written by a payment-bypass booking (dev / preview). Hidden in production. */
  simulated?: true
  /** Where the host first and last came from (Google, Facebook, a texted link…), when known. */
  attribution?: import('@lib/attribution').Attribution
  createdAt: string // ISO

  // ---- stage 2: our own parties. All optional: legacy records load unchanged; no `source` = 'square'.
  source?: 'square' | 'ours'
  status?: 'booked' | 'cancelled'
  /** start + package minutes + extra minutes (cleanup not included) */
  endIso?: string
  packageId?: string
  /** resolved on the server from the catalog */
  craftId?: string
  /** What was bought, each at the price it was sold at (a later price change never touches these). */
  items?: PartyItem[]
  charges?: PartyCharge[]
  refunds?: PartyRefund[]
  /** Payment-link key, separate from hostToken (S2-R6: the host page shows other families' details). */
  payToken?: string
  /** One payment in flight (link or admin card); see claimPaying in ./parties/money. */
  paying?: PartyPaying | null
  linkSent?: { at: string; by: By | null; email: boolean; text: boolean }[]
  cancelled?: { at: string; by: By; note: string }
  /** The host's booking confirmation: whether it went out (written by whoever recorded the party paid). */
  confirmation?: { at: string; sent: boolean }
  /** R6: paid after its time was taken by someone else; warned, never refunded automatically. */
  overlap?: true
  /** oldest first, capped at PARTY_HISTORY_CAP */
  history?: { at: string; by: By | null; change: string }[]
}

/**
 * A payment in flight on a booked party. `attemptId` and `until` are the
 * claim; the rest is written by the payment link (src/lib/parties/pay-balance)
 * so a retry, Square's payment event or an owner can finish it: the exact
 * order request (same key → Square gives back the same order), the items that
 * order pays (items added later stay due) and what was quoted for them.
 */
export interface PartyPaying {
  attemptId: string
  until: string
  via?: 'link' | 'admin-card'
  /** admin-card: the owner taking the card (goes on the charge) */
  by?: By | null
  /** charging: the charge is being sent; unclear: sent, no answer (kept 24 h) */
  state?: 'charging' | 'unclear'
  order?: { idempotencyKey: string; locationId: string; customerId: string | null; lineItems: import('@providers/interfaces/payment').LineItem[]; referenceId: string }
  orderId?: string | null
  itemIds?: string[]
  quotedCents?: Cents
  /** when this attempt last moved (claimed, charged) */
  at?: string
}

export interface PartyItem {
  id: string
  kind: 'package' | 'addon'
  /** the package or extra id in Parties setup */
  refId: string
  label: string
  /** units on the order line (for a per-guest extra: count × forGuests) */
  qty: number
  /**
   * What was chosen when it was priced: 1 for a package, how many for a
   * per-party extra, how many per guest for a per-guest extra. Older items
   * have none (derived from qty once, see quoteAddOn).
   */
  count?: number
  /** per-guest extras: how many guests this item is for */
  forGuests?: number
  /** a per-guest extra added later for guests who joined after it was bought (not counted toward maxQty) */
  topUp?: true
  unitCents: Cents
  cents: Cents
  extraMinutes: number
  /** the charge that paid it; null = still due */
  chargeId: string | null
  addedAt: string
  by: By | null
}

export interface PartyCharge {
  id: string
  via: 'online' | 'admin-card' | 'link'
  orderId: string
  paymentId: string
  /** what Square took (its order total, R14) */
  cents: Cents
  /** what we quoted for the items */
  quotedCents: Cents
  itemIds: string[]
  receiptUrl: string | null
  at: string
  by: By | null
  simulated?: true
  /** the payment page's attempt id (link payments): a retry of it finds this charge */
  attemptId?: string
  /** when the host and owners were told about it (claimed once, so told once) */
  toldAt?: string
}

export interface PartyRefund {
  id: string
  chargeId: string
  paymentId: string
  cents: Cents
  reason: string
  by: By | null
  role: 'owner' | 'crew' | 'square'
  squareRefundId: string | null
  requestId: string | null
  at: string
}

export const PARTY_HISTORY_CAP = 100
const ATTEMPTS = 3

function needId(id: string): void {
  if (typeof id !== 'string' || id.trim() === '') throw new Error('A party needs an id.')
}

/** Ours (stage 2) rather than booked in Square. */
export const isOurs = (r: PartyRecord): boolean => r.source === 'ours'

/** No such party here (or a simulated one in production). */
export class PartyNotFoundError extends Error {
  constructor(public id: string) { super('That party does not exist.') }
}

export function newHostToken(): string {
  return randomUUID().replace(/-/g, '')
}

/** Unconditional write. Only the old Square booking route still uses it (removed in stage 2 Task 7). */
export async function savePartyRecord(record: PartyRecord): Promise<void> {
  await kv.set(record.bookingId, JSON.stringify(record, null, 2))
  logger.info('Party stored', { bookingId: record.bookingId })
}

/** Previews share production's blob stores; simulated parties must never show up there. */
function visibleHere(record: PartyRecord): boolean {
  return isPreviewOrDev() || !(record.simulated === true || record.bookingId.startsWith('dev_'))
}

export async function getPartyRecord(bookingId: string): Promise<PartyRecord | null> {
  const json = await kv.get(bookingId)
  if (!json) return null
  const record: PartyRecord = JSON.parse(json)
  return visibleHere(record) ? record : null
}

/**
 * Create-only (R35): when a record with this id is already stored (a retry, or
 * the same booking sent twice) nothing is written and the stored one comes back.
 */
export async function createPartyRecord(r: PartyRecord): Promise<{ kind: 'created' | 'exists'; rec: PartyRecord }> {
  needId(r.bookingId)
  if (await kv.setIfMatch(r.bookingId, JSON.stringify(r, null, 2), null, false)) {
    logger.info('Party created', { bookingId: r.bookingId })
    return { kind: 'created', rec: r }
  }
  const json = await kv.get(r.bookingId)
  if (!json) throw new Error('Party create lost a race but nothing is stored')
  return { kind: 'exists', rec: JSON.parse(json) as PartyRecord }
}

/**
 * Compare-and-set update, 3 attempts, each on the record as just read, so a
 * write made in between (a payment, a refund) is never lost. `fn` returns the
 * new record, or null for "no change" (nothing written, current one returned).
 * Adds `{ at, by, change }` to the history (last PARTY_HISTORY_CAP kept).
 * Throws PartyNotFoundError when there is no such party (or it is hidden here).
 */
export async function updatePartyRecord(
  id: string,
  fn: (r: PartyRecord) => PartyRecord | null,
  change: string,
  by: By | null,
): Promise<PartyRecord> {
  needId(id)
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { value, etag } = await kv.getWithMeta(id)
    if (!value) throw new PartyNotFoundError(id)
    const cur = JSON.parse(value) as PartyRecord
    if (!visibleHere(cur)) throw new PartyNotFoundError(id)
    const changed = fn(structuredClone(cur))
    if (changed === null) return cur
    const at = new Date().toISOString()
    const next: PartyRecord = {
      ...changed,
      bookingId: cur.bookingId,
      history: [...(changed.history ?? []), { at, by, change }].slice(-PARTY_HISTORY_CAP),
    }
    if (await kv.setIfMatch(id, JSON.stringify(next, null, 2), etag, true)) {
      logger.info('Party updated', { bookingId: id, change })
      return next
    }
  }
  throw new Error('Someone else changed this party at the same moment. Try again.')
}

/** Constant-ish check that the supplied token matches the party's host token. */
export function hostTokenValid(record: PartyRecord | null, token: string | null | undefined): boolean {
  return !!record && !!token && token === record.hostToken
}

/** All party records (for the staff console). Newest first. */
export async function listParties(): Promise<PartyRecord[]> {
  const keys = (await kv.list()).filter((k) => k !== '__probe__')
  const records = await Promise.all(keys.map(getPartyRecord))
  return records
    .filter((r): r is PartyRecord => r !== null)
    .sort((a, b) => b.startIso.localeCompare(a.startIso))
}
