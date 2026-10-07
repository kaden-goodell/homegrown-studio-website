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
