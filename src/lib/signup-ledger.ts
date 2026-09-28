/**
 * The record of "tell me when…" sign-ups, as kept in a customer's note.
 *
 * One dated line per event, newest line first:
 *
 *   2026-10-10 Emailed: party-later:2026-12
 *   2026-09-27 Asked to be told: party-later:2026-12
 *
 * A sign-up is OPEN until a line above it (so, written later) says it was
 * emailed, or that the email failed. A failed one is closed too: the owners
 * are told and a person follows up, so nobody is emailed over and over.
 *
 * The note belongs to the booking system and staff may write in it by hand.
 * Anything that is not exactly one of these lines is left alone.
 */

const ASKED = 'Asked to be told'
const EMAILED = 'Emailed'
const FAILED = 'Email failed'

/** What an empty sign-up was stored as, before every form named what it was for. */
const NOTHING_NAMED = 'when booking opens'

const LINE = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}) (${ASKED}|${EMAILED}|${FAILED}): (.+)$`)

export interface OpenSignup {
  /** The day they signed up (YYYY-MM-DD). */
  date: string
  /** What they signed up for, as stored, e.g. "party-later:2026-12". */
  interest: string
}

/** The line written when someone signs up. */
export function askedLine(today: string, interest: string): string {
  return `${today} ${ASKED}: ${interest || NOTHING_NAMED}`
}

/** The line written when the email they were promised has gone. */
export function emailedLine(today: string, interest: string): string {
  return `${today} ${EMAILED}: ${interest || NOTHING_NAMED}`
}

/** The line written when the email could not be sent and a person must follow up. */
export function failedLine(today: string, interest: string): string {
  return `${today} ${FAILED}: ${interest || NOTHING_NAMED}`
}

/**
 * The sign-ups in a note that have not been answered yet, oldest first.
 * The same thing asked for twice is one sign-up.
 */
export function openSignups(note: string | null | undefined): OpenSignup[] {
  if (!note) return []
  const answered = new Set<string>()
  const open = new Map<string, OpenSignup>()
  // Newest first: by the time a sign-up is read, every later line has been seen.
  for (const raw of note.split('\n')) {
    const m = raw.trim().match(LINE)
    if (!m) continue
    const [, date, what, stored] = m
    const interest = stored === NOTHING_NAMED ? '' : stored
    if (what === ASKED) {
      if (!answered.has(interest)) open.set(interest, { date, interest })
    } else {
      answered.add(interest)
    }
  }
  return [...open.values()].sort((a, b) => a.date.localeCompare(b.date))
}
