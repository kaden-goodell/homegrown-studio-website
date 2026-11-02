/**
 * The studio's own staff list (D5, Kaden 2 Nov: "We're NOT using Square
 * payroll so you can just do it locally"). Owners manage it in /admin › More
 * › Staff › People: Add someone, Edit, No longer working here (kept for the
 * record, never deleted), Working here again.
 *
 * One record in kv `staff-people` (key `people`), changed with
 * compare-and-set. The first time the list is needed and doesn't exist yet,
 * the current ACTIVE Square team is brought in once, with the SAME ids, so
 * staffing, waiver, audit and sign-in records made under Square team ids stay
 * linked. That is the only Square read this file ever makes; once the list
 * exists, Square Team is never read for staff again. The import is
 * create-only (two servers racing both end up with the one saved list) and
 * never runs on a test site that shares the live stores (R41): there the
 * Square team is shown read-only and nothing is saved.
 *
 * - listStaff(): `{id, name, role}` of everyone working here, for the
 *   "Who's on the iPad?" picker. Never contact details. If the list can't be
 *   read at all (store down, first import failed) it answers with the two
 *   owners under the fallback ids 'kaden'/'catherine', so nobody is locked out
 *   of the console; nothing is ever stored under those ids.
 * - teamWithContacts(): server only, with email and phone, for telling a
 *   person they're on a shift.
 * - isActiveStaffId() / staffIdStatus(): someone who no longer works here is
 *   not active: their calendar link answers 404, every /staff request with
 *   their sign-in is refused (staff-auth), and they leave every picker.
 * - staffIdForOwner(): /admin knows owners by name ('Catherine' | 'Kaden');
 *   this maps that name to the owner's id: the person linked to that owner
 *   when the list started (so a rename doesn't matter), else by given name.
 *   The import makes anyone named Catherine or Kaden an owner (Square marks
 *   only its single account owner).
 *
 * Server only. Contact details never leave the server except to owners
 * (/api/admin/*).
 */
import { randomBytes } from 'node:crypto'
import { createLogger } from '@lib/logger'
import { createSquareClient } from '@providers/square/client'
import { siteConfig } from '@config/site.config'
import type { SquareConfig } from '@config/site.config'
import type { By, StaffMember } from '@lib/staff-auth'
import { OWNERS, ownerOf, type Owner } from '@lib/admin-who'
import { makeKvStore } from '@lib/blob-store'
import { classWritesRefusal, TestSiteStoreError } from '@lib/classes/test-site-guard'
import { isEmail, isPhone } from '@lib/contact-rules'
import { StaffingError } from '@lib/staffing/errors'

const logger = createLogger('staff-directory')

const FALLBACK: StaffMember[] = [
  { id: 'kaden', name: 'Kaden', role: 'owner' },
  { id: 'catherine', name: 'Catherine', role: 'owner' },
]

/** The ids listStaff() answers with when the list can't be read. Never a real person: nothing is keyed by them. */
export const FALLBACK_IDS: ReadonlySet<string> = new Set(FALLBACK.map((m) => m.id))

/** A team member with their contact details. Server only. */
export interface StaffPerson extends StaffMember {
  /** For matching an /admin owner name (the display `name` may carry a family initial). */
  givenName: string
  familyName: string
  email: string | null
  phone: string | null
  active: boolean
}

/** One person on our list, as saved. */
export interface StaffRecord {
  id: string
  givenName: string
  familyName: string
  role: 'owner' | 'crew'
  email: string | null
  phone: string | null
  active: boolean
  /** When they stopped working here (null while they work here). */
  leftAt: string | null
  /** 'square' = brought in from the Square team (same id); 'added' = added in /admin. */
  from: 'square' | 'added'
  createdAt: string
  updatedAt: string
  /** newest first, capped at PERSON_HISTORY_CAP */
  history: { at: string; by: By; change: string }[]
  /**
   * Which /admin owner this person is ('Catherine' | 'Kaden'), set when the
   * list started. It follows the id, so renaming an owner ("Cat") keeps their
   * whole-studio calendar's "You're on". Absent on lists saved before it existed.
   */
  owner?: Owner | null
}

