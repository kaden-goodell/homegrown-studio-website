/**
 * Is it time to send the email a sign-up was promised?
 *
 * Each "tell me when…" sign-up waits for one thing: booking to open, a date
 * to come into the booking window, a seat to free up. `judge` looks at what
 * the studio is offering right now and says whether that thing has happened,
 * and if so what the email says and where its button goes.
 *
 * Two rules hold throughout:
 *  - Nothing is announced that a person could not then book. A party date is
 *    "open" only if it is in the list of open party times handed in, which is
 *    the same list the booking panel shows. Dates the studio has closed are
 *    not in it, so nobody is told about them.
 *  - Nothing the visitor typed is repeated back. A workshop is named only
 *    when it matches one we list; dates are rebuilt from their parts.
 */
import { canBeBooked } from '@lib/workshop-rules'
import { formatMoney } from '@lib/money'
import { isSignupClosed, type CutoffSettings } from '@lib/seat-options'

export interface WorkshopFact {
  id: string
  name: string
  /** ISO start */
  startAt: string
  durationMinutes: number
  priceCents: number
  seatsLeft: number
  /** The class's questions and cutoff. Absent = a plain class (closes at its
   *  start); null = couldn't be read, so nothing is announced for it. */
  cutoff?: CutoffSettings | null
}

export interface StudioFacts {
  now: Date
  /** The public booking switch. While it is off nothing is due. */
  bookingOpen: boolean
  /** Party start times a customer could book right now (ISO). Empty when none are on offer. */
  openPartyStarts: string[]
  /** Upcoming workshops, sold-out and unpriced ones included. */
  workshops: WorkshopFact[]
  /** Take-home kits can be ordered. */
  kitsOpen: boolean
  /** How far ahead party dates open, in days. */
  bookingWindowDays: number
  timeZone: string
}

export interface DueItem {
  /** Short, and the subject line when it is the only item: "Party booking is open". */
  headline: string
  /** One or two plain sentences. */
  lines: string[]
  /** Where the button goes, from the site root: "/book?date=2026-12-05". */
  path: string
  /** What the button says. */
  linkLabel: string
}

export type Verdict =
  /** Not yet. Look again next time. */
  | { state: 'wait' }
  /** The day has gone by. Nothing will be sent for this sign-up. */
  | { state: 'over' }
  /** Not something that can be answered automatically. Left for a person. */
  | { state: 'unknown' }
  | { state: 'due'; item: DueItem }

const WAIT: Verdict = { state: 'wait' }
const OVER: Verdict = { state: 'over' }
const UNKNOWN: Verdict = { state: 'unknown' }

const YMD = /^\d{4}-\d{2}-\d{2}$/
const YM = /^\d{4}-(0[1-9]|1[0-2])$/
const CRAFT_ID = /^[A-Za-z0-9_-]{6,40}$/

function realDay(ymd: string): boolean {
  return YMD.test(ymd) && !Number.isNaN(Date.parse(`${ymd}T12:00:00Z`))
}

/** "Saturday, October 24" */
function longDay(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** "October 24" */
function shortDay(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
}

/** "December" */
function monthName(ym: string): string {
  return new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
}

function dayOf(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone })
}

function timeOf(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
}

/** The workshop a stored "Name 2026-10-16" points at, if we list it. */
function findWorkshop(rest: string, facts: StudioFacts): { workshop: WorkshopFact | null; day: string } {
  const m = rest.match(/^(.*?)\s+(\d{4}-\d{2}-\d{2})$/)
  const typed = (m ? m[1] : rest).trim().toLowerCase()
  const day = m && realDay(m[2]) ? m[2] : ''
  if (!typed) return { workshop: null, day }
  const onTheDay = facts.workshops.filter((w) => !day || dayOf(w.startAt, facts.timeZone) === day)
  // Sign-ups cut long names to fit, so a listed name may be longer than what was stored.
  const workshop =
    onTheDay.find((w) => w.name.toLowerCase() === typed) ??
    onTheDay.find((w) => typed.length >= 12 && w.name.toLowerCase().startsWith(typed)) ??
    null
  return { workshop, day }
}

function upcoming(w: WorkshopFact, facts: StudioFacts): boolean {
  return new Date(w.startAt).getTime() > facts.now.getTime()
}

