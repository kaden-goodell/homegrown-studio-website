/**
 * Signed-waiver persistence + per-party RSVP index.
 *
 * Production (Netlify): Netlify Blobs. Local dev: `.data/waivers/` on disk.
 * Records are immutable once written — a signature is evidence; never mutate.
 *
 * Waivers signed through a party invite are also indexed by partyId so the
 * host's roster can list who has RSVP'd.
 */
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'

const logger = createLogger('waiver-store')
const kv = makeKvStore('waivers', 'waivers')

export interface WaiverMinor {
  name: string
  dob: string // YYYY-MM-DD
  /** Allergies / medical notes for THIS child. */
  allergies: string
}

export type EventKind = 'party' | 'workshop' | 'open-studio'

export interface WaiverRecord {
  id: string
  agreementVersion: string
  agreementSha256: string
  signedAt: string // ISO
  validUntil: string // ISO
  adult: {
    firstName: string
    lastName: string
    email: string
    phone: string
    dob: string
    /** Allergies / medical notes for the signing adult (if they participate). */
    allergies: string
  }
  minors: WaiverMinor[]
  emergency: {
    name: string
    phone: string
    relationship: string
  }
  /** Who may collect the child(ren) at a drop-off event. */
  authorizedPickup: string
  photoConsent: boolean
  signature: string
  /** Legacy field — kept as a mirror of context.id when kind==='party'. */
  partyId: string | null
  /** Structured event context. Optional-tolerant on parse (legacy records omit it). */
  context: { kind: EventKind; id: string } | null
  /** Adult who will be with the child(ren) at the party if the signer is not attending. */
  responsibleAdult: string | null
  squareCustomerId: string | null
  ip: string | null
  userAgent: string | null
}

/** The re-usable household data we surface to a returning customer on lookup. */
export interface HouseholdOnFile {
  recordId: string
  validUntil: string
  firstName: string
  lastName: string
  email: string
  phone: string
  dob: string
  adultAllergies: string
  minors: WaiverMinor[]
  emergency: { name: string; phone: string; relationship: string }
  authorizedPickup: string
  photoConsent: boolean
}

// ---- Raw key/value layer (Netlify Blobs in prod, .data/ on disk in dev) ----
// Delegated to shared kv — see src/lib/blob-store.ts for error semantics.

async function rawSet(key: string, json: string): Promise<void> {
  await kv.set(key, json)
}

async function rawGet(key: string): Promise<string | null> {
  return kv.get(key)
}

async function rawGetWithMeta(key: string): Promise<{ value: string | null; etag: string | null }> {
  return kv.getWithMeta(key)
}

// ---- Records ----

export async function saveWaiverRecord(record: WaiverRecord): Promise<void> {
  await rawSet(record.id, JSON.stringify(record, null, 2))
  logger.info('Waiver stored', { id: record.id })
}

export async function getWaiverRecord(id: string): Promise<WaiverRecord | null> {
  const json = await rawGet(id)
  return json ? JSON.parse(json) : null
}

export function newWaiverId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `wvr_${Date.now().toString(36)}_${rand}`
}

// ---- Event RSVP index ----
// A small blob per event holding the list of { recordId, contactKey } objects.
// Supports legacy bare-string entries for backward compatibility.
// Read-modify-write; a party has few guests so contention is negligible.

/**
 * Derive the blob key for an event index.
 * IMPORTANT: party kind MUST return the exact legacy key `party-index-{id}`
 * byte-for-byte — no migration; existing party rosters depend on this.
 * New kinds use the `event-index-{kind}:{id}` namespace.
 */
export function indexKeyFor(kind: EventKind, id: string): string {
  return kind === 'party' ? `party-index-${id}` : `event-index-${kind}:${id}`
}

/** @deprecated Use indexKeyFor('party', partyId) — kept for internal clarity. */
function partyIndexKey(partyId: string): string {
  return indexKeyFor('party', partyId)
}

/**
 * Return the structured event context for a record.
 * Tolerates legacy records that pre-date the context field.
 */
export function contextOf(r: WaiverRecord): { kind: EventKind; id: string } | null {
  return r.context ?? (r.partyId ? { kind: 'party', id: r.partyId } : null)
}

/** Parse index entries, upgrading legacy bare-string ids to the object shape. */
async function readIndexEntries(key: string): Promise<{ recordId: string; contactKey: string }[]> {
  const raw = await rawGet(key)
  return raw
    ? JSON.parse(raw).map((e: any) =>
        typeof e === 'string' ? { recordId: e, contactKey: '' } : e,
      )
    : []
}

/** Derive a stable contact key from a waiver record. Falls back to record id if no contact info. */
function contactKeyOf(r: WaiverRecord): string {
  const email = r.adult.email.trim().toLowerCase()
  if (email) return `e:${email}`
  const digits = r.adult.phone.replace(/\D/g, '').slice(-10)
  return digits ? `p:${digits}` : `r:${r.id}`
}