export interface StaffDoc {
  v: 1
  /** 'square' = first brought in from the Square team; 'fresh' = started without it. */
  startedFrom: 'square' | 'fresh'
  startedAt: string
  updatedAt: string
  people: StaffRecord[]
}

export const PERSON_HISTORY_CAP = 30
const MAX_NAME = 40
const MAX_EMAIL = 120

const kv = makeKvStore('staff-people', 'staff-people')
const KEY = 'people'

/** A few seconds' memory, so one request reading the list several times reads it once. Cleared by every write here. */
const CACHE_MS = 5_000
let cache: { at: number; doc: StaffDoc; saved: boolean } | null = null
/**
 * The last saved list this server read (S5). When the list can't be read for
 * a moment, someone this server already knows left is still refused.
 */
let lastKnown: StaffDoc | null = null
/** When the first import last failed on this server: no new Square try for IMPORT_RETRY_MS (S5). */
let importFailedAt = 0
export const IMPORT_RETRY_MS = 60_000

/** @internal test-only: forget the cached list (and this server's memories of it). */
export function _resetStaffCache(): void {
  cache = null
  lastKnown = null
  importFailedAt = 0
}

/** @internal test-only: forget only the few-seconds cache (as if time passed), keeping this server's last-read list. */
export function _expireStaffCacheForTests(): void {
  cache = null
  importFailedAt = 0
}

/** Read the list again on the next look. This server only. */
export function forgetTeamCache(): void {
  cache = null
}

/** @internal test-only: delete the saved list (so the next read imports again). */
export async function _resetStaffListForTests(): Promise<void> {
  cache = null
  lastKnown = null
  importFailedAt = 0
  await kv.set(KEY, 'null')
  await kv.set(FAILS_KEY, 'null')
}

/** @internal test-only: pretend the first import has been failing for a while. */
export async function _setImportFailuresForTests(tries: number, firstAt: number): Promise<void> {
  await kv.set(FAILS_KEY, JSON.stringify({ firstAt, tries, lastAt: Date.now() }))
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

export class StaffListUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StaffListUnavailable'
  }
}

/** What an owner sees when the list couldn't be started from the Square team. */
export const IMPORT_FAILED = 'We couldn’t set up the staff list yet. Try again in a minute.'

async function readSaved(): Promise<{ doc: StaffDoc | null; etag: string | null; exists: boolean }> {
  const { value, etag } = await kv.getWithMeta(KEY)
  if (!value) return { doc: null, etag, exists: false }
  const doc = JSON.parse(value) as StaffDoc | null
  // A record reset to `null` exists in the store but holds no list.
  if (!doc || !Array.isArray(doc.people)) return { doc: null, etag, exists: true }
  return { doc, etag, exists: true }
}

/** The active Square team, once, for the first import. Throws when Square fails or lists nobody. */
async function squareTeamForImport(): Promise<StaffRecord[]> {
  const client = createSquareClient(siteConfig.providers.catalog.config as SquareConfig)
  const res: any = await client.teamMembers.search({ query: { filter: { status: 'ACTIVE' } } })
  const active = ((res.teamMembers ?? []) as any[]).filter((m) => m.status === 'ACTIVE' && typeof m.id === 'string' && m.id)
  if (active.length === 0) throw new Error('Square returned no active team members')
  const now = new Date().toISOString()
  const by: By = { id: 'system', name: 'Set up' }
  const given = (m: any) => String(m.givenName ?? '').trim()
  // Square marks only its one account owner. Catherine and Kaden are both owners
  // here, so anyone whose first name is one of theirs comes in as an owner too
  // (and is linked to that /admin owner when exactly one person has the name).
  const ownerFor = (m: any): Owner | null => {
    const o = ownerOf(given(m))
    return o && active.filter((x) => ownerOf(given(x)) === o).length === 1 ? o : null
  }
  return active.map((m) => ({
    id: m.id,
    givenName: given(m) || 'Someone',
    familyName: String(m.familyName ?? '').trim(),
    role: m.isOwner || ownerOf(given(m)) ? 'owner' : 'crew',
    owner: ownerFor(m),
    email: text(m.emailAddress),
    phone: text(m.phoneNumber),
    active: true,
    leftAt: null,
    from: 'square',
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, by, change: 'Brought in from the Square team' }],
  }))
}

