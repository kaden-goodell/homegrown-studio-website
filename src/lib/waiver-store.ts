/**
 * Signed-waiver persistence + per-party RSVP index.
 *
 * Production (Netlify): Netlify Blobs. Local dev: `.data/waivers/` on disk.
 * Records are immutable once written — a signature is evidence; never mutate.
 *
 * Never delete. Minor claims toll to age 21 in Alabama — see
 * `docs/CREW-OPERATIONS.md` §7 and the weekly self-archive in
 * `src/lib/archive-export.ts` (HOM-217).
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
  /** Allergies / medical notes for THIS child. The literal string 'None' is a
   *  deliberate answer (HOM-212) — distinct from '' (never asked/left blank). */
  allergies: string
  /** Medications or conditions staff should know about for a drop-off program
   *  (HOM-212) — '' when none. The Studio never administers medication;
   *  see agreement §4b(b). */
  medications: string
}

/** One person authorized to collect a child at a drop-off event (HOM-212).
 *  `phone` is '' when not given (legacy free-text pickup notes never had one). */
export interface AuthorizedPickup {
  name: string
  phone: string
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
    /** '' since Oct 2026 — the form asks for an age attestation instead. */
    dob: string
    /** Signer ticked "I'm 19 or older". Absent on records signed before Oct 2026 (those carry a DOB). */
    ageConfirmed?: boolean
    /** Allergies / medical notes for the signing adult (if they participate). */
    allergies: string
  }
  minors: WaiverMinor[]
  /** Name + phone; both '' when a plain-visit signer skipped it (optional
   *  since Oct 2026, required for drop-off). `relationship` is '' on new records. */
  emergency: {
    name: string
    phone: string
    relationship: string
  }
  /**
   * Who may collect the child(ren) at a drop-off event (up to 3). Was a
   * free-text string pre-HOM-212 — legacy records still hold a bare string on
   * disk; read them through `normalizeAuthorizedPickup()`, never assume the
   * array shape from a raw record.
   */
  authorizedPickup: AuthorizedPickup[]
  /** Anyone who may NOT collect the child(ren) — custody restrictions
   *  (HOM-212). '' when none given. Free text (e.g. "no contact per court
   *  order — see copy on file"), never structured. */
  notAuthorized: string
  photoConsent: boolean
  signature: string
  /**
   * @deprecated Legacy mirror of context.id when kind==='party'. Never set on
   * new records (HOM-210) — a signature no longer carries its event; that
   * link lives in the event index + `RsvpRecord` (@lib/rsvp-store) instead.
   * Kept optional so old records still parse.
   */
  partyId?: string | null
  /**
   * @deprecated Structured event context. Never set on new records — see
   * `partyId`. Optional-tolerant on parse (legacy records omit it).
   */
  context?: { kind: EventKind; id: string } | null
  /**
   * @deprecated Adult who will be with the child(ren) if the signer isn't
   * attending. Never set on new records — this is now per-RSVP, not
   * per-signature (see `RsvpRecord.responsibleAdult`).
   */
  responsibleAdult?: string | null
  squareCustomerId: string | null
  ip: string | null
  userAgent: string | null
}

