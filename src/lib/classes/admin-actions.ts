/**
 * What the /admin class screens do, kept here so the routes stay thin:
 * the class library, scheduling (create, duplicate, update, cancel), the
 * bookings on a class, and blocked time. Every action is audited.
 *
 * Rules that protect people already booked:
 *  - capacity never goes below the seats taken on a session;
 *  - a session, pass or price cell with booked seats can't be removed;
 *  - prices can change, but only new bookings pay the new price (the ledger
 *    keeps what was paid);
 *  - moving a booked session needs `confirmMove` and returns who to tell.
 * Cancelling never refunds and never frees a seat; owners do that by hand.
 */
import { createHash } from 'node:crypto'
import { recordAudit } from '@lib/audit'
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import { formatDay, formatTime } from '@lib/studio-time'
import { addBlocked, listBlocked, removeBlocked, type BlockedTime } from './blocked-time'
import { ClassExistsError, createClass, getClass, listClasses, StaleClassError, updateClass } from './class-store'
import { archiveLibrary, getLibrary, LibraryStaleError, listLibrary, restoreLibraryVersion, saveLibraryVersion } from './library-store'
import { takenCents } from './booking-words'
import { archiveClassInSquare, CLASS_TAX_NOT_SET, syncClassToSquare } from './square-catalog'
import { contentChanges } from './content-diff'
import { bookingCap, describeRequest, remainingOn, sessionShare } from './refunds'
import { isWaiting, listRefundRequests } from './refund-requests'
import { getLedger, seatsTaken, type Ledger, type LedgerLine } from './seat-ledger'
import { busyBetween, clashes, clashMessage, type Busy } from './studio-schedule'
import type { ClassContent, ClassStatus, LibraryClass, ScheduledClass, Session } from './types'
import { newId, toIso, validateContent, validateSessions } from './validate'

/**
 * The owner when the request doesn't say which one (see adminActor in
 * @lib/admin-auth, which reads the X-Admin-Who header). Every action takes the
 * actor as its last argument and falls back to this.
 */
export const ADMIN_BY: By = { id: 'admin', name: 'Owner' }

export const SYNC_WARNING = "Saved. The POS item didn't update. Try Save again."
export const TAX_WARNING = "Saved, but it isn't on the POS: Class tax isn't set up yet. It can't be sold until it is."
export const LIBRARY_WARNING = "Saved. The library didn't update. Try again."
export const NEW_LIBRARY_WARNING = "Added. It'll go into the library the next time you open or save it."
export const CANCEL_WARNING = "Cancelled. The POS item didn't come off. Try Cancel again."

/** A refusal the owner reads: an HTTP status, a plain sentence, and anything extra for the screen. */
export class ActionError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message)
  }
}

export interface PersonToTell { name: string; email: string; phone: string; sessions: string[] }
export interface BookedPerson { bookingId: string; name: string; email: string; phone: string; seats: number; paidCents: number }
export interface Saved<T> { data: T; warning?: string }

const STATUSES: ClassStatus[] = ['draft', 'open', 'closed']

function audit(by: By, action: string, target: { kind: string; id: string; label?: string }, details?: Record<string, string | number | boolean | null>) {
  return recordAudit({ by: { ...by, role: 'owner' }, action, target, ...(details ? { details } : {}) })
}

/** "Sun Oct 18 4 PM", studio time. */
function when(iso: string): string {
  return `${formatDay(iso).replace(',', '')} ${formatTime(iso).replace(':00 ', ' ')}`
}

const fullName = (l: LedgerLine) => (l.customer ? `${l.customer.givenName} ${l.customer.familyName}`.trim() : '')

/** A seat a person holds: paid, or refunded but kept. */
function isBooked(l: LedgerLine): boolean {
  if (l.state === 'confirmed') return true
  return l.state === 'refunded' && !l.refunds.some((r) => r.freedSeat)
}

/** A seat someone has or is paying for right now: booked, or an unexpired hold. */
function holdsSeat(l: LedgerLine, now: Date): boolean {
  if (isBooked(l)) return true
  return l.state === 'held' && !!l.holdExpiresAt && Date.parse(l.holdExpiresAt) > now.getTime()
}

const paidOn = (l: LedgerLine) => l.priceCents + l.taxCents + l.addOnCents + l.addOnTaxCents

/**
 * A counter (POS) sale can pay several bookings at once (one family's walk-in
 * seats and another's pay-at-the-counter seats): every line carries the whole
 * sale's chargedCents. So counter lines count their own price and tax, never
 * the sale total, or one sale is counted once per booking (N6).
 */
const fromCounter = (l: LedgerLine) => l.source === 'pos' || l.source === 'door-counter'
const chargedFor = (l: LedgerLine) => (fromCounter(l) ? undefined : l.square.chargedCents)
function paidOf(lines: LedgerLine[]): number {
  const charged = lines.map(chargedFor).find((c) => typeof c === 'number')
  return charged ?? lines.reduce((s, l) => s + paidOn(l), 0)
}

function okContent(raw: unknown): ClassContent {
  const r = validateContent(raw)
  if (!r.ok) throw new ActionError(400, r.error, r.field ? { field: r.field } : {})
  return r.value
}