/**
 * The saved list; on first use, imports the Square team once and saves it
 * (create-only, so a race keeps one list). On a test site sharing the live
 * stores the imported team is returned unsaved (`saved: false`).
 * Throws StaffListUnavailable when there's no list and the import failed.
 */
async function loadDoc(): Promise<{ doc: StaffDoc; saved: boolean }> {
  if (cache && Date.now() - cache.at < CACHE_MS) return { doc: cache.doc, saved: cache.saved }
  const first = await readSaved()
  if (first.doc) {
    cache = { at: Date.now(), doc: first.doc, saved: true }
    lastKnown = first.doc
    return { doc: first.doc, saved: true }
  }
  // A failed import is remembered for a minute: iPads polling /staff don't each call Square and bump the count.
  if (importFailedAt && Date.now() - importFailedAt < IMPORT_RETRY_MS) throw new StaffListUnavailable(IMPORT_FAILED)
  let people: StaffRecord[]
  try {
    people = await squareTeamForImport()
  } catch (err) {
    logger.error('Could not bring in the Square team for the first staff list', { error: err instanceof Error ? err.message : String(err) })
    importFailedAt = Date.now()
    await noteImportFailure()
    throw new StaffListUnavailable(IMPORT_FAILED)
  }
  importFailedAt = 0
  const now = new Date().toISOString()
  const doc: StaffDoc = { v: 1, startedFrom: 'square', startedAt: now, updatedAt: now, people }
  if (classWritesRefusal()) {
    // R41: never write the live list from a test site; show what Square has, read only.
    cache = { at: Date.now(), doc, saved: false }
    return { doc, saved: false }
  }
  if (await kv.setIfMatch(KEY, JSON.stringify(doc), first.etag, first.exists)) {
    logger.info('Staff list started from the Square team', { people: people.length })
    cache = { at: Date.now(), doc, saved: true }
    lastKnown = doc
    return { doc, saved: true }
  }
  // Another server saved the list first: use theirs.
  const again = await readSaved()
  if (!again.doc) throw new StaffListUnavailable(IMPORT_FAILED)
  cache = { at: Date.now(), doc: again.doc, saved: true }
  lastKnown = again.doc
  return { doc: again.doc, saved: true }
}

// ---------------------------------------------------------------- first import keeps failing

const FAILS_KEY = 'import-failures'
/** "Start the list with just the owners" is offered only after this many failed tries… */
export const FRESH_AFTER_TRIES = 3
/** …spread over at least this long, so a short Square blip never costs the id links. */
export const FRESH_AFTER_MS = 10 * 60_000

/** Count a failed first import (best effort; never on a test site sharing the live stores). */
async function noteImportFailure(now = Date.now()): Promise<void> {
  if (classWritesRefusal()) return
  try {
    const raw = await kv.get(FAILS_KEY)
    const was = raw ? (JSON.parse(raw) as { firstAt?: number; tries?: number } | null) : null
    const firstAt = typeof was?.firstAt === 'number' ? was.firstAt : now
    const tries = (typeof was?.tries === 'number' ? was.tries : 0) + 1
    await kv.set(FAILS_KEY, JSON.stringify({ firstAt, tries, lastAt: now }))
  } catch (err) {
    logger.warn('Could not count a failed staff list import', { error: err instanceof Error ? err.message : String(err) })
  }
}

/** True once the first import has failed FRESH_AFTER_TRIES times over at least FRESH_AFTER_MS, and there's still no list. */
export async function canStartFresh(now = Date.now()): Promise<boolean> {
  try {
    if ((await readSaved()).doc) return false
    const raw = await kv.get(FAILS_KEY)
    const was = raw ? (JSON.parse(raw) as { firstAt?: number; tries?: number } | null) : null
    return typeof was?.firstAt === 'number' && (was.tries ?? 0) >= FRESH_AFTER_TRIES && now - was.firstAt >= FRESH_AFTER_MS
  } catch {
    return false
  }
}

