/**
 * Seat questions can close before sign-ups do (Kaden, 2 Nov 2026): a kids'
 * tee size needs a week's lead time, so the class's questions close N hours
 * before it starts while seats keep selling. A booking made after that
 * answers no questions (late bookers get no pick); one made before still
 * answers all of them.
 *
 * Counted like the sign-up cutoff: from the first of the sessions asked for,
 * or from the class's first session when it doesn't take people partway.
 */
import type { ScheduledClass, SeatQuestion } from './types'

/** Hours before the start that the questions close; null = they close with sign-ups. */
export function questionsCloseHours(cls: ScheduledClass): number | null {
  return cls.content.rules.questionsCloseHours ?? null
}

/** When the questions close for a booking of these sessions (ISO), or null when they never close early. */
export function questionsCloseAt(cls: ScheduledClass, sessionIds: string[]): string | null {
  const hours = questionsCloseHours(cls)
  if (hours === null) return null
  const asked = cls.sessions.filter((s) => sessionIds.includes(s.id))
  const starts = (asked.length && !cls.content.rules.joinPartway ? cls.sessions : asked).map((s) => Date.parse(s.startIso))
  // Nothing picked yet (a pick-a-day option): open while any date still has them open.
  if (!asked.length) {
    const all = cls.sessions.map((s) => Date.parse(s.startIso))
    if (!all.length) return null
    return new Date((cls.content.rules.joinPartway ? Math.max(...all) : Math.min(...all)) - hours * 3_600_000).toISOString()
  }
  return new Date(Math.min(...starts) - hours * 3_600_000).toISOString()
}

/** The questions a booking of these sessions answers now: none once they've closed. */
export function openQuestions(cls: ScheduledClass, sessionIds: string[], now: Date): SeatQuestion[] {
  const closesAt = questionsCloseAt(cls, sessionIds)
  if (closesAt === null) return cls.content.questions
  return now.getTime() >= Date.parse(closesAt) ? [] : cls.content.questions
}

/**
 * True when any seat carries an answer to one of this class's questions that has closed. An answer to a question
 * the class no longer has (an owner deleted it while the page was open) is not "closed": `cleanSeats` drops it and
 * the booking goes ahead without it (review M3, 3 Nov).
 */
export function answersClosedQuestion(
  cls: ScheduledClass,
  seats: { answers?: Record<string, string> }[] | undefined,
  sessionIds: string[],
  now: Date,
): boolean {
  const asked = new Set(cls.content.questions.map((q) => q.id))
  const open = new Set(openQuestions(cls, sessionIds, now).map((q) => q.id))
  return (seats ?? []).some((s) => Object.entries(s.answers ?? {}).some(([id, v]) => !!v && asked.has(id) && !open.has(id)))
}

/** The seats with answers to closed questions taken off (add-ons kept). */
export function withoutClosedAnswers<T extends { answers?: Record<string, string> }>(
  cls: ScheduledClass,
  seats: T[] | undefined,
  sessionIds: string[],
  now: Date,
): T[] | undefined {
  if (!seats) return seats
  const open = new Set(openQuestions(cls, sessionIds, now).map((q) => q.id))
  return seats.map((s) => (s.answers ? { ...s, answers: Object.fromEntries(Object.entries(s.answers).filter(([id]) => open.has(id))) } : s))
}

/** The message a stale page gets when it still sends answers after the questions closed. */
export const QUESTIONS_CLOSED_MESSAGE = 'The questions for this class have closed, so new seats come without a pick. Reload the page and book again. Nothing was charged.'