/** Sessions from the form: new ones get an id. */
function okSessions(raw: unknown): Session[] {
  const list = Array.isArray(raw) ? raw.map((s: any) => (s && typeof s === 'object' && !s.id ? { ...s, id: newId('ses') } : s)) : raw
  const r = validateSessions(list)
  if (!r.ok) throw new ActionError(400, r.error, r.field ? { field: r.field } : {})
  return r.value
}

export const PAST_DATE = 'Pick a date from today on.'
/** A new or moved date that starts in the past is refused (R37): a class is never added or moved into the past. */
function noPastStarts(sessions: Session[], old: Session[] = [], now = Date.now()): void {
  for (const s of sessions) {
    const was = old.find((o) => o.id === s.id)
    if (was && was.startIso === s.startIso && was.endIso === s.endIso) continue
    if (Date.parse(s.startIso) < now) throw new ActionError(400, PAST_DATE, { field: 'sessions' })
  }
}

function okStatus(raw: unknown, fallback: ClassStatus): ClassStatus {
  if (raw === undefined) return fallback
  if (raw === 'cancelled') throw new ActionError(400, 'Use Cancel to cancel a class.')
  if (!STATUSES.includes(raw as ClassStatus)) throw new ActionError(400, 'That status is not one we know.')
  return raw as ClassStatus
}

/** Library store errors that mean "not found". */
function libraryError(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg === 'That class is not in the library.' || msg === 'That version does not exist.') throw new ActionError(404, msg)
  throw e
}

async function mustGetClass(id: unknown): Promise<ScheduledClass> {
  const cls = typeof id === 'string' && id ? await getClass(id) : null
  if (!cls) throw new ActionError(404, 'That class does not exist.')
  return cls
}

/** The `updatedAt` of the copy the form loaded; a save from an older copy is refused. */
function expectedOf(body: { expectedUpdatedAt?: unknown }, cls: ScheduledClass): string {
  const v = body.expectedUpdatedAt
  if (typeof v !== 'string' || !v) throw new ActionError(400, 'Reload the class and try again.')
  if (v !== cls.updatedAt) throw new StaleClassError()
  return v
}

/** Refuses with the clash message when any session would clash with what holds the room. */
async function checkClashes(sessions: Session[], canShareRoom: boolean, ignoreId?: string): Promise<void> {
  const from = sessions.reduce((m, s) => (s.startIso < m ? s.startIso : m), sessions[0].startIso)
  const to = sessions.reduce((m, s) => (s.endIso > m ? s.endIso : m), sessions[0].endIso)
  let busy
  try {
    busy = await busyBetween(from, to)
  } catch {
    throw new ActionError(503, "The schedule couldn't be checked. Try again.")
  }
  const found = sessions.flatMap((s) =>
    clashes({ startIso: s.startIso, endIso: s.endIso, kind: 'class', canShareRoom, ignoreIds: ignoreId ? [ignoreId] : [] }, busy),
  )
  const unique = found.filter((b, i) => found.findIndex((x) => x.id === b.id && x.startIso === b.startIso) === i)
  if (unique.length) throw new ActionError(409, clashMessage(unique))
}

/** Put the class on the POS (open/closed) or keep a draft off it. A Square failure is a warning, never a lost save. */
async function syncPos(cls: ScheduledClass, by: By): Promise<{ cls: ScheduledClass; warning?: string }> {
  try {
    if (cls.status === 'draft') {
      if (cls.square.itemId) await archiveClassInSquare(cls)
      return { cls }
    }
    const square = await syncClassToSquare(cls)
    return { cls: await updateClass(cls.id, { square }, by, 'POS item updated') }
  } catch (e) {
    console.warn(`[classes] POS sync for ${cls.id} failed: ${e instanceof Error ? e.message : e}`)
    return { cls, warning: e instanceof Error && e.message === CLASS_TAX_NOT_SET ? TAX_WARNING : SYNC_WARNING }
  }
}

// ── Library ────────────────────────────────────────────────────────────────

export async function libraryList(includeArchived = false): Promise<LibraryClass[]> {
  return listLibrary({ includeArchived })
}

export async function librarySave(body: { id?: unknown; content?: unknown; note?: unknown; expectedVersion?: unknown }, by: By = ADMIN_BY): Promise<LibraryClass> {
  const content = okContent(body.content)
  const id = typeof body.id === 'string' && body.id ? body.id : undefined
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : ''
  const expectedVersion = body.expectedVersion === undefined ? undefined : Number(body.expectedVersion)
  const lib = await saveLibraryVersion({ id, content, by, note, ...(Number.isInteger(expectedVersion) ? { expectedVersion } : {}) }).catch((e) => {
    if (e instanceof LibraryStaleError) throw new ActionError(409, e.message, { stale: true })
    return libraryError(e)
  })
  await audit(by, 'class-library-save', { kind: 'class-library', id: lib.id, label: content.name }, { version: lib.versions.length })
  return lib
}

export async function libraryRestore(body: { id?: unknown; version?: unknown }, by: By = ADMIN_BY): Promise<LibraryClass> {
  const version = Number(body.version)
  if (typeof body.id !== 'string' || !Number.isInteger(version)) throw new ActionError(400, 'Pick a version to restore.')
  const lib = await restoreLibraryVersion(body.id, version, by).catch(libraryError)
  await audit(by, 'class-library-restore', { kind: 'class-library', id: lib.id }, { version })
  return lib
}