/** Display names: the given name, plus a family initial when two people working here share it. */
function withNames(records: StaffRecord[]): StaffPerson[] {
  const counts = new Map<string, number>()
  for (const r of records) if (r.active) counts.set(r.givenName.toLowerCase(), (counts.get(r.givenName.toLowerCase()) ?? 0) + 1)
  return records.map((r) => {
    const shared = r.active && (counts.get(r.givenName.toLowerCase()) ?? 0) > 1
    const initial = r.familyName.trim().charAt(0)
    return {
      id: r.id,
      name: shared && initial ? `${r.givenName} ${initial}.` : r.givenName,
      givenName: r.givenName,
      familyName: r.familyName,
      role: r.role,
      email: r.email,
      phone: r.phone,
      active: r.active,
    }
  })
}

/**
 * Server only. Everyone working here, with contact details. Throws when the
 * list can't be read (callers show an error, never an empty team).
 * `source` is kept for callers: always 'local' now.
 */
export async function teamWithContacts(): Promise<{ people: StaffPerson[]; source: 'local' }> {
  const { doc } = await loadDoc()
  return { people: withNames(doc.people).filter((p) => p.active), source: 'local' }
}

/** Server only, owners' screens: everyone with contact details, those who left too (`active: false`), so Call / Text still work for someone still on a cancelled party. */
export async function everyoneWithContacts(): Promise<StaffPerson[]> {
  const { doc } = await loadDoc()
  return withNames(doc.people)
}

/** Owners only (/admin › People): everyone, those who left too, with their records. */
export async function staffListForOwners(): Promise<{ people: (StaffPerson & { leftAt: string | null; from: StaffRecord['from']; updatedAt: string })[]; saved: boolean; startedFrom: StaffDoc['startedFrom'] }> {
  const { doc, saved } = await loadDoc()
  const named = withNames(doc.people)
  return {
    people: named.map((p, i) => ({ ...p, leftAt: doc.people[i].leftAt, from: doc.people[i].from, updatedAt: doc.people[i].updatedAt })),
    saved,
    startedFrom: doc.startedFrom,
  }
}

/** Everyone working here as `{id, name, role}`, for the picker. Never throws: the owners under the fallback ids when unreadable. */
export async function listStaff(): Promise<StaffMember[]> {
  try {
    const { people } = await teamWithContacts()
    if (people.length === 0) return FALLBACK
    return people.map((p) => ({ id: p.id, name: p.name, role: p.role }))
  } catch (err) {
    logger.warn('Staff list unreadable — using the fallback owner roster', { error: err instanceof Error ? err.message : String(err) })
    return FALLBACK
  }
}

/** True only for someone working here now. The fallback ids are never real; an unreadable list answers false. */
export async function isActiveStaffId(id: string): Promise<boolean> {
  return (await staffIdStatus(id)) === 'yes'
}

/**
 * Like isActiveStaffId, but tells "not working here" ('no') apart from "the
 * list can't be read at all" ('unknown'), so a calendar link can answer
 * "try again soon" instead of looking dead. While the list can't be read,
 * the last list this server read still answers for the people on it (so
 * someone known to have left stays refused); anyone else is 'unknown'.
 */
export async function staffIdStatus(id: string): Promise<'yes' | 'no' | 'unknown'> {
  if (typeof id !== 'string' || !id || FALLBACK_IDS.has(id)) return 'no'
  try {
    const { people } = await teamWithContacts()
    return people.some((p) => p.id === id && p.active) ? 'yes' : 'no'
  } catch {
    const known = lastKnown?.people.find((p) => p.id === id)
    if (known) return known.active ? 'yes' : 'no'
    return 'unknown'
  }
}

/**
 * True when the staff list can be read now (S5). The fallback owner ids are
 * handed out only while it can't, so their cookies stop counting once it can.
 */
export async function staffListReadable(): Promise<boolean> {
  try {
    await loadDoc()
    return true
  } catch {
    return false
  }
}

/**
 * The owners working here (role Owner), with contact details, from the SAVED
 * list only: never starts the first import from Square (so /admin and the
 * alert senders never call Square for it). null when no list has been saved
 * yet (the bootstrap owners apply). When the store can't be read: the last
 * list this server read, else it throws.
 */
