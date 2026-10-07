// src/lib/conflicts.ts
/**
 * Room-time clashes between parties and classes. ONE rule, shared by every
 * guard: party times on offer, the party pre-charge re-check, class creation
 * (CLI and the in-tab Square step) and the warnings panel.
 *
 *   A party and a class clash when the party (its own length) overlaps the
 *   class window [class start − cleanup, class end].
 *
 * The cleanup is `partyConfig.cleanupBufferMinutes`: the room needs that long
 * after a party before a class starts. Nothing is needed after a class (the
 * Sunday 1–3 PM class leaves the 3:30 PM party in place).
 *
 * Pure: ISO strings in, answers out. No Square, no storage. Imported by
 * scripts/create-class.ts too (tsx resolves the @ aliases).
 */
import { partyConfig } from '@config/party.config'
import { formatDay, formatTime } from '@lib/studio-time'

const MINUTE_MS = 60_000

/** Epoch-ms interval, half-open [start, end): touching ends do not overlap. */
export interface Interval {
  start: number
  end: number
}

/** A class occurrence. `id` is the Square class schedule id. */
export interface ClassSpan {
  id: string
  name: string
  startIso: string
  endIso: string
}

/** A party booking. `id` is the Square booking id. */
export interface PartySpan {
  id: string
  startIso: string
  endIso: string
  hostName?: string
}

/**
 * Do `a` and `b` overlap once `b`'s start is pulled `bufferMinutes` earlier?
 * With the default 0 it is plain overlap, the same either way round.
 */
export function overlaps(a: Interval, b: Interval, bufferMinutes = 0): boolean {
  return a.start < b.end && b.start - bufferMinutes * MINUTE_MS < a.end
}

export function intervalOf(span: { startIso: string; endIso: string }): Interval {
  return { start: Date.parse(span.startIso), end: Date.parse(span.endIso) }
}

/** A class occurrence from the provider's Workshop shape. */
export function classSpanOf(w: { scheduleId: string; name: string; startAt: string; durationMinutes: number }): ClassSpan {
  const start = Date.parse(w.startAt)
  return {
    id: w.scheduleId,
    name: w.name,
    startIso: new Date(start).toISOString(),
    endIso: new Date(start + w.durationMinutes * MINUTE_MS).toISOString(),
  }
}

/** A party from a booking. A booking with no length counts as one standard party. */
export function partySpanOf(b: { id: string; slot: { startAt: string; duration?: number } }, hostName?: string): PartySpan {
  const start = Date.parse(b.slot.startAt)
  const minutes = b.slot.duration && b.slot.duration > 0 ? b.slot.duration : partyConfig.durationMinutes
  return {
    id: b.id,
    startIso: new Date(start).toISOString(),
    endIso: new Date(start + minutes * MINUTE_MS).toISOString(),
    ...(hostName ? { hostName } : {}),
  }
}

/** The class that rules out a party starting at `partyStartIso`, or null. */
export function classBlocksParty(partyStartIso: string, classes: ClassSpan[]): ClassSpan | null {
  const start = Date.parse(partyStartIso)
  const party: Interval = { start, end: start + partyConfig.durationMinutes * MINUTE_MS }
  return classes.find((c) => overlaps(party, intervalOf(c), partyConfig.cleanupBufferMinutes)) ?? null
}

/** Every party that rules out a class running [classStartIso, classEndIso). */
export function partyBlocksClass(classStartIso: string, classEndIso: string, parties: PartySpan[]): PartySpan[] {
  const cls: Interval = { start: Date.parse(classStartIso), end: Date.parse(classEndIso) }
  return parties.filter((p) => overlaps(intervalOf(p), cls, partyConfig.cleanupBufferMinutes))
}

/** Party starts with every class-blocked one taken out. */
export function removeClassBlocked(starts: string[], classes: ClassSpan[]): string[] {
  if (classes.length === 0) return starts
  return starts.filter((s) => !classBlocksParty(s, classes))
}

/** Two classes in the room at the same time. */
export function classesOverlap(a: ClassSpan, b: ClassSpan): boolean {
  return overlaps(intervalOf(a), intervalOf(b))
}

/** "the Rivera party" from host "Jamie Rivera"; "a party" when no name is known. */
export function partyName(p: PartySpan): string {
  const last = (p.hostName ?? '').trim().split(/\s+/).filter(Boolean).pop()
  return last ? `the ${last} party` : 'a party'
}

/** The refusal every class-creation path prints. There is no override. */
export function partyClashMessage(clashes: PartySpan[]): string {
  const lines = clashes.map(
    (p) => `  ${formatDay(p.startIso)} · ${formatTime(p.startIso)} party${p.hostName ? ` (${p.hostName})` : ''}, booking ${p.id}`,
  )
  return [
    `This class would overlap ${clashes.length === 1 ? 'a booked party' : `${clashes.length} booked parties`} (the room needs ${partyConfig.cleanupBufferMinutes} minutes after a party):`,
    ...lines,
    'Move the party in Square first (your call), then re-run.',
  ].join('\n')
}
