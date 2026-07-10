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
  partyId: string | null
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

// ---- Per-party RSVP index ----
// A small blob per party holding the list of waiver record ids signed for it.
// Read-modify-write; a party has few guests so contention is negligible.

function partyIndexKey(partyId: string): string {
  return `party-index-${partyId}`
}

export async function addWaiverToPartyIndex(partyId: string, recordId: string): Promise<void> {
  const key = partyIndexKey(partyId)
  const existing = await rawGet(key)
  const ids: string[] = existing ? JSON.parse(existing) : []
  if (!ids.includes(recordId)) ids.push(recordId)
  await rawSet(key, JSON.stringify(ids))
}

export async function listWaiversByParty(partyId: string): Promise<WaiverRecord[]> {
  const existing = await rawGet(partyIndexKey(partyId))
  const ids: string[] = existing ? JSON.parse(existing) : []
  const records = await Promise.all(ids.map(getWaiverRecord))
  return records.filter((r): r is WaiverRecord => r !== null)
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