export async function savedOwners(): Promise<StaffPerson[] | null> {
  let doc: StaffDoc | null
  if (cache && cache.saved && Date.now() - cache.at < CACHE_MS) doc = cache.doc
  else {
    try {
      doc = (await readSaved()).doc
      if (doc) {
        cache = { at: Date.now(), doc, saved: true }
        lastKnown = doc
      }
    } catch (err) {
      if (!lastKnown) throw err
      doc = lastKnown
    }
  }
  if (!doc) return null
  return withNames(doc.people).filter((p) => p.active && p.role === 'owner')
}

/**
 * The person an /admin owner name is: the one linked to that owner when the
 * list started (follows the id, so a rename doesn't matter), else by given
 * name among owners working here; null when not found, ambiguous, or unreadable.
 */
export async function staffIdForOwner(owner: Owner): Promise<string | null> {
  let people: StaffRecord[]
  try {
    people = (await loadDoc()).doc.people.filter((p) => p.active)
  } catch {
    return null
  }
  // The link counts only while they're still an Owner (S4: an edit to Crew clears it, and older lists may still carry it).
  const linked = people.filter((p) => p.owner === owner && p.role === 'owner')
  if (linked.length === 1) return linked[0].id
  const want = owner.trim().toLowerCase()
  // An owner added later has no link: their name as the staff list shows it ("Dana", or "Dana R." when two share it).
  const named = withNames(people).filter((p) => p.role === 'owner' && p.name.trim().toLowerCase() === want)
  if (named.length === 1 && !people.find((r) => r.id === named[0].id)?.owner) return named[0].id
  const hits = people.filter((p) => p.role === 'owner' && !p.owner && p.givenName.trim().toLowerCase() === want)
  return hits.length === 1 ? hits[0].id : null
}

/**
 * A staff phone as E.164, from what an owner typed: the digits only, so a
 * stray leading "+" or "+1" can't make a bad text number. 10 digits → +1…,
 * 11 starting with 1 → +…; anything else null.
 */