/** The re-usable household data we surface to a returning customer on lookup. */
export interface HouseholdOnFile {
  recordId: string
  validUntil: string
  signedAt: string
  agreementVersion: string
  firstName: string
  lastName: string
  email: string
  phone: string
  dob: string
  adultAllergies: string
  minors: WaiverMinor[]
  emergency: { name: string; phone: string; relationship: string }
  /** Normalized on read via `normalizeAuthorizedPickup()` — safe regardless
   *  of whether the underlying record predates HOM-212. */
  authorizedPickup: AuthorizedPickup[]
  notAuthorized: string
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

/** The shape callers outside this module get back — enough to join against
 *  `@lib/rsvp-store` (`getRsvp(kind, id, waiverId)`) for "who's coming". */
export interface EventIndexEntry {
  waiverId: string
  rsvpId: string | null
}

/** Internal storage shape — adds the contact key used to dedupe re-signs by
 *  the same household (never exposed outside this module). */
interface StoredIndexEntry extends EventIndexEntry {
  contactKey: string
}

/**
 * Normalize one raw stored entry onto the current shape. Accepts every shape
 * this blob has ever held: a bare string id (oldest), `{recordId, contactKey}`
 * (pre-RSVP), and `{waiverId, contactKey, rsvpId}` (current).
 */
function normalizeIndexEntry(e: any): StoredIndexEntry {
  if (typeof e === 'string') return { waiverId: e, contactKey: '', rsvpId: null }
  if ('recordId' in e) return { waiverId: e.recordId, contactKey: e.contactKey ?? '', rsvpId: e.rsvpId ?? null }
  return { waiverId: e.waiverId, contactKey: e.contactKey ?? '', rsvpId: e.rsvpId ?? null }
}

function parseIndexEntries(raw: string): StoredIndexEntry[] {
  return JSON.parse(raw).map(normalizeIndexEntry)
}

/** Parse index entries, upgrading every legacy shape to the current one. */
async function readIndexEntries(key: string): Promise<StoredIndexEntry[]> {
  const raw = await rawGet(key)
  return raw ? parseIndexEntries(raw) : []
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
  rsvpId: string | null = null,
): Promise<{ replacedRecordId: string | null }> {
  const key = indexKeyFor(kind, id)
  const ck = contactKeyOf(record)

  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await rawGetWithMeta(key)
    const entries: StoredIndexEntry[] = value ? parseIndexEntries(value) : []
    const prev = entries.find((e) => e.contactKey === ck && e.waiverId !== record.id)
    const next = entries.filter((e) => e.contactKey !== ck && e.waiverId !== record.id)
    next.push({ waiverId: record.id, contactKey: ck, rsvpId })
    if (await kv.setIfMatch(key, JSON.stringify(next), etag, value !== null)) {
      return { replacedRecordId: prev?.waiverId ?? null }
    }
    // Lost the CAS race — retry
  }
  throw new Error('Concurrent update on event index — please retry')
}

export async function listWaiversByEvent(kind: EventKind, id: string): Promise<WaiverRecord[]> {
  const entries = await readIndexEntries(indexKeyFor(kind, id))
  const records = await Promise.all(entries.map((e) => getWaiverRecord(e.waiverId)))
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
 * Flag children who appear in an EARLIER household too — the mom-and-dad case
 * where both parents list the same kid on their own waivers. Matching requires
 * name AND date of birth: the same child listed twice shares a birthdate, while
 * two different kids who happen to share a name (two Bob Silvers at one party)
 * do not, and both must count. Mutates the children objects in place by setting
 * `duplicateOf` to the first signer's name. Returns the number of duplicates.
 */
export function markDuplicateChildren<
  T extends { signer: string; children: { name: string; dob?: string; duplicateOf?: string }[] },
>(households: T[]): number {
  const seen = new Map<string, string>() // normalized name|dob → first signer
  let duplicates = 0
  for (const h of households) {
    for (const c of h.children) {
      const name = c.name.trim().toLowerCase().replace(/\s+/g, ' ')
      if (!name) continue
      const k = `${name}|${c.dob ?? ''}`
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

/**
 * Normalize any shape `authorizedPickup` has ever been stored in (HOM-212):
 * a legacy free-text string ("Grandma Rivera, Uncle Joe and Aunt Sue"), the
 * current `{name, phone}[]`, or garbage. Always safe to call on a raw record
 * straight off disk.
 */
export function normalizeAuthorizedPickup(value: unknown): AuthorizedPickup[] {
  if (typeof value === 'string') {
    return value
      .split(/,|\band\b|\n|&|;/i)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name, phone: '' }))
  }
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (!v || typeof v !== 'object') return null
        const name = String((v as any).name ?? '').trim()
        const phone = String((v as any).phone ?? '').trim()
        return name ? { name, phone } : null
      })
      .filter((v): v is AuthorizedPickup => v !== null)
  }
  return []
}

