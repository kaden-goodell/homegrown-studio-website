/**
 * One of our own classes as the public list and the booking panel see it:
 * a WorkshopData row with `own` filled in. Seats left come from the seat
 * ledger here on the server, never from the browser.
 *
 * Server only (reads checkout.ts, which uses node:crypto).
 */
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'
import { studioDate } from '@components/workshops/workshop-view-model'
import { CLASS_TAX_PERCENT, cutoffRefusal } from './checkout'
import { sessionsForPass, type SaleOptions } from './pricing'
import { classAvailability, lowestPrice, passState, publicRules, type OwnClassData, type PublicPass, type PublicSession } from './public-class'
import { seatsTaken, type Ledger } from './seat-ledger'
import type { ScheduledClass } from './types'
import { sellableCells } from './validate'

/** Shown on the public list: open or closed, and not link-only. */
export function listedPublicly(cls: ScheduledClass): boolean {
  return (cls.status === 'open' || cls.status === 'closed') && !cls.content.rules.linkOnly && cls.sessions.length > 0
}

/** Reachable by its own link (/classes/<id>): open or closed, link-only or not. */
export function viewableByLink(cls: ScheduledClass): boolean {
  return (cls.status === 'open' || cls.status === 'closed') && cls.sessions.length > 0
}

/** `door`: as the crew at the door see it: a session stays open until it ends, whatever the online cutoff. */
export function toPublicClass(cls: ScheduledClass, ledger: Ledger, now: Date, opts: SaleOptions = {}): WorkshopData {
  const c = cls.content
  const sessionsSorted = [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))
  // R33: at the door, a class that doesn't take people partway closes as a whole once its first session has run,
  // so no pass is offered that the server would refuse.
  const wholeClassClosed = !!opts.door && !c.rules.joinPartway && sessionsSorted.length > 0 && Date.parse(sessionsSorted[0].endIso) <= now.getTime()
  const sessions: PublicSession[] = sessionsSorted.map((s) => ({
    id: s.id,
    startIso: s.startIso,
    endIso: s.endIso,
    left: Math.max(0, s.capacity - seatsTaken(ledger, s.id, now)),
    closed: opts.door ? wholeClassClosed || Date.parse(s.endIso) <= now.getTime() : cutoffRefusal(cls, [s.id], now) !== null,
  }))

  const sellable = new Set(sellableCells(c).map((cell) => cell.passId))
  const passes: PublicPass[] = c.passes
    .filter((p) => sellable.has(p.id))
    .map((p) => {
      if (p.covers.kind === 'choose') return { ...p, sessionIds: null, ...passState({ covers: p.covers, sessionIds: null }, sessions) }
      const covered = sessionsForPass(cls, p.id, undefined, now, opts)
      if (!covered.ok) return { ...p, sessionIds: [], state: 'closed' as const, left: 0 }
      const view = { ...p, sessionIds: covered.value }
      // A pass whose first session is past the cutoff can't be booked, whatever its later sessions say.
      if (!opts.door && cutoffRefusal(cls, covered.value, now)) return { ...view, state: 'closed' as const, left: 0 }
      return { ...view, ...passState(view, sessions.map((s) => (covered.value.includes(s.id) ? { ...s, closed: false } : s))) }
    })

  const prices: OwnClassData['prices'] = {}
  for (const p of passes) prices[p.id] = { ...(c.prices[p.id] ?? {}) }

  const own: OwnClassData = {
    classId: cls.id,
    sessions,
    passes,
    ticketTypes: c.ticketTypes,
    prices,
    questions: c.questions,
    addOns: c.addOns,
    rules: publicRules(c.rules),
    instructor: c.instructor || null,
    taxPercent: c.rules.taxable ? CLASS_TAX_PERCENT : 0,
  }

  const first = sessionsSorted[0]
  const { remainingSeats, signupClosed } = cls.status === 'closed'
    ? { remainingSeats: null, signupClosed: true }
    : classAvailability(own)
  return {
    id: cls.id,
    name: c.name,
    description: c.description,
    category: 'workshop',
    ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
    date: studioDate(new Date(first.startIso)),
    startTime: first.startIso,
    endTime: first.endIso,
    duration: Math.round((Date.parse(first.endIso) - Date.parse(first.startIso)) / 60_000),
    price: lowestPrice(own),
    currency: 'USD',
    taxPercent: own.taxPercent,
    remainingSeats,
    signupClosed,
    own,
  }
}
