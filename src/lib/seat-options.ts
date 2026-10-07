// src/lib/seat-options.ts
/**
 * Per-seat questions ("Pumpkin color") and sign-up cutoffs for a class
 * (spec A–C). Pure and client-safe — no imports, no env — so the booking
 * modal, the booking server, the staff sheet and the CLI share one set of
 * rules and one set of words.
 */

export interface SeatOption {
  /** Slug, e.g. "pumpkin-color". Stable once anyone has picked. */
  id: string
  label: string
  choices: string[]
}

export interface SeatPick {
  /** 1-based seat number within one booking. */
  seat: number
  optionId: string
  choice: string
}

/** What a cutoff is worked out from. `EventMeta` satisfies it. */
export interface CutoffSettings {
  options: SeatOption[]
  signupCutoffHours: number | null
}

export const MAX_OPTIONS = 3
export const MAX_LABEL_LENGTH = 40
export const MIN_CHOICES = 2
export const MAX_CHOICES = 12
export const MAX_CHOICE_LENGTH = 30
/** Two weeks: room for "a couple of days" and then some. */
export const MAX_CUTOFF_HOURS = 336
export const DEFAULT_CUTOFF_HOURS_WITH_OPTIONS = 24
/** Seats a class holds, when staff set it (Square's buyer API doesn't say). */
export const MAX_CAPACITY = 999

/** The one line under the seat questions, in the modal and the email. */
export const PICKS_FINAL_LINE = 'Picks are made ahead for you, so they can’t be changed after you book.'

/** A settings change the rules refuse. `status` is the HTTP answer: 400 invalid, 409 locked by existing picks. */
export class SeatSettingsError extends Error {
  readonly status: 400 | 409
  constructor(message: string, status: 400 | 409 = 400) {
    super(message)
    this.name = 'SeatSettingsError'
    this.status = status
  }
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export function optionIdFrom(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug || 'option'
}

export function validateOptions(raw: unknown): Result<SeatOption[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'Questions must be a list.' }
  if (raw.length > MAX_OPTIONS) return { ok: false, error: `A class can ask up to ${MAX_OPTIONS} questions.` }
  const out: SeatOption[] = []
  for (const item of raw as any[]) {
    const label = typeof item?.label === 'string' ? item.label.trim() : ''
    if (!label || label.length > MAX_LABEL_LENGTH) {
      return { ok: false, error: `Each question needs a name of 1 to ${MAX_LABEL_LENGTH} characters.` }
    }
    const rawChoices: unknown[] = Array.isArray(item.choices) ? item.choices : []
    if (rawChoices.length < MIN_CHOICES || rawChoices.length > MAX_CHOICES) {
      return { ok: false, error: `“${label}” needs ${MIN_CHOICES} to ${MAX_CHOICES} choices.` }
    }
    const choices = rawChoices.map((c) => (typeof c === 'string' ? c.trim() : ''))
    const seen = new Set<string>()
    for (const c of choices) {
      if (!c || c.length > MAX_CHOICE_LENGTH) return { ok: false, error: `Each choice needs 1 to ${MAX_CHOICE_LENGTH} characters.` }
      if (seen.has(c.toLowerCase())) return { ok: false, error: `“${c}” is listed twice under “${label}”.` }
      seen.add(c.toLowerCase())
    }
    const id = typeof item.id === 'string' && /^[a-z0-9-]{1,32}$/.test(item.id) ? item.id : optionIdFrom(label)
    if (out.some((o) => o.id === id || o.label.toLowerCase() === label.toLowerCase())) {
      return { ok: false, error: `Two questions are both called “${label}”.` }
    }
    out.push({ id, label, choices })
  }
  return { ok: true, value: out }
}

/**
 * Once anyone has picked, stored picks must stay valid: the same questions,
 * and every existing choice still there. New choices and a renamed question
 * are fine. Returns the refusal, or null.
 */
export function optionsChangeRefusal(prev: SeatOption[], next: SeatOption[], hasPicks: boolean): string | null {
  if (!hasPicks) return null
  const sameQuestions = prev.length === next.length && prev.every((p) => next.some((n) => n.id === p.id))
  if (!sameQuestions) return 'People have already picked for this class, so questions can’t be added or removed.'
  for (const p of prev) {
    const n = next.find((x) => x.id === p.id)!
    if (!p.choices.every((c) => n.choices.includes(c))) {
      return 'People have already picked for this class, so existing choices can’t be removed or renamed. You can add new ones.'
    }
  }
  return null
}

export function validateCutoffHours(raw: unknown): Result<number | null> {
  if (raw === null) return { ok: true, value: null }
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= MAX_CUTOFF_HOURS) return { ok: true, value: raw }
  return { ok: false, error: `Sign-ups close 0 to ${MAX_CUTOFF_HOURS} hours before the class, in whole hours.` }
}

/** A class's seat count: a whole number 1–999, or null for "unknown". */
export function validateCapacity(raw: unknown): Result<number | null> {
  if (raw === null) return { ok: true, value: null }
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= MAX_CAPACITY) return { ok: true, value: raw }
  return { ok: false, error: `Capacity is 1 to ${MAX_CAPACITY} seats, in whole seats.` }
}

/** 0 h for a plain class, 24 h once it asks questions; a class's own setting wins. */
export function effectiveCutoffHours(s: CutoffSettings): number {
  return s.signupCutoffHours ?? (s.options.length > 0 ? DEFAULT_CUTOFF_HOURS_WITH_OPTIONS : 0)
}

/**
 * When sign-ups close: whole hours before the start, in real time. Across a
 * clock change the wall-clock time moves by the hour; 24 hours is 24 hours.
 */