export function staffPhone(typed: string): string | null {
  const d = typed.replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

// ---------------------------------------------------------------- changes (owners only, /admin)

export interface PersonInput { givenName: string; familyName: string; role: 'owner' | 'crew'; phone: string; email: string }

export const STAFF_MESSAGES = {
  givenName: 'Add their first name.',
  nameLong: `Keep names to ${MAX_NAME} letters or fewer.`,
  role: 'Pick Owner or Crew.',
  phone: 'Check the phone number: 10 digits, like 256-555-0123.',
  email: 'That email doesn’t look right. Check for typos.',
  same: 'Someone with that name already works here. Add a last name to tell them apart.',
  lastOwner: 'Keep at least one owner working here.',
  notFound: 'We couldn’t find that person. Refresh and try again.',
  stale: 'Someone else just changed this person. Here’s the latest.',
  busy: 'Someone else is saving at the same moment. Try again.',
  already: 'There’s already a staff list, so it can’t be started fresh.',
  tooSoon: 'Give it a few more minutes and try again first. The staff list usually comes back by itself.',
} as const

export class StaffInputError extends StaffingError {
  constructor(message: string, public field: string | null = null) {
    super(400, message)
    this.name = 'StaffInputError'
  }
}

/** Checks and tidies what an owner typed. Throws StaffInputError with the first problem. */
export function cleanPerson(raw: unknown): PersonInput {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')
  const givenName = s(o.givenName), familyName = s(o.familyName), phone = s(o.phone), email = s(o.email)
  if (!givenName) throw new StaffInputError(STAFF_MESSAGES.givenName, 'givenName')
  if (givenName.length > MAX_NAME) throw new StaffInputError(STAFF_MESSAGES.nameLong, 'givenName')
  if (familyName.length > MAX_NAME) throw new StaffInputError(STAFF_MESSAGES.nameLong, 'familyName')
  if (o.role !== 'owner' && o.role !== 'crew') throw new StaffInputError(STAFF_MESSAGES.role, 'role')
  if (phone && (!isPhone(phone) || !staffPhone(phone))) throw new StaffInputError(STAFF_MESSAGES.phone, 'phone')
  if (email && (!isEmail(email) || email.length > MAX_EMAIL)) throw new StaffInputError(STAFF_MESSAGES.email, 'email')
  return { givenName, familyName, role: o.role, phone: phone ? staffPhone(phone)! : '', email: email.toLowerCase() }
}

const fullName = (r: { givenName: string; familyName: string }) => `${r.givenName} ${r.familyName}`.trim().toLowerCase()
const pushHistory = (r: StaffRecord, at: string, by: By, change: string): StaffRecord =>
  ({ ...r, updatedAt: at, history: [{ at, by, change }, ...r.history].slice(0, PERSON_HISTORY_CAP) })

function newId(people: StaffRecord[]): string {
  for (;;) {
    const id = `stf_${randomBytes(9).toString('base64url')}`
    if (!people.some((p) => p.id === id) && !FALLBACK_IDS.has(id)) return id
  }
}

/** Compare-and-set on the list, 3 tries. `fn` returns the new list (or throws a refusal). */
async function change<T>(fn: (doc: StaffDoc, now: string) => { doc: StaffDoc; result: T; unchanged?: boolean }): Promise<T> {
  if (classWritesRefusal()) throw new TestSiteStoreError()
  // Make sure the list exists (the first import) before changing it.
  await loadDoc()
  for (let attempt = 0; attempt < 3; attempt++) {
    const { doc, etag, exists } = await readSaved()
    if (!doc) throw new StaffListUnavailable(IMPORT_FAILED)
    const now = new Date().toISOString()
    const next = fn(doc, now)
    if (next.unchanged) return next.result
    const saved: StaffDoc = { ...next.doc, updatedAt: now }
    if (await kv.setIfMatch(KEY, JSON.stringify(saved), etag, exists)) {
      cache = { at: Date.now(), doc: saved, saved: true }
      lastKnown = saved
      return next.result
    }
  }
  throw new StaffingError(409, STAFF_MESSAGES.busy)
}

const activeOwners = (people: StaffRecord[]) => people.filter((p) => p.active && p.role === 'owner')

/** Add someone. Their id is new (`stf_…`). */
export async function addPerson(raw: unknown, by: By): Promise<StaffRecord> {
  const input = cleanPerson(raw)
  return change((doc, now) => {
    if (doc.people.some((p) => p.active && fullName(p) === fullName(input))) throw new StaffInputError(STAFF_MESSAGES.same, 'familyName')
    const rec: StaffRecord = {
      id: newId(doc.people), givenName: input.givenName, familyName: input.familyName, role: input.role,
      email: input.email || null, phone: input.phone || null, active: true, leftAt: null, from: 'added',
      createdAt: now, updatedAt: now, history: [{ at: now, by, change: `${by.name} added them` }],
    }
    return { doc: { ...doc, people: [...doc.people, rec] }, result: rec }
  })
}

/** Change someone's name, role, phone or email. `expectedUpdatedAt` = what the screen showed; a later change → 409 with the latest. */
export async function editPerson(id: string, raw: unknown, by: By, expectedUpdatedAt?: string | null): Promise<StaffRecord> {
  const input = cleanPerson(raw)
  return change((doc, now) => {
    const at = doc.people.findIndex((p) => p.id === id)
    if (at < 0) throw new StaffingError(404, STAFF_MESSAGES.notFound)
    const was = doc.people[at]
    if (typeof expectedUpdatedAt === 'string' && expectedUpdatedAt !== was.updatedAt) throw new StaleStaffError(was)
    if (doc.people.some((p) => p.id !== id && p.active && fullName(p) === fullName(input))) throw new StaffInputError(STAFF_MESSAGES.same, 'familyName')
    if (was.active && was.role === 'owner' && input.role !== 'owner' && activeOwners(doc.people).length <= 1) throw new StaffInputError(STAFF_MESSAGES.lastOwner, 'role')
    const what = [
      fullName(was) !== fullName(input) ? 'name' : null,
      was.role !== input.role ? (input.role === 'owner' ? 'made an owner' : 'made crew') : null,
      (was.phone ?? '') !== input.phone ? 'phone' : null,
      (was.email ?? '') !== input.email ? 'email' : null,
    ].filter(Boolean)
    if (what.length === 0) return { doc, result: was, unchanged: true }
    // Made crew: no longer linked to an /admin owner (S4), so "You're on" never follows the wrong person.
    const owner = input.role === 'crew' ? null : was.owner
    const next = pushHistory({ ...was, givenName: input.givenName, familyName: input.familyName, role: input.role, owner, phone: input.phone || null, email: input.email || null }, now, by, `${by.name} changed ${what.join(', ')}`)
    const people = doc.people.slice()
    people[at] = next
    return { doc: { ...doc, people }, result: next }
  })
}

/** "No longer working here" (active false) or "Working here again" (active true). Records stay; nothing is deleted. */
export async function setWorking(id: string, active: boolean, by: By): Promise<{ person: StaffRecord; changed: boolean }> {
  return change<{ person: StaffRecord; changed: boolean }>((doc, now) => {
    const at = doc.people.findIndex((p) => p.id === id)
    if (at < 0) throw new StaffingError(404, STAFF_MESSAGES.notFound)
    const was = doc.people[at]
    if (was.active === active) return { doc, result: { person: was, changed: false }, unchanged: true }
    if (active && doc.people.some((p) => p.id !== id && p.active && fullName(p) === fullName(was))) throw new StaffInputError(STAFF_MESSAGES.same, null)
    if (!active && was.role === 'owner' && activeOwners(doc.people).length <= 1) throw new StaffInputError(STAFF_MESSAGES.lastOwner, null)
    const next = pushHistory({ ...was, active, leftAt: active ? null : now }, now, by, active ? `${by.name} marked them as working here again` : `${by.name} marked them as no longer working here`)
    const people = doc.people.slice()
    people[at] = next
    return { doc: { ...doc, people }, result: { person: next, changed: true } }
  })
}

/**
 * Only when there is no list and the Square team can't be brought in: start
 * the list with the two owners (new ids). Refused when a list exists.
 */
export async function startFresh(by: By): Promise<StaffDoc> {
  if (classWritesRefusal()) throw new TestSiteStoreError()
  const first = await readSaved()
  if (first.doc) throw new StaffingError(409, STAFF_MESSAGES.already)
  if (!(await canStartFresh())) throw new StaffingError(409, STAFF_MESSAGES.tooSoon)
  const now = new Date().toISOString()
  const people: StaffRecord[] = []
  for (const owner of OWNERS) {
    people.push({
      id: newId(people), givenName: owner, familyName: '', role: 'owner', owner, email: null, phone: null, active: true, leftAt: null,
      from: 'added', createdAt: now, updatedAt: now, history: [{ at: now, by, change: `${by.name} started the list` }],
    })
  }
  const doc: StaffDoc = { v: 1, startedFrom: 'fresh', startedAt: now, updatedAt: now, people }
  if (!(await kv.setIfMatch(KEY, JSON.stringify(doc), first.etag, first.exists))) throw new StaffingError(409, STAFF_MESSAGES.already)
  cache = { at: Date.now(), doc, saved: true }
  lastKnown = doc
  importFailedAt = 0
  return doc
}

/** Someone else changed the person first: 409 with what's saved now. */
export class StaleStaffError extends StaffingError {
  constructor(public current: StaffRecord) {
    super(409, STAFF_MESSAGES.stale)
    this.name = 'StaleStaffError'
  }
}

/**
 * Sandbox seed (stage 3 E2E): makes sure someone named `givenName familyName`
 * works here as crew; adds them once. Returns their id and whether they were added.
 */
export async function ensureCrewPerson(givenName: string, familyName: string, by: By): Promise<{ id: string; created: boolean }> {
  const { people } = await staffListForOwners()
  const want = `${givenName} ${familyName}`.trim().toLowerCase()
  const there = people.find((p) => `${p.givenName} ${p.familyName}`.trim().toLowerCase() === want)
  if (there?.active) return { id: there.id, created: false }
  if (there) {
    await setWorking(there.id, true, by)
    return { id: there.id, created: false }
  }
  const rec = await addPerson({ givenName, familyName, role: 'crew', phone: '', email: '' }, by)
  return { id: rec.id, created: true }
}