export async function libraryArchive(body: { id?: unknown; archived?: unknown }, by: By = ADMIN_BY): Promise<LibraryClass> {
  if (typeof body.id !== 'string') throw new ActionError(404, 'That class is not in the library.')
  const archived = body.archived !== false
  const lib = await archiveLibrary(body.id, archived, by).catch(libraryError)
  await audit(by, archived ? 'class-library-archive' : 'class-library-unarchive', { kind: 'class-library', id: lib.id })
  return lib
}

// ── Scheduling ─────────────────────────────────────────────────────────────

/** One class's bookings in a line: how many bookings, seats held, and money taken less refunds. */
export interface ClassTotals { bookings: number; seats: number; cents: number }

export async function classesBetween(fromIso?: string, toIso?: string): Promise<{ classes: ScheduledClass[]; seatsTaken: Record<string, number>; totals: Record<string, ClassTotals> }> {
  const list = await listClasses(fromIso && toIso ? { fromIso, toIso } : undefined)
  const now = new Date()
  const taken: Record<string, number> = {}
  const totals: Record<string, ClassTotals> = {}
  await Promise.all(list.map(async (c) => {
    const ledger = await getLedger(c.id)
    for (const s of c.sessions) taken[s.id] = seatsTaken(ledger, s.id, now)
    const views = groupBookings(ledger, now).filter((b) => b.state !== 'held')
    totals[c.id] = {
      bookings: views.length,
      seats: ledger.lines.filter(isBooked).length,
      // Money in: comps and counter seats not rung up yet bring in nothing (I3).
      cents: views.reduce((sum, b) => sum + takenCents(b), 0),
    }
  }))
  return { classes: list, seatsTaken: taken, totals }
}

/**
 * For each library class, when it last ran (or first runs) and the times of
 * its latest class, so the library can say "Last ran Oct 23" and "6–8 PM
 * usually", and Schedule it can start at the usual time.
 */
export interface LibraryRun { lastIso: string | null; nextIso: string | null; startIso: string; endIso: string }
export async function libraryRuns(now = new Date()): Promise<Record<string, LibraryRun>> {
  const out: Record<string, LibraryRun> = {}
  const timeFrom = new Map<string, 'draft' | 'real'>()
  for (const c of await listClasses()) {
    if (!c.libraryId || c.status === 'cancelled' || !c.sessions.length) continue
    const first = c.sessions[0]
    const draft = c.status === 'draft'
    const r = out[c.libraryId] ?? { lastIso: null, nextIso: null, startIso: first.startIso, endIso: first.endIso }
    // The usual time: the latest class that ran or is on the website; a draft only when there's nothing else.
    const seen = timeFrom.get(c.libraryId)
    const kind = draft ? 'draft' : 'real'
    if (!seen || (seen === 'draft' && kind === 'real') || (seen === kind && first.startIso > r.startIso)) {
      r.startIso = first.startIso
      r.endIso = first.endIso
      timeFrom.set(c.libraryId, kind)
    }
    // A draft never ran and isn't coming up for anyone: it doesn't count for "Last ran" or "First runs".
    if (!draft) {
      for (const s of c.sessions) {
        if (Date.parse(s.startIso) <= now.getTime()) { if (!r.lastIso || s.startIso > r.lastIso) r.lastIso = s.startIso }
        else if (!r.nextIso || s.startIso < r.nextIso) r.nextIso = s.startIso
      }
    }
    out[c.libraryId] = r
  }
  return out
}

/** The first date's length and seats, as the library's usual ones (kept within what the library allows). */
function usualFrom(content: ClassContent, sessions: Session[]): ClassContent {
  const first = sessions[0]
  if (!first) return content
  const minutes = Math.round((Date.parse(first.endIso) - Date.parse(first.startIso)) / 60_000)
  return {
    ...content,
    defaultMinutes: Math.min(1440, Math.max(5, minutes)),
    defaultCapacity: Math.min(999, Math.max(1, first.capacity)),
  }
}

// ── Create keys (R35) and linking to the library (R36) ──────────────────────

const createKeys = makeKvStore('class-create-keys', 'class-create-keys')
const CREATE_KEY_RE = /^[A-Za-z0-9_-]{8,80}$/
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
interface Reserved { classId: string; libraryId: string }

/**
 * The ids one New class sheet's Add will use, stored (compare-and-set) before
 * anything is written: a retry with the same key gets the same ids, so it
 * finds the class (and library entry) the first try made instead of making
 * a second one.
 */
async function reserveCreate(createKey: unknown): Promise<Reserved | null> {
  if (createKey === undefined || createKey === null) return null
  if (typeof createKey !== 'string' || !CREATE_KEY_RE.test(createKey)) throw new ActionError(400, 'Reload the page and try again.')
  const k = `ck-${digest(createKey).slice(0, 40)}`
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await createKeys.getWithMeta(k)
    if (value) return JSON.parse(value) as Reserved
    const fresh: Reserved = { classId: newId('cls'), libraryId: newId('lib') }
    if (await createKeys.setIfMatch(k, JSON.stringify({ ...fresh, at: new Date().toISOString() }), etag, false)) return fresh
  }
  throw new Error('Concurrent update — please retry')
}

