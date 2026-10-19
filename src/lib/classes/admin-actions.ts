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
import { recordAudit } from '@lib/audit'
import type { By } from '@lib/staff-auth'
import { formatDay, formatTime } from '@lib/studio-time'
import { addBlocked, listBlocked, removeBlocked, type BlockedTime } from './blocked-time'
import { createClass, getClass, listClasses, StaleClassError, updateClass } from './class-store'
import { archiveLibrary, getLibrary, listLibrary, restoreLibraryVersion, saveLibraryVersion } from './library-store'
import { archiveClassInSquare, CLASS_TAX_NOT_SET, syncClassToSquare } from './square-catalog'
import { bookingCap, remainingOn, sessionShare } from './refunds'
import { getLedger, seatsTaken, type Ledger, type LedgerLine } from './seat-ledger'
import { busyBetween, clashes, clashMessage, type Busy } from './studio-schedule'
import type { ClassContent, ClassStatus, LibraryClass, ScheduledClass, Session } from './types'
import { newId, toIso, validateContent, validateSessions } from './validate'

/** The admin cookie carries no name, so every owner action is by this. */
export const ADMIN_BY: By = { id: 'admin', name: 'Owner' }

export const SYNC_WARNING = "Saved. The POS item didn't update. Try Save again."
export const TAX_WARNING = "Saved, but it isn't on the POS: Class tax isn't set up yet. It can't be sold until it is."
export const LIBRARY_WARNING = "Saved. The library didn't update. Try again."
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