export function signupClosesAt(startIso: string, s: CutoffSettings): string {
  return new Date(Date.parse(startIso) - effectiveCutoffHours(s) * 3_600_000).toISOString()
}

export function isSignupClosed(startIso: string, s: CutoffSettings, now: Date = new Date()): boolean {
  return now.getTime() >= Date.parse(signupClosesAt(startIso, s))
}

export function cutoffClosedMessage(hours: number): string {
  if (hours === 0) return 'Sign-ups for this class have closed.'
  return `Sign-ups for this class closed ${hours} hour${hours === 1 ? '' : 's'} before it starts.`
}

/** Key for one seat's answer to one question in a form's state. */
export function selectionKey(seat: number, optionId: string): string {
  return `${seat}:${optionId}`
}

/** The first seat and question still unanswered, or null when every seat has picked. */
export function firstMissingPick(
  options: SeatOption[],
  seats: number,
  selections: Record<string, string>,
): { seat: number; option: SeatOption } | null {
  for (let seat = 1; seat <= seats; seat++) {
    for (const option of options) {
      if (!selections[selectionKey(seat, option.id)]) return { seat, option }
    }
  }
  return null
}

/** Picks for seats 1..seats only: answers kept for seats taken away are not sent. */
export function picksFromSelections(options: SeatOption[], seats: number, selections: Record<string, string>): SeatPick[] {
  const out: SeatPick[] = []
  for (let seat = 1; seat <= seats; seat++) {
    for (const option of options) {
      const choice = selections[selectionKey(seat, option.id)]
      if (choice) out.push({ seat, optionId: option.id, choice })
    }
  }
  return out
}

/** "Pumpkin color: Black ×1, Lavender ×1" — the Square booking note. Choices in the class's order; questions joined with " · ". */
export function picksNote(options: SeatOption[], picks: SeatPick[]): string {
  return options
    .map((o) => {
      const counts = o.choices
        .map((c) => [c, picks.filter((p) => p.optionId === o.id && p.choice === c).length] as const)
        .filter(([, n]) => n > 0)
      return counts.length ? `${o.label}: ${counts.map(([c, n]) => `${c} ×${n}`).join(', ')}` : ''
    })
    .filter(Boolean)
    .join(' · ')
}

const PICKS_GARBLED = 'The seat picks didn’t come through. Refresh and try again.'

/**
 * The booking server's check: one pick per seat per question, each a listed
 * choice. A class with no questions takes no picks. Answers with the FIRST
 * problem, in words the customer can act on.
 */
export function validatePicks(options: SeatOption[], seats: number, raw: unknown): Result<SeatPick[]> {
  const list = raw === undefined || raw === null ? [] : raw
  if (!Array.isArray(list)) return { ok: false, error: PICKS_GARBLED }
  if (options.length === 0) {
    return list.length === 0 ? { ok: true, value: [] } : { ok: false, error: 'This class has nothing to pick. Refresh and try again.' }
  }
  const chosen: Record<string, string> = {}
  for (const p of list as any[]) {
    const seat = p?.seat
    const optionId = p?.optionId
    const choice = p?.choice
    if (!Number.isInteger(seat) || seat < 1 || seat > seats || typeof optionId !== 'string' || typeof choice !== 'string') {
      return { ok: false, error: PICKS_GARBLED }
    }
    const option = options.find((o) => o.id === optionId)
    if (!option) return { ok: false, error: 'This class’s questions have changed. Refresh and pick again.' }
    if (!option.choices.includes(choice)) {
      return { ok: false, error: `Seat ${seat}: “${choice}” isn’t one of the ${option.label.toLowerCase()} choices.` }
    }
    const k = selectionKey(seat, optionId)
    if (k in chosen) return { ok: false, error: `Seat ${seat} has two ${option.label.toLowerCase()} picks.` }
    chosen[k] = choice
  }
  const missing = firstMissingPick(options, seats, chosen)
  if (missing) return { ok: false, error: `Pick a ${missing.option.label.toLowerCase()} for seat ${missing.seat}.` }
  return { ok: true, value: picksFromSelections(options, seats, chosen) }
}

/** "Seat 1 · Pumpkin color: Lavender" — one line per pick, for the email. */
export function seatPickLines(options: SeatOption[], picks: SeatPick[]): string[] {
  return picks.map((p) => `Seat ${p.seat} · ${options.find((o) => o.id === p.optionId)?.label ?? p.optionId}: ${p.choice}`)
}

/** Seats per choice, per question: { "pumpkin-color": { Lavender: 6, Black: 4 } }. */
export function choiceTotals(options: SeatOption[], picks: SeatPick[]): Record<string, Record<string, number>> {
  const totals: Record<string, Record<string, number>> = {}
  for (const o of options) totals[o.id] = {}
  for (const p of picks) {
    const t = totals[p.optionId]
    if (t) t[p.choice] = (t[p.choice] ?? 0) + 1
  }
  return totals
}

/** "Pumpkin color — Lavender 6 · Black 4 · Light Pink 3 · Light Blue 2": most picked first, ties in the class's order. */
export function totalsLine(option: SeatOption, totals: Record<string, number>): string {
  const parts = option.choices
    .map((c) => [c, totals[c] ?? 0] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  return `${option.label} — ${parts.length ? parts.map(([c, n]) => `${c} ${n}`).join(' · ') : 'no picks yet'}`
}

/** "Lavender ×2, Black ×1": a family's picks on the roster card. */
export function picksShort(picks: SeatPick[]): string {
  const counts = new Map<string, number>()
  for (const p of picks) counts.set(p.choice, (counts.get(p.choice) ?? 0) + 1)
  return [...counts].map(([c, n]) => `${c} ×${n}`).join(', ')
}