/**
 * Put a class that isn't in the library there (R36): version 1 from its own
 * details (usual length and seats from its first date), and link it. The
 * library id comes from the class id, so two at once make one entry.
 */
async function linkToLibrary(cls: ScheduledClass, by: By): Promise<{ cls: ScheduledClass; added: boolean }> {
  if (cls.libraryId) return { cls, added: false }
  const content = usualFrom(cls.content, cls.sessions)
  const date = cls.sessions[0] ? formatDay(cls.sessions[0].startIso).replace(',', '') : ''
  const lib = await saveLibraryVersion({ createId: `lib_${digest(cls.id).slice(0, 12)}`, content, by, note: date ? `Added with the class on ${date}` : 'Added with the class' })
  const version = lib.versions[lib.versions.length - 1].version
  // Another sheet may have linked it a moment ago: then leave the class alone (no new updatedAt to trip a save, N5).
  const now = await getClass(cls.id)
  if (now?.libraryId) return { cls: now, added: false }
  const linked = await updateClass(cls.id, { libraryId: lib.id, libraryVersion: version }, by, `Added to the library (version ${version})`)
  await audit(by, 'class-library-save', { kind: 'class-library', id: lib.id, label: content.name }, { version, auto: true, fromClass: cls.id })
  return { cls: linked, added: true }
}

/** A create that already happened (same create key): finish what it may not have (library link, POS item) and answer with it. */
async function finishCreate(cls: ScheduledClass, by: By): Promise<Saved<{ class: ScheduledClass; replay: true }>> {
  let cur = cls
  let warning: string | undefined
  try {
    cur = (await linkToLibrary(cur, by)).cls
  } catch (e) {
    console.warn(`[classes] linking ${cls.id} to the library failed: ${e instanceof Error ? e.message : e}`)
    warning = NEW_LIBRARY_WARNING
  }
  if (cur.status !== 'draft' && cur.status !== 'cancelled' && !cur.square.itemId) {
    const synced = await syncPos(cur, by)
    cur = synced.cls
    warning = [warning, synced.warning].filter(Boolean).join(' ') || undefined
  }
  return { data: { class: cur, replay: true }, ...(warning ? { warning } : {}) }
}

/** Link an unlinked class to the library, quietly (the class sheet asks when it opens one, R36). */
export async function linkClassToLibrary(body: { id?: unknown }, by: By = ADMIN_BY): Promise<Saved<{ class: ScheduledClass; libraryAdded: boolean }>> {
  const cls = await mustGetClass(body.id)
  const { cls: linked, added } = await linkToLibrary(cls, by)
  return { data: { class: linked, libraryAdded: added } }
}

/**
 * Schedule a class. Every class lands in the library (R21) in this same
 * request: from scratch (no `libraryId`) a new library entry is made at
 * version 1 and the class points at it; from the library, the class points
 * at its latest version, and when the owner chose "This class and the
 * library" (`alsoUpdateLibrary`) and the details differ, a new version is
 * saved first. A library failure never loses the class: it is added and the
 * reply warns.
 */
export async function scheduleClass(body: { libraryId?: unknown; content?: unknown; sessions?: unknown; status?: unknown; alsoUpdateLibrary?: unknown; createKey?: unknown }, by: By = ADMIN_BY): Promise<Saved<{ class: ScheduledClass; replay?: true }>> {
  // R35: the same Add sent again (a lost reply, a retry) finds what the first one made.
  const reserved = await reserveCreate(body.createKey)
  if (reserved) {
    const made = await getClass(reserved.classId)
    if (made) return finishCreate(made, by)
  }
  let libraryId: string | undefined
  let libraryVersion: number | undefined
  let latest: LibraryClass['versions'][number] | undefined
  let raw = body.content
  if (typeof body.libraryId === 'string' && body.libraryId) {
    const lib = await getLibrary(body.libraryId)
    latest = lib?.versions[lib.versions.length - 1]
    if (!lib || !latest) throw new ActionError(404, 'That class is not in the library.')
    libraryId = lib.id
    libraryVersion = latest.version
    if (raw === undefined) raw = latest.content
  }
  const sessions = okSessions(body.sessions)
  noPastStarts(sessions)
  let content = okContent(raw)
  const status = okStatus(body.status, 'draft')
  try {
    await checkClashes(sessions, content.rules.canShareRoom)
  } catch (e) {
    // The same Add sent twice at once: the other one made it first, so this "clash" is with itself.
    const made = reserved ? await getClass(reserved.classId) : null
    if (made) return finishCreate(made, by)
    throw e
  }

  let warning: string | undefined
  const date = formatDay(sessions[0].startIso).replace(',', '')
  if (!libraryId) {
    content = usualFrom(content, sessions)
    try {
      const lib = await saveLibraryVersion({ ...(reserved ? { createId: reserved.libraryId } : {}), content, by, note: `Added with the class on ${date}` })
      libraryId = lib.id
      libraryVersion = lib.versions[lib.versions.length - 1].version
      await audit(by, 'class-library-save', { kind: 'class-library', id: lib.id, label: content.name }, { version: libraryVersion, auto: true })
    } catch (e) {
      console.warn(`[classes] adding ${content.name} to the library failed: ${e instanceof Error ? e.message : e}`)
      warning = NEW_LIBRARY_WARNING
    }
  } else if (body.alsoUpdateLibrary === true && latest && contentChanges(latest.content, content, { usual: false }).length) {
    try {
      const lib = await saveLibraryVersion({ id: libraryId, content: { ...content, defaultMinutes: latest.content.defaultMinutes, defaultCapacity: latest.content.defaultCapacity }, by, note: `Updated while scheduling ${date}` })
      libraryVersion = lib.versions[lib.versions.length - 1].version
      await audit(by, 'class-library-save', { kind: 'class-library', id: lib.id, label: content.name }, { version: libraryVersion })
    } catch (e) {
      console.warn(`[classes] library update for ${libraryId} failed: ${e instanceof Error ? e.message : e}`)
      warning = "Added. The library didn't update. Save the class's details again to update it."
    }
  }

  let created: ScheduledClass
  try {
    created = await createClass({ ...(reserved ? { id: reserved.classId } : {}), content, sessions, ...(libraryId ? { libraryId } : {}), ...(libraryVersion !== undefined ? { libraryVersion } : {}), status, by })
  } catch (e) {
    if (e instanceof ClassExistsError) return finishCreate((await getClass(e.id))!, by)
    throw e
  }
  const { cls, warning: posWarning } = await syncPos(created, by)
  await audit(by, 'class-create', { kind: 'class', id: cls.id, label: content.name }, { status, sessions: sessions.length, libraryId: libraryId ?? null })
  const said = [warning, posWarning].filter(Boolean).join(' ') || undefined
  return { data: { class: cls }, ...(said ? { warning: said } : {}) }
}