/** Same cutoff the booking server enforces, so no email points at a closed class. */
function signupsOpen(w: WorkshopFact, facts: StudioFacts): boolean {
  if (w.cutoff === null) return false
  return !w.cutoff || !isSignupClosed(w.startAt, w.cutoff, facts.now)
}

function bookable(w: WorkshopFact, facts: StudioFacts): boolean {
  return upcoming(w, facts) && canBeBooked(w.priceCents) && w.seatsLeft > 0 && signupsOpen(w, facts)
}

/** "Friday, October 16 at 7:00 PM. $40 per seat." */
function workshopLine(w: WorkshopFact, facts: StudioFacts): string {
  const day = longDay(dayOf(w.startAt, facts.timeZone))
  return `${day} at ${timeOf(w.startAt, facts.timeZone)}. ${formatMoney(w.priceCents)} per seat.`
}

function workshopDue(headline: string, w: WorkshopFact, facts: StudioFacts, extra: string[] = []): Verdict {
  return {
    state: 'due',
    item: {
      headline,
      lines: [workshopLine(w, facts), ...extra],
      path: `/workshops?w=${encodeURIComponent(w.id)}`,
      linkLabel: 'See details and book',
    },
  }
}

/** Every workshop that can be booked right now. */
function workshopsOpen(facts: StudioFacts, headline: string): Verdict {
  const open = facts.workshops.filter((w) => bookable(w, facts))
  if (open.length === 0) return WAIT
  const first = open[0]
  const day = longDay(dayOf(first.startAt, facts.timeZone))
  return {
    state: 'due',
    item: {
      headline,
      lines: [
        open.length === 1
          ? `${first.name} is on ${day}.`
          : `${open.length} workshops are open for booking. The first is ${first.name} on ${day}.`,
      ],
      path: '/workshops',
      linkLabel: 'See the workshops',
    },
  }
}

/** Party booking in general, with an optional sentence about what they were looking at. */
function partiesOpen(facts: StudioFacts, headline: string, about: string[] = [], path = '/book'): Verdict {
  const first = facts.openPartyStarts[0]
  if (!first) return WAIT
  return {
    state: 'due',
    item: {
      headline,
      lines: [...about, `The next open date is ${longDay(dayOf(first, facts.timeZone))}.`],
      path,
      linkLabel: 'See open dates',
    },
  }
}

function partyDay(day: string, facts: StudioFacts, exactStart?: string): Verdict {
  const today = dayOf(facts.now.toISOString(), facts.timeZone)
  // The day they were looking at has gone: they were still promised word that booking opened.
  if (day < today) return partiesOpen(facts, 'Party booking is open')

  const lastOpen = facts.openPartyStarts.length
    ? dayOf(facts.openPartyStarts[facts.openPartyStarts.length - 1], facts.timeZone)
    : ''
  const onTheDay = facts.openPartyStarts.filter((s) => dayOf(s, facts.timeZone) === day)

  if (onTheDay.length > 0) {
    const exact = exactStart && onTheDay.find((s) => new Date(s).getTime() === new Date(exactStart).getTime())
    return {
      state: 'due',
      item: {
        headline: `${longDay(day)} is open for a party`,
        lines: [
          exact
            ? `${timeOf(exact, facts.timeZone)} is open. A date is held for whoever books it first.`
            : 'A date is held for whoever books it first.',
        ],
        path: exact ? `/book?start=${encodeURIComponent(new Date(exact).toISOString())}` : `/book?date=${day}`,
        linkLabel: `Book ${shortDay(day)}`,
      },
    }
  }

  // Further ahead than dates are open: say so, and promise nothing about that day.
  if (lastOpen && day > lastOpen) {
    return partiesOpen(facts, 'Party booking is open', [
      `We open party dates ${facts.bookingWindowDays} days ahead, so ${longDay(day)} is not on the calendar yet.`,
    ])
  }
  return partiesOpen(facts, 'Party booking is open', [`${longDay(day)} is not available, but other dates are.`])
}