function audit(action: string, target: { kind: string; id: string; label?: string }, details?: Record<string, string | number | boolean | null>) {
  return recordAudit({ by: { ...ADMIN_BY, role: 'owner' }, action, target, ...(details ? { details } : {}) })
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
async function syncPos(cls: ScheduledClass): Promise<{ cls: ScheduledClass; warning?: string }> {
  try {
    if (cls.status === 'draft') {
      if (cls.square.itemId) await archiveClassInSquare(cls)
      return { cls }
    }
    const square = await syncClassToSquare(cls)
    return { cls: await updateClass(cls.id, { square }, ADMIN_BY, 'POS item updated') }
  } catch (e) {
    console.warn(`[classes] POS sync for ${cls.id} failed: ${e instanceof Error ? e.message : e}`)
    return { cls, warning: e instanceof Error && e.message === CLASS_TAX_NOT_SET ? TAX_WARNING : SYNC_WARNING }
  }
}

// ── Library ────────────────────────────────────────────────────────────────

export async function libraryList(includeArchived = false): Promise<LibraryClass[]> {
  return listLibrary({ includeArchived })
}

export async function librarySave(body: { id?: unknown; content?: unknown; note?: unknown }): Promise<LibraryClass> {
  const content = okContent(body.content)
  const id = typeof body.id === 'string' && body.id ? body.id : undefined
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : ''
  const lib = await saveLibraryVersion({ id, content, by: ADMIN_BY, note }).catch(libraryError)
  await audit('class-library-save', { kind: 'class-library', id: lib.id, label: content.name }, { version: lib.versions.length })
  return lib
}

export async function libraryRestore(body: { id?: unknown; version?: unknown }): Promise<LibraryClass> {
  const version = Number(body.version)
  if (typeof body.id !== 'string' || !Number.isInteger(version)) throw new ActionError(400, 'Pick a version to restore.')
  const lib = await restoreLibraryVersion(body.id, version, ADMIN_BY).catch(libraryError)
  await audit('class-library-restore', { kind: 'class-library', id: lib.id }, { version })
  return lib
}

export async function libraryArchive(body: { id?: unknown; archived?: unknown }): Promise<LibraryClass> {
  if (typeof body.id !== 'string') throw new ActionError(404, 'That class is not in the library.')
  const archived = body.archived !== false
  const lib = await archiveLibrary(body.id, archived, ADMIN_BY).catch(libraryError)
  await audit(archived ? 'class-library-archive' : 'class-library-unarchive', { kind: 'class-library', id: lib.id })
  return lib
}

// ── Scheduling ─────────────────────────────────────────────────────────────

export async function classesBetween(fromIso?: string, toIso?: string): Promise<{ classes: ScheduledClass[]; seatsTaken: Record<string, number> }> {
  const list = await listClasses(fromIso && toIso ? { fromIso, toIso } : undefined)
  const now = new Date()
  const taken: Record<string, number> = {}
  await Promise.all(list.map(async (c) => {
    const ledger = await getLedger(c.id)
    for (const s of c.sessions) taken[s.id] = seatsTaken(ledger, s.id, now)
  }))
  return { classes: list, seatsTaken: taken }
}

/** Schedule a class from the library (its latest version, or an edited copy) or from content alone. */
export async function scheduleClass(body: { libraryId?: unknown; content?: unknown; sessions?: unknown; status?: unknown }): Promise<Saved<{ class: ScheduledClass }>> {
  let libraryId: string | undefined
  let libraryVersion: number | undefined
  let raw = body.content
  if (typeof body.libraryId === 'string' && body.libraryId) {
    const lib = await getLibrary(body.libraryId)
    const latest = lib?.versions[lib.versions.length - 1]
    if (!lib || !latest) throw new ActionError(404, 'That class is not in the library.')
    libraryId = lib.id
    libraryVersion = latest.version
    if (raw === undefined) raw = latest.content
  }
  const content = okContent(raw)
  const sessions = okSessions(body.sessions)
  const status = okStatus(body.status, 'draft')
  await checkClashes(sessions, content.rules.canShareRoom)
  const created = await createClass({ content, sessions, libraryId, libraryVersion, status, by: ADMIN_BY })
  const { cls, warning } = await syncPos(created)
  await audit('class-create', { kind: 'class', id: cls.id, label: content.name }, { status, sessions: sessions.length, libraryId: libraryId ?? null })
  return { data: { class: cls }, ...(warning ? { warning } : {}) }
}

/** Same content on new sessions; no bookings come along. */
export async function duplicateClass(body: { id?: unknown; sessions?: unknown; status?: unknown }): Promise<Saved<{ class: ScheduledClass }>> {
  const src = await mustGetClass(body.id)
  const sessions = okSessions(
    Array.isArray(body.sessions) ? body.sessions.map((s: any) => (s && typeof s === 'object' ? { ...s, id: newId('ses') } : s)) : body.sessions,
  )
  const status = okStatus(body.status, src.status === 'cancelled' ? 'draft' : src.status)
  const content = structuredClone(src.content)
  await checkClashes(sessions, content.rules.canShareRoom)
  const created = await createClass({
    content, sessions, status, by: ADMIN_BY,
    ...(src.libraryId ? { libraryId: src.libraryId } : {}),
    ...(src.libraryVersion !== null ? { libraryVersion: src.libraryVersion } : {}),
  })
  const { cls, warning } = await syncPos(created)
  await audit('class-duplicate', { kind: 'class', id: cls.id, label: content.name }, { from: src.id, sessions: sessions.length })
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

export async function updateScheduledClass(body: {
  id?: unknown; content?: unknown; sessions?: unknown; status?: unknown; alsoUpdateLibrary?: unknown; confirmMove?: unknown; expectedUpdatedAt?: unknown
}): Promise<Saved<{ class: ScheduledClass; peopleToTell?: PersonToTell[] }>> {
  const cls = await mustGetClass(body.id)
  const expectedUpdatedAt = expectedOf(body, cls)
  if (cls.status === 'cancelled') throw new ActionError(409, 'This class is cancelled. Duplicate it to run it again.')
  const content = body.content !== undefined ? okContent(body.content) : cls.content
  const sessions = body.sessions !== undefined ? okSessions(body.sessions) : cls.sessions
  const status = okStatus(body.status, cls.status)

  const now = new Date()
  const ledger = await getLedger(cls.id)
  const moved = checkAgainstBookings(cls, ledger, content, sessions, now)
  const peopleToTell = moved.length ? peopleOn(ledger, moved, now) : undefined
  if (moved.length && body.confirmMove !== true) {
    throw new ActionError(409, 'People are booked on the sessions you moved. Confirm the move, then let them know.', { peopleToTell })
  }

  if (body.sessions !== undefined || body.content !== undefined) {
    await checkClashes(sessions, content.rules.canShareRoom, cls.id)
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
    ADMIN_BY,
    changes.length ? `Changed ${changes.join(', ')}` : 'Saved',
    { expectedUpdatedAt },
  )

  // The class is saved; from here on a failure is a warning, never a lost save.
  let libraryWarning: string | undefined
  if (body.alsoUpdateLibrary === true) {
    try {
      const date = formatDay(saved.sessions[0].startIso).replace(',', '')
      const lib = await saveLibraryVersion({
        ...(saved.libraryId ? { id: saved.libraryId } : {}),
        content: saved.content,
        by: ADMIN_BY,
        note: `Updated while scheduling ${date}`,
      })
      const version = lib.versions[lib.versions.length - 1].version
      saved = await updateClass(saved.id, { libraryId: lib.id, libraryVersion: version }, ADMIN_BY, `Library updated (version ${version})`)
      await audit('class-library-save', { kind: 'class-library', id: lib.id, label: saved.content.name }, { version, fromClass: saved.id })
    } catch (e) {
      console.warn(`[classes] library update from ${saved.id} failed: ${e instanceof Error ? e.message : e}`)
      libraryWarning = LIBRARY_WARNING
    }
  }

  const { cls: synced, warning: posWarning } = await syncPos(saved)
  const warning = [libraryWarning, posWarning].filter(Boolean).join(' ') || undefined
  await audit('class-update', { kind: 'class', id: cls.id, label: synced.content.name }, {
    changes: changes.join(', ') || 'none', moved: moved.length, alsoUpdateLibrary: body.alsoUpdateLibrary === true,
  })
  return { data: { class: synced, ...(peopleToTell ? { peopleToTell } : {}) }, ...(warning ? { warning } : {}) }
}

/** Everyone holding a seat, one entry per booking. */
export function bookedPeople(ledger: Ledger): BookedPerson[] {
  const out = new Map<string, BookedPerson & { sum: number; charged?: number }>()
  for (const l of ledger.lines) {
    if (!isBooked(l)) continue
    const p = out.get(l.bookingId) ?? {
      bookingId: l.bookingId, name: fullName(l), email: l.customer?.email ?? '', phone: l.customer?.phone ?? '',
      seats: 0, paidCents: 0, sum: 0, charged: l.square.chargedCents,
    }
    p.seats += 1
    p.sum += paidOn(l)
    out.set(l.bookingId, p)
  }
  return [...out.values()].map(({ sum, charged, ...p }) => ({ ...p, paidCents: charged ?? sum }))
}

/** Cancel: off the POS, everyone booked listed for the owner to contact. Never refunds, never frees a seat. */
export async function cancelClass(body: { id?: unknown; expectedUpdatedAt?: unknown }): Promise<Saved<{ class: ScheduledClass; booked: BookedPerson[] }>> {
  const cls = await mustGetClass(body.id)
  const expectedUpdatedAt = expectedOf(body, cls)
  const saved = cls.status === 'cancelled' ? cls : await updateClass(cls.id, { status: 'cancelled' }, ADMIN_BY, 'Cancelled', { expectedUpdatedAt })
  let warning: string | undefined
  try {
    await archiveClassInSquare(saved)
  } catch (e) {
    console.warn(`[classes] taking ${cls.id} off the POS failed: ${e instanceof Error ? e.message : e}`)
    warning = CANCEL_WARNING
  }
  const booked = bookedPeople(await getLedger(cls.id))
  await audit('class-cancel', { kind: 'class', id: cls.id, label: cls.content.name }, { booked: booked.length })
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
      paidCents: first.square.chargedCents ?? lines.reduce((s, l) => s + paidOn(l), 0),
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

export async function classBookings(id: unknown): Promise<{ class: ScheduledClass; bookings: BookingView[] }> {
  const cls = await mustGetClass(id)
  return { class: cls, bookings: groupBookings(await getLedger(cls.id)) }
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
export async function blockTime(body: { startIso?: unknown; endIso?: unknown; reason?: unknown; confirm?: unknown }): Promise<{ blocked: BlockedTime; clashes: Busy[] }> {
  const startIso = toIso(body.startIso), endIso = toIso(body.endIso)
  if (!startIso || !endIso) throw new ActionError(400, 'Blocked time needs a start and an end time.')
  if (Date.parse(endIso) <= Date.parse(startIso)) throw new ActionError(400, 'Blocked time has to end after it starts.')
  const found = await bookedUnder(startIso, endIso)
  if (found.length && body.confirm !== true) throw new ActionError(409, clashMessage(found), { clashes: found })
  try {
    const b = await addBlocked({ startIso, endIso, reason: typeof body.reason === 'string' ? body.reason : '', by: ADMIN_BY })
    await audit('blocked-time-add', { kind: 'blocked-time', id: b.id, label: b.reason }, { startIso: b.startIso, endIso: b.endIso, over: found.length })
    return { blocked: b, clashes: found }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/^(Blocked time|The reason)/.test(msg)) throw new ActionError(400, msg)
    throw e
  }
}

export async function unblockTime(body: { id?: unknown }): Promise<void> {
  if (typeof body.id !== 'string' || !body.id) throw new ActionError(400, 'Pick the blocked time to remove.')
  await removeBlocked(body.id, ADMIN_BY)
  await audit('blocked-time-remove', { kind: 'blocked-time', id: body.id })
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