/** Same content on new sessions; no bookings come along. */
export async function duplicateClass(body: { id?: unknown; sessions?: unknown; status?: unknown; createKey?: unknown }, by: By = ADMIN_BY): Promise<Saved<{ class: ScheduledClass; replay?: true }>> {
  const reserved = await reserveCreate(body.createKey)
  if (reserved) {
    const made = await getClass(reserved.classId)
    if (made) return finishCreate(made, by)
  }
  const src = await mustGetClass(body.id)
  const sessions = okSessions(
    Array.isArray(body.sessions) ? body.sessions.map((s: any) => (s && typeof s === 'object' ? { ...s, id: newId('ses') } : s)) : body.sessions,
  )
  noPastStarts(sessions)
  const status = okStatus(body.status, src.status === 'cancelled' ? 'draft' : src.status)
  const content = structuredClone(src.content)
  await checkClashes(sessions, content.rules.canShareRoom)
  let created: ScheduledClass
  try {
    created = await createClass({
      ...(reserved ? { id: reserved.classId } : {}),
      content, sessions, status, by,
      ...(src.libraryId ? { libraryId: src.libraryId } : {}),
      ...(src.libraryVersion !== null ? { libraryVersion: src.libraryVersion } : {}),
    })
  } catch (e) {
    if (e instanceof ClassExistsError) return finishCreate((await getClass(e.id))!, by)
    throw e
  }
  const { cls, warning } = await syncPos(created, by)
  await audit(by, 'class-duplicate', { kind: 'class', id: cls.id, label: content.name }, { from: src.id, sessions: sessions.length })
  return { data: { class: cls }, ...(warning ? { warning } : {}) }
}

/** People booked on any of `sessionIds`, one entry per booking, with the old times of their moved sessions. */
function peopleOn(ledger: Ledger, sessions: Session[], now: Date): PersonToTell[] {
  const out = new Map<string, PersonToTell>()
  for (const l of ledger.lines) {
    if (!holdsSeat(l, now)) continue
    const mine = sessions.filter((s) => l.sessionIds.includes(s.id))
    if (!mine.length) continue
    const p = out.get(l.bookingId) ?? {
      name: fullName(l), email: l.customer?.email ?? '', phone: l.customer?.phone ?? '', sessions: [],
    }
    for (const s of mine) if (!p.sessions.includes(when(s.startIso))) p.sessions.push(when(s.startIso))
    out.set(l.bookingId, p)
  }
  return [...out.values()]
}

/** Refuses edits that would change what booked people have. Returns the moved sessions that have bookings. */
function checkAgainstBookings(cls: ScheduledClass, ledger: Ledger, content: ClassContent, sessions: Session[], now: Date): Session[] {
  const booked = ledger.lines.filter((l) => holdsSeat(l, now))
  const movedWithBookings: Session[] = []
  for (const old of cls.sessions) {
    const next = sessions.find((s) => s.id === old.id)
    const has = booked.some((l) => l.sessionIds.includes(old.id))
    if (!next) {
      if (has) throw new ActionError(409, `People are booked on ${when(old.startIso)}, so it can't be removed.`)
      continue
    }
    const taken = seatsTaken(ledger, old.id, now)
    if (next.capacity < taken) {
      throw new ActionError(409, `${when(old.startIso)} has ${taken} seats taken. Capacity can't go below ${taken}.`)
    }
    if (has && (next.startIso !== old.startIso || next.endIso !== old.endIso)) movedWithBookings.push(old)
  }
  for (const pass of cls.content.passes) {
    if (content.passes.some((p) => p.id === pass.id)) continue
    if (booked.some((l) => l.passId === pass.id)) throw new ActionError(409, `People are booked on ${pass.label}, so it can't be removed.`)
  }
  for (const [passId, row] of Object.entries(cls.content.prices)) {
    for (const ticketTypeId of Object.keys(row)) {
      if (content.prices[passId]?.[ticketTypeId] !== undefined) continue
      if (!booked.some((l) => l.passId === passId && l.ticketTypeId === ticketTypeId)) continue
      const pass = cls.content.passes.find((p) => p.id === passId)?.label ?? passId
      const ticket = cls.content.ticketTypes.find((t) => t.id === ticketTypeId)?.label ?? ticketTypeId
      const cell = cls.content.passes.length > 1 ? `${pass} ${ticket}` : ticket
      throw new ActionError(409, `People are booked as ${cell}, so that price can't be removed.`)
    }
  }
  return movedWithBookings
}