/**
 * Add-or-replace this household's entry in the event index (re-RSVP = edit).
 * Same contact key → the previous entry is removed and the new one inserted.
 * Returns the replaced record id (null if this is the first RSVP for this contact).
 * For kind==='party' this reads/writes the exact legacy `party-index-{id}` key.
 *
 * Uses a CAS retry loop (3 attempts) to avoid TOCTOU races when two households
 * RSVP to the same party simultaneously. A lost race is retried; after 3 failed
 * CAS attempts the error propagates — persistWaiver's caller catches index failures
 * as best-effort so the signature is already safely stored.
 */
export async function upsertWaiverInEventIndex(
  kind: EventKind,
  id: string,
  record: WaiverRecord,
): Promise<{ replacedRecordId: string | null }> {
  const key = indexKeyFor(kind, id)
  const ck = contactKeyOf(record)

  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await rawGetWithMeta(key)
    const entries: { recordId: string; contactKey: string }[] = value
      ? JSON.parse(value).map((e: any) =>
          typeof e === 'string' ? { recordId: e, contactKey: '' } : e,
        )
      : []
    const prev = entries.find((e) => e.contactKey === ck && e.recordId !== record.id)
    const next = entries.filter((e) => e.contactKey !== ck && e.recordId !== record.id)
    next.push({ recordId: record.id, contactKey: ck })
    if (await kv.setIfMatch(key, JSON.stringify(next), etag, value !== null)) {
      return { replacedRecordId: prev?.recordId ?? null }
    }
    // Lost the CAS race — retry
  }
  throw new Error('Concurrent update on event index — please retry')
}

export async function listWaiversByEvent(kind: EventKind, id: string): Promise<WaiverRecord[]> {
  const entries = await readIndexEntries(indexKeyFor(kind, id))
  const records = await Promise.all(entries.map((e) => getWaiverRecord(e.recordId)))
  return records.filter((r): r is WaiverRecord => r !== null)
}

/** Thin party wrapper — existing callers untouched. */
export async function upsertWaiverInPartyIndex(
  partyId: string,
  record: WaiverRecord,
): Promise<{ replacedRecordId: string | null }> {
  return upsertWaiverInEventIndex('party', partyId, record)
}

/** Thin party wrapper — existing callers untouched. */
export async function listWaiversByParty(partyId: string): Promise<WaiverRecord[]> {
  return listWaiversByEvent('party', partyId)
}

// ---- Duplicate-child detection ----

/**
 * Flag children whose normalized name appears in an EARLIER household too.
 * Mutates the children objects in place by setting `duplicateOf` to the first
 * signer's name. Returns the number of duplicates found.
 */
export function markDuplicateChildren<
  T extends { signer: string; children: { name: string; duplicateOf?: string }[] },
>(households: T[]): number {
  const seen = new Map<string, string>() // normalized name → first signer
  let duplicates = 0
  for (const h of households) {
    for (const c of h.children) {
      const k = c.name.trim().toLowerCase().replace(/\s+/g, ' ')
      if (!k) continue
      const first = seen.get(k)
      if (first) {
        c.duplicateOf = first
        duplicates++
      } else {
        seen.set(k, h.signer)
      }
    }
  }
  return duplicates
}

// ---- Contact index (returning-customer lookup) ----
// Points a normalized email/phone at the person's latest household-on-file so
// a returning guest can RSVP without re-filling their whole waiver.

function emailKey(email: string): string {
  return `contact-email-${email.trim().toLowerCase()}`
}
function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10)
  return digits.length === 10 ? `contact-phone-${digits}` : ''
}

function householdFrom(r: WaiverRecord): HouseholdOnFile {
  return {
    recordId: r.id,
    validUntil: r.validUntil,
    firstName: r.adult.firstName,
    lastName: r.adult.lastName,
    email: r.adult.email,
    phone: r.adult.phone,
    dob: r.adult.dob,
    adultAllergies: r.adult.allergies,
    minors: r.minors,
    emergency: r.emergency,
    authorizedPickup: r.authorizedPickup,
    photoConsent: r.photoConsent,
  }
}

export async function indexWaiverByContact(record: WaiverRecord): Promise<void> {
  const summary = JSON.stringify(householdFrom(record))
  await rawSet(emailKey(record.adult.email), summary)
  const pk = phoneKey(record.adult.phone)
  if (pk) await rawSet(pk, summary)
}

/** Latest household on file for an email or phone, only if still valid at `now`. */
export async function lookupHousehold(contact: string, now: Date): Promise<HouseholdOnFile | null> {
  const entry = await lookupHouseholdEntry(contact)
  return entry && new Date(entry.validUntil).getTime() > now.getTime() ? entry : null
}

/**
 * Like {@link lookupHousehold} but returns the record even when expired, so
 * callers can tell "no agreement on file" from "found, but it lapsed" and give
 * the returning customer the right message.
 */
export async function lookupHouseholdEntry(contact: string): Promise<HouseholdOnFile | null> {
  const c = contact.trim()
  const keys = c.includes('@') ? [emailKey(c)] : [phoneKey(c)].filter(Boolean)
  for (const key of keys) {
    const json = await rawGet(key)
    if (!json) continue
    return JSON.parse(json) as HouseholdOnFile
  }
  return null
}