function householdFrom(r: WaiverRecord): HouseholdOnFile {
  return {
    recordId: r.id,
    validUntil: r.validUntil,
    signedAt: r.signedAt,
    agreementVersion: r.agreementVersion,
    firstName: r.adult.firstName,
    lastName: r.adult.lastName,
    email: r.adult.email,
    phone: r.adult.phone,
    dob: r.adult.dob,
    adultAllergies: r.adult.allergies,
    minors: r.minors,
    emergency: r.emergency,
    authorizedPickup: normalizeAuthorizedPickup(r.authorizedPickup),
    notAuthorized: r.notAuthorized ?? '',
    photoConsent: r.photoConsent,
  }
}

export async function indexWaiverByContact(record: WaiverRecord): Promise<void> {
  const summary = JSON.stringify(householdFrom(record))
  await rawSet(emailKey(record.adult.email), summary)
  const pk = phoneKey(record.adult.phone)
  if (pk) await rawSet(pk, summary)
  await indexWaiverByName(record)
}

// ---- Last-name index (staff door search, HOM-208) ----
// Points a normalized last name at every waiver record ever signed under it,
// so staff can search "rivera" at the door and page through matches. Not
// deduped by contact at write time (a re-sign just appends another entry) —
// lookupHouseholdsByName collapses those back to one row per household.

/** Case/whitespace/diacritic-insensitive key for last-name matching. */
function normalizeName(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ')
}

function nameIndexKey(lastName: string): string {
  return `contact-name-${normalizeName(lastName)}`
}

interface NameIndexEntry {
  recordId: string
  firstName: string
}

/**
 * Add this record's signer to the last-name index. Idempotent per recordId —
 * safe to call from both the live persist path (via indexWaiverByContact)
 * and the one-off backfill script for records written before this index
 * existed (scripts/backfill-name-index.ts).
 */
export async function indexWaiverByName(record: WaiverRecord): Promise<void> {
  const last = record.adult.lastName?.trim()
  if (!last) return
  const key = nameIndexKey(last)
  const raw = await rawGet(key)
  const entries: NameIndexEntry[] = raw ? JSON.parse(raw) : []
  if (entries.some((e) => e.recordId === record.id)) return
  entries.push({ recordId: record.id, firstName: record.adult.firstName })
  await rawSet(key, JSON.stringify(entries))
}

/**
 * Every household on file whose last name matches (normalized). A household
 * that has re-signed more than once collapses to its most recent record so
 * staff see one row per household, not one per re-sign.
 *
 * Dedupes by CONTACT IDENTITY (`contactKeyOf` — normalized email, else
 * last-10 phone, else record id), never by the name string: two different
 * customers who happen to share a full name ("Sam Rivera") are different
 * households and MUST both come back, or the second one becomes unreachable
 * by name search — a kids'-safety lookup, not a display nicety. Results are
 * sorted newest-signed-first so a re-picked list reads sensibly.
 */
export async function lookupHouseholdsByName(lastName: string): Promise<HouseholdOnFile[]> {
  const raw = await rawGet(nameIndexKey(lastName))
  if (!raw) return []
  const entries: NameIndexEntry[] = JSON.parse(raw)
  const latest = new Map<string, { record: WaiverRecord; household: HouseholdOnFile }>()
  for (const e of entries) {
    const record = await getWaiverRecord(e.recordId)
    if (!record) continue
    const dedupeKey = contactKeyOf(record)
    const prev = latest.get(dedupeKey)
    if (!prev || record.signedAt > prev.record.signedAt) {
      latest.set(dedupeKey, { record, household: householdFrom(record) })
    }
  }
  return [...latest.values()]
    .sort((a, b) => b.record.signedAt.localeCompare(a.record.signedAt))
    .map((v) => v.household)
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
