/**
 * What the public pages know about one of our own classes, and the small
 * rules both the server and the booking panel apply to it.
 *
 * Browser-safe: no server imports. Seats left are counted on the server from
 * the seat ledger (src/lib/classes/public-view.ts); the browser only reads them.
 */
import { formatMoney } from '@lib/money'
import { formatDay } from '@lib/studio-time'
import type { AddOn, Cents, ClassRules, Pass, ScheduledClass, SeatQuestion, TicketType } from './types'

export interface PublicSession {
  id: string
  startIso: string
  endIso: string
  /** Seats left, counted on the server. */
  left: number
  /** Started, or past the sign-up cutoff (decided on the server). */
  closed: boolean
}

export interface PublicPass extends Pass {
  /** The sessions this pass books; null when the buyer picks them ('choose'). */
  sessionIds: string[] | null
  /** open = can be booked; full = a session it needs has no seats; closed = sign-ups have closed. */
  state: 'open' | 'full' | 'closed'
  /** Seats left on the fullest session it needs (for 'choose', the roomiest open session). */
  left: number
}

/** Everything the booking panel needs for one of our classes. Only sellable passes are listed. */
export interface OwnClassData {
  classId: string
  sessions: PublicSession[]
  passes: PublicPass[]
  ticketTypes: TicketType[]
  prices: Record<string, Record<string, Cents>>
  questions: SeatQuestion[]
  addOns: AddOn[]
  rules: ClassRules
  instructor: string | null
  /** Tax added on top, in percent (0 when the class isn't taxed). */
  taxPercent: number
}

/** The pass's state, from its sessions. A 'choose' pass needs `count` open sessions with room. */
export function passState(pass: Pick<PublicPass, 'covers' | 'sessionIds'>, sessions: PublicSession[]): Pick<PublicPass, 'state' | 'left'> {
  if (pass.covers.kind === 'choose') {
    const open = sessions.filter((s) => !s.closed)
    const roomy = open.filter((s) => s.left > 0)
    const left = Math.max(0, ...roomy.map((s) => s.left))
    if (roomy.length >= pass.covers.count) return { state: 'open', left }
    return { state: open.length >= pass.covers.count ? 'full' : 'closed', left: 0 }
  }
  const needed = sessions.filter((s) => pass.sessionIds?.includes(s.id))
  if (!needed.length || needed.some((s) => s.closed)) return { state: 'closed', left: 0 }
  const left = Math.max(0, Math.min(...needed.map((s) => s.left)))
  return { state: left > 0 ? 'open' : 'full', left }
}

/** Seats just sold on these sessions: take them off, and work the passes out again. */
export function withSeatsSold(own: OwnClassData, sessionIds: string[], seats: number): OwnClassData {
  const sessions = own.sessions.map((s) => (sessionIds.includes(s.id) ? { ...s, left: Math.max(0, s.left - seats) } : s))
  return {
    ...own,
    sessions,
    passes: own.passes.map((p) => (p.state === 'closed' ? p : { ...p, ...passState(p, sessions) })),
  }
}

/**
 * How the list shows the class as a whole. Sold out only when every pass is
 * full; sign-ups closed when nothing can be booked and not everything is full.
 */
export function classAvailability(own: Pick<OwnClassData, 'passes'>): { remainingSeats: number | null; signupClosed: boolean } {
  const open = own.passes.filter((p) => p.state === 'open')
  if (open.length) return { remainingSeats: Math.max(...open.map((p) => p.left)), signupClosed: false }
  if (own.passes.length && own.passes.every((p) => p.state === 'full')) return { remainingSeats: 0, signupClosed: false }
  return { remainingSeats: null, signupClosed: true }
}

/** The lowest seat price on sale (the "From" price). */
export function lowestPrice(own: Pick<OwnClassData, 'passes' | 'ticketTypes' | 'prices'>): Cents {
  const cents = cells(own).map((c) => c.cents)
  return cents.length ? Math.min(...cents) : 0
}

/** Every price on sale, pass by pass, ticket types in order (as `sellableCells`). */
function cells(own: Pick<OwnClassData, 'passes' | 'ticketTypes' | 'prices'>): { passId: string; ticketTypeId: string; cents: Cents }[] {
  return own.passes.flatMap((p) =>
    own.ticketTypes
      .filter((t) => own.prices[p.id]?.[t.id] !== undefined)
      .map((t) => ({ passId: p.id, ticketTypeId: t.id, cents: own.prices[p.id][t.id] })),
  )
}

/** "$15", "$20 adult · $15 kid" (one pass, up to three ticket types) or "From $15". */
export function ownPriceLabel(own: Pick<OwnClassData, 'passes' | 'ticketTypes' | 'prices'>, currency = 'USD'): string {
  const all = cells(own)
  if (!all.length) return ''
  const distinct = new Set(all.map((c) => c.cents))
  if (distinct.size === 1) return formatMoney(all[0].cents, currency)
  if (own.passes.length === 1 && all.length <= 3) {
    return all
      .map((c) => `${formatMoney(c.cents, currency)} ${own.ticketTypes.find((t) => t.id === c.ticketTypeId)!.label.toLowerCase()}`)
      .join(' · ')
  }
  return `From ${formatMoney(Math.min(...distinct), currency)}`
}

/** "4 sessions · starts Sat Oct 24" for a class that meets more than once; '' for one session. */
export function sessionsLine(own: Pick<OwnClassData, 'sessions'>): string {
  if (own.sessions.length <= 1) return ''
  return `${own.sessions.length} sessions · starts ${formatDay(own.sessions[0].startIso).replace(',', '')}`
}

/** A class record good enough for `quote` in the browser (display only; the server prices from its own). */
export function asScheduledClass(own: OwnClassData, name: string): ScheduledClass {
  return {
    id: own.classId,
    libraryId: null,
    libraryVersion: null,
    content: {
      name, description: '', imageUrl: null, instructor: own.instructor, rules: own.rules,
      ticketTypes: own.ticketTypes, passes: own.passes, prices: own.prices,
      questions: own.questions, addOns: own.addOns, defaultCapacity: 0, defaultMinutes: 0,
    },
    sessions: own.sessions.map((s) => ({ id: s.id, startIso: s.startIso, endIso: s.endIso, capacity: s.left })),
    status: 'open',
    square: { itemId: null, variations: {} },
    createdAt: '', updatedAt: '', by: { id: '', name: '' }, history: [],
  }
}