/** "This class and the library" when the library already matches: nothing to save. */
class SameAsLibrary extends Error {}

export async function updateScheduledClass(body: {
  id?: unknown; content?: unknown; sessions?: unknown; status?: unknown; alsoUpdateLibrary?: unknown; confirmMove?: unknown; expectedUpdatedAt?: unknown
}, by: By = ADMIN_BY): Promise<Saved<{ class: ScheduledClass; peopleToTell?: PersonToTell[]; libraryAdded?: boolean }>> {
  const cls = await mustGetClass(body.id)
  const expectedUpdatedAt = expectedOf(body, cls)
  if (cls.status === 'cancelled') throw new ActionError(409, 'This class is cancelled. Duplicate it to run it again.')
  const content = body.content !== undefined ? okContent(body.content) : cls.content
  const sessions = body.sessions !== undefined ? okSessions(body.sessions) : cls.sessions
  if (body.sessions !== undefined) noPastStarts(sessions, cls.sessions)
  const status = okStatus(body.status, cls.status)

  const now = new Date()
  const ledger = await getLedger(cls.id)
  const moved = checkAgainstBookings(cls, ledger, content, sessions, now)
  const peopleToTell = moved.length ? peopleOn(ledger, moved, now) : undefined
  if (moved.length && body.confirmMove !== true) {
    throw new ActionError(409, 'People are booked on the sessions you moved. Confirm the move, then let them know.', { peopleToTell })
  }

  if (body.sessions !== undefined || body.content !== undefined) {
    // Sessions that already ended, unchanged, are history: never re-checked (blocked time added later must not stop an edit).
    const same = (s: Session) => cls.sessions.some((o) => o.id === s.id && o.startIso === s.startIso && o.endIso === s.endIso)
    const toCheck = sessions.filter((s) => Date.parse(s.endIso) > now.getTime() || !same(s))
    if (toCheck.length) await checkClashes(toCheck, content.rules.canShareRoom, cls.id)
  }

  const changes: string[] = []
  if (body.content !== undefined) changes.push('details')
  if (body.sessions !== undefined) changes.push('sessions')
  if (status !== cls.status) changes.push(`status ${status}`)
  let saved = await updateClass(
    cls.id,
    {
      ...(body.content !== undefined ? { content } : {}),
      ...(body.sessions !== undefined ? { sessions } : {}),
      status,
    },
    by,
    changes.length ? `Changed ${changes.join(', ')}` : 'Saved',
    { expectedUpdatedAt },
  )

  // The class is saved; from here on a failure is a warning, never a lost save.
  let libraryWarning: string | undefined
  if (body.alsoUpdateLibrary === true) {
    try {
      const date = formatDay(saved.sessions[0].startIso).replace(',', '')
      const current = saved.libraryId ? await getLibrary(saved.libraryId) : null
      const latest = current?.versions[current.versions.length - 1]
      // The library already has these details: nothing to add; just point the class at its latest version.
      if (latest && !contentChanges(latest.content, saved.content, { usual: false }).length) {
        if (saved.libraryVersion !== latest.version) saved = await updateClass(saved.id, { libraryVersion: latest.version }, by, `Library version ${latest.version}`)
        throw new SameAsLibrary()
      }
      const lib = await saveLibraryVersion({
        ...(saved.libraryId ? { id: saved.libraryId } : {}),
        content: saved.content,
        by,
        note: `Updated while scheduling ${date}`,
      })
      const version = lib.versions[lib.versions.length - 1].version
      saved = await updateClass(saved.id, { libraryId: lib.id, libraryVersion: version }, by, `Library updated (version ${version})`)
      await audit(by, 'class-library-save', { kind: 'class-library', id: lib.id, label: saved.content.name }, { version, fromClass: saved.id })
    } catch (e) {
      if (!(e instanceof SameAsLibrary)) {
        console.warn(`[classes] library update from ${saved.id} failed: ${e instanceof Error ? e.message : e}`)
        libraryWarning = LIBRARY_WARNING
      }
    }
  }

  // R36: a class that isn't in the library (made before R21, or when the library couldn't be written) goes there now.
  let libraryAdded = false
  if (!saved.libraryId && !libraryWarning) {
    try {
      const linked = await linkToLibrary(saved, by)
      saved = linked.cls
      libraryAdded = linked.added
    } catch (e) {
      console.warn(`[classes] linking ${saved.id} to the library failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const { cls: synced, warning: posWarning } = await syncPos(saved, by)
  const warning = [libraryWarning, posWarning].filter(Boolean).join(' ') || undefined
  await audit(by, 'class-update', { kind: 'class', id: cls.id, label: synced.content.name }, {
    changes: changes.join(', ') || 'none', moved: moved.length, alsoUpdateLibrary: body.alsoUpdateLibrary === true,
  })
  return { data: { class: synced, ...(peopleToTell ? { peopleToTell } : {}), ...(libraryAdded ? { libraryAdded } : {}) }, ...(warning ? { warning } : {}) }
}

/** Everyone holding a seat, one entry per booking. */
export function bookedPeople(ledger: Ledger): BookedPerson[] {
  const out = new Map<string, BookedPerson & { sum: number; charged?: number }>()
  for (const l of ledger.lines) {
    if (!isBooked(l)) continue
    const p = out.get(l.bookingId) ?? {
      bookingId: l.bookingId, name: fullName(l), email: l.customer?.email ?? '', phone: l.customer?.phone ?? '',
      seats: 0, paidCents: 0, sum: 0, charged: chargedFor(l),
    }
    p.seats += 1
    p.sum += paidOn(l)
    out.set(l.bookingId, p)
  }
  return [...out.values()].map(({ sum, charged, ...p }) => ({ ...p, paidCents: charged ?? sum }))
}

/** Cancel: off the POS, everyone booked listed for the owner to contact. Never refunds, never frees a seat. */
export async function cancelClass(body: { id?: unknown; expectedUpdatedAt?: unknown }, by: By = ADMIN_BY): Promise<Saved<{ class: ScheduledClass; booked: BookedPerson[] }>> {
  const cls = await mustGetClass(body.id)
  const expectedUpdatedAt = expectedOf(body, cls)
  const saved = cls.status === 'cancelled' ? cls : await updateClass(cls.id, { status: 'cancelled' }, by, 'Cancelled', { expectedUpdatedAt })
  let warning: string | undefined
  try {
    await archiveClassInSquare(saved)
  } catch (e) {
    console.warn(`[classes] taking ${cls.id} off the POS failed: ${e instanceof Error ? e.message : e}`)
    warning = CANCEL_WARNING
  }
  const booked = bookedPeople(await getLedger(cls.id))
  await audit(by, 'class-cancel', { kind: 'class', id: cls.id, label: cls.content.name }, { booked: booked.length })
  return { data: { class: saved, booked }, ...(warning ? { warning } : {}) }
}

// ── Bookings on a class ────────────────────────────────────────────────────

export interface BookingView {
  bookingId: string
  customer: LedgerLine['customer']
  source: LedgerLine['source']
  passId: string
  seats: Record<string, number>
  sessionIds: string[]
  picks: { seat: number; ticketTypeId: string; answers: Record<string, string> }[]
  addOns: Record<string, number>
  paidCents: number
  refundedCents: number
  refunds: LedgerLine['refunds']
  state: 'held' | 'confirmed' | 'refunded' | 'part refunded'
  overCapacity: boolean
  lineIds: string[]
  /** What each paid seat can still give back, for the refund panel (the server works it out again). */
  refundable: RefundableSeat[]
  /** false = comp, POS or counter: refunds happen in Square */
  paidHere: boolean
  /** most the booking can still give back: remaining on its seats, capped at what Square charged less refunds */
  refundableCents: number
  at: string
}
export interface RefundableSeat { id: string; seat: number; ticketTypeId: string; sessions: number; remainingCents: number; sessionCents: number; freed: boolean }

/** A class's ledger lines grouped by booking. Released seats and lapsed holds are left out. */
export function groupBookings(ledger: Ledger, now = new Date()): BookingView[] {
  const groups = new Map<string, LedgerLine[]>()
  for (const l of ledger.lines) {
    if (l.state === 'released') continue
    if (l.state === 'held' && (!l.holdExpiresAt || Date.parse(l.holdExpiresAt) <= now.getTime())) continue
    groups.set(l.bookingId, [...(groups.get(l.bookingId) ?? []), l])
  }
  return [...groups.values()].map((lines) => {
    lines.sort((a, b) => a.seat - b.seat)
    const first = lines[0]
    const seats: Record<string, number> = {}
    const addOns: Record<string, number> = {}
    const sessionIds: string[] = []
    for (const l of lines) {
      seats[l.ticketTypeId] = (seats[l.ticketTypeId] ?? 0) + 1
      for (const [id, n] of Object.entries(l.addOns)) addOns[id] = (addOns[id] ?? 0) + n
      for (const s of l.sessionIds) if (!sessionIds.includes(s)) sessionIds.push(s)
    }
    const refunds = lines.flatMap((l) => l.refunds)
    const states = new Set(lines.map((l) => l.state))
    const state: BookingView['state'] = states.has('held')
      ? 'held'
      : states.has('refunded') ? (states.has('confirmed') ? 'part refunded' : 'refunded') : 'confirmed'
    return {
      bookingId: first.bookingId,
      customer: first.customer,
      source: first.source,
      passId: first.passId,
      seats,
      sessionIds,
      picks: lines.map((l) => ({ seat: l.seat, ticketTypeId: l.ticketTypeId, answers: l.answers })),
      addOns,
      paidCents: paidOf(lines),
      refundedCents: refunds.reduce((s, r) => s + r.cents, 0),
      refunds,
      state,
      overCapacity: lines.some((l) => l.overCapacity === true),
      lineIds: lines.map((l) => l.id),
      refundable: lines.filter((l) => l.state === 'confirmed' || l.state === 'refunded').map((l) => ({
        id: l.id, seat: l.seat, ticketTypeId: l.ticketTypeId, sessions: l.sessionIds.length,
        remainingCents: remainingOn(l), sessionCents: l.sessionIds.length > 1 && sessionShare(l) <= remainingOn(l) ? sessionShare(l) : 0,
        freed: l.refunds.some((r) => r.freedSeat),
      })),
      paidHere: !!first.square.paymentId,
      refundableCents: Math.min(
        lines.filter((l) => l.state === 'confirmed' || l.state === 'refunded').reduce((s, l) => s + remainingOn(l), 0),
        bookingCap(lines) ?? Infinity,
      ),
      at: first.at,
    }
  }).sort((a, b) => a.at.localeCompare(b.at))
}

/** A booking on the class sheet: with the refund still waiting on Square, if any (R29), so its row can ask someone to check. */
export type ClassBooking = BookingView & { waiting: ReturnType<typeof describeRequest> | null }

/** The class, its bookings, and seats taken on each date (holds included, as the ledger counts them). */
export async function classBookings(id: unknown): Promise<{ class: ScheduledClass; bookings: ClassBooking[]; seatsTaken: Record<string, number> }> {
  const cls = await mustGetClass(id)
  const ledger = await getLedger(cls.id)
  const now = new Date()
  const bookings = await Promise.all(groupBookings(ledger, now).map(async (b): Promise<ClassBooking> => {
    const waitingReq = b.paidHere ? (await listRefundRequests(cls.id, b.bookingId).catch(() => [])).find(isWaiting) : undefined
    return { ...b, waiting: waitingReq ? describeRequest(waitingReq, ledger, cls) : null }
  }))
  return { class: cls, bookings, seatsTaken: Object.fromEntries(cls.sessions.map((s) => [s.id, seatsTaken(ledger, s.id, now)])) }
}

// ── Blocked time ───────────────────────────────────────────────────────────

export { listBlocked }

/** Class sessions (ours and legacy) and parties a block would sit on: plain overlap. */
async function bookedUnder(startIso: string, endIso: string): Promise<Busy[]> {
  let busy: Busy[]
  try {
    busy = await busyBetween(startIso, endIso)
  } catch {
    throw new ActionError(503, "The schedule couldn't be checked. Try again.")
  }
  const from = Date.parse(startIso), to = Date.parse(endIso)
  return busy.filter((b) =>
    (b.kind === 'class' || b.kind === 'legacy-class' || b.kind === 'party') &&
    Date.parse(b.startIso) < to && Date.parse(b.endIso) > from)
}

/**
 * Block time. Over a class session or a party it is refused with the clash
 * message unless `confirm: true`; confirmed, it saves and the reply lists what
 * it sits on. Nothing booked is changed either way.
 */
export async function blockTime(body: { startIso?: unknown; endIso?: unknown; reason?: unknown; confirm?: unknown }, by: By = ADMIN_BY): Promise<{ blocked: BlockedTime; clashes: Busy[] }> {
  const startIso = toIso(body.startIso), endIso = toIso(body.endIso)
  if (!startIso || !endIso) throw new ActionError(400, 'Blocked time needs a start and an end time.')
  if (Date.parse(endIso) <= Date.parse(startIso)) throw new ActionError(400, 'Blocked time has to end after it starts.')
  const found = await bookedUnder(startIso, endIso)
  if (found.length && body.confirm !== true) throw new ActionError(409, clashMessage(found), { clashes: found })
  try {
    const b = await addBlocked({ startIso, endIso, reason: typeof body.reason === 'string' ? body.reason : '', by })
    await audit(by, 'blocked-time-add', { kind: 'blocked-time', id: b.id, label: b.reason }, { startIso: b.startIso, endIso: b.endIso, over: found.length })
    return { blocked: b, clashes: found }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/^(Blocked time|The reason)/.test(msg)) throw new ActionError(400, msg)
    throw e
  }
}

export async function unblockTime(body: { id?: unknown }, by: By = ADMIN_BY): Promise<void> {
  if (typeof body.id !== 'string' || !body.id) throw new ActionError(400, 'Pick the blocked time to remove.')
  await removeBlocked(body.id, by)
  await audit(by, 'blocked-time-remove', { kind: 'blocked-time', id: body.id })
}

// ── Route replies ──────────────────────────────────────────────────────────

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** `{ data, warning? }` on success; `{ error, ...extra }` with the action's status, or 503 when storage fails. */
export async function reply(fn: () => Promise<Saved<unknown>>): Promise<Response> {
  try {
    const { data, warning } = await fn()
    return json(200, { data, ...(warning ? { warning } : {}) })
  } catch (e) {
    if (e instanceof ActionError) return json(e.status, { error: e.message, ...e.extra })
    if (e instanceof StaleClassError) return json(409, { error: e.message, stale: true })
    const msg = e instanceof Error ? e.message : String(e)
    if (/^Concurrent update/.test(msg)) return json(409, { error: 'Someone else saved at the same moment. Try again.' })
    console.error(`[admin/classes] ${msg}`)
    return json(503, { error: "The class records couldn't be reached. Try again." })
  }
}