function partyLater(month: string, facts: StudioFacts): Verdict {
  if (!YM.test(month)) return UNKNOWN
  const today = dayOf(facts.now.toISOString(), facts.timeZone)
  if (month < today.slice(0, 7)) return OVER
  const inMonth = facts.openPartyStarts.filter((s) => dayOf(s, facts.timeZone).startsWith(month))
  if (inMonth.length === 0) return WAIT
  const first = dayOf(inMonth[0], facts.timeZone)
  return {
    state: 'due',
    item: {
      headline: `Party dates in ${monthName(month)} are opening`,
      lines: [
        `The first open date is ${longDay(first)}.`,
        `We open dates ${facts.bookingWindowDays} days ahead, so the rest of ${monthName(month)} opens day by day.`,
      ],
      path: `/book?date=${first}`,
      linkLabel: `See ${monthName(month)} dates`,
    },
  }
}

export function judge(interest: string, facts: StudioFacts): Verdict {
  const [kind, ...restParts] = interest.trim().split(':')
  const rest = restParts.join(':').trim()
  const today = dayOf(facts.now.toISOString(), facts.timeZone)

  // Kits have their own switch; everything else waits on booking being open.
  if (kind === 'kits' || kind === 'kit-theme') {
    if (!facts.kitsOpen) return WAIT
    return {
      state: 'due',
      item: {
        headline: 'Take-home kits are ready',
        lines: ['Pick a kit, choose a pickup day, and make it at home.'],
        path: '/kits',
        linkLabel: 'See the kits',
      },
    }
  }

  if (!facts.bookingOpen) {
    // A sign-up whose day has gone will never be answered, open or not.
    if ((kind === 'workshop-soon' || kind === 'workshop-waitlist') && dayHasGone(rest, today)) return OVER
    return KNOWN_KINDS.has(kind) || interest.trim() === '' ? WAIT : UNKNOWN
  }

  switch (kind) {
    case '':
      // Signed up before the forms said what they were for: party booking was the only thing on offer.
      return partiesOpen(facts, 'Party booking is open')

    case 'party':
      if (rest === 'more-dates') return partiesOpen(facts, 'More party dates are open')
      return partiesOpen(facts, 'Party booking is open')

    case 'party-date':
      return realDay(rest) ? partyDay(rest, facts) : partiesOpen(facts, 'Party booking is open')

    case 'party-time': {
      const at = new Date(rest)
      if (Number.isNaN(at.getTime())) return partiesOpen(facts, 'Party booking is open')
      return partyDay(dayOf(at.toISOString(), facts.timeZone), facts, at.toISOString())
    }

    case 'party-craft':
      return partiesOpen(facts, 'Party booking is open', [], CRAFT_ID.test(rest) ? `/book?craft=${rest}` : '/book')

    case 'party-later':
      return partyLater(rest, facts)

    case 'workshops':
      return workshopsOpen(facts, rest === 'new-dates' ? 'New workshops are posted' : 'Workshop booking is open')

    case 'workshop': {
      const { workshop } = findWorkshop(rest, facts)
      if (workshop && bookable(workshop, facts)) return workshopDue(`Booking is open for ${workshop.name}`, workshop, facts)
      // Listed but not for sale yet: its own day will come.
      if (workshop && upcoming(workshop, facts) && !canBeBooked(workshop.priceCents)) return WAIT
      return workshopsOpen(facts, 'Workshop booking is open')
    }

    case 'workshop-soon': {
      if (dayHasGone(rest, today)) return OVER
      const { workshop } = findWorkshop(rest, facts)
      if (!workshop || !bookable(workshop, facts)) return WAIT
      return workshopDue(`${workshop.name} is open for booking`, workshop, facts)
    }

    case 'workshop-waitlist': {
      if (dayHasGone(rest, today)) return OVER
      const { workshop } = findWorkshop(rest, facts)
      if (!workshop || !bookable(workshop, facts)) return WAIT
      const seats = workshop.seatsLeft === 1 ? '1 seat is open' : `${workshop.seatsLeft} seats are open`
      return workshopDue(`A seat has opened in ${workshop.name}`, workshop, facts, [
        `${seats} right now. A seat goes to whoever books it first.`,
      ])
    }

    default:
      return UNKNOWN
  }
}

const KNOWN_KINDS = new Set([
  'party',
  'party-date',
  'party-time',
  'party-craft',
  'party-later',
  'workshops',
  'workshop',
  'workshop-soon',
  'workshop-waitlist',
])

/** True when a stored "Name 2026-10-16" names a day before today. */
function dayHasGone(rest: string, today: string): boolean {
  const m = rest.match(/(\d{4}-\d{2}-\d{2})$/)
  return !!m && realDay(m[1]) && m[1] < today
}
