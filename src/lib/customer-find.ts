/**
 * /admin › Find a booking (final review I5): a caller says "I booked a pottery
 * class sometime in December" — one search by name, email or phone finds their
 * class bookings (with what was paid and refunded, for the Refund button),
 * their parties and their places on a waitlist. Read-only. Owners only (the
 * route checks). Looks at classes from 120 days back to a year ahead, and
 * every party record.
 *
 * Server only.
 */
import { classBookings, type ClassBooking } from '@lib/classes/admin-actions'
import { listClasses } from '@lib/classes/class-store'
import { getLedger } from '@lib/classes/seat-ledger'
import { getWaitlist, isOnList, waitlistClassIds } from '@lib/classes/waitlist-store'
import type { TicketType } from '@lib/classes/types'
import { listParties, type PartyRecord } from '@lib/party-store'

const DAY = 86_400_000
export const FIND_MAX = 20
export const FIND_MIN = 2

export interface FoundClassBooking {
  classId: string
  className: string
  /** First date this booking is on (or the class's first date). */
  startIso: string
  endIso: string
  status: string
  ticketTypes: TicketType[]
  booking: ClassBooking
}
export interface FoundParty { bookingId: string; startIso: string; hostName: string; craftName: string; guestCount: number; status: 'booked' | 'cancelled'; inSquare: boolean }
export interface FoundWaitlist { classId: string; className: string; startIso: string; seats: number; name: string }
export interface FindResult { classes: FoundClassBooking[]; parties: FoundParty[]; waitlist: FoundWaitlist[]; more: boolean }

type Who = { givenName?: string; familyName?: string; email?: string; phone?: string; name?: string } | null | undefined

/** A matcher for what she typed: part of a name or email, or 4+ digits of a phone number. */
export function matcher(q: string): (who: Who) => boolean {
  const text = q.trim().toLowerCase()
  const digits = text.replace(/\D/g, '')
  const phoneish = digits.length >= 4 && /^[\d\s()+.-]+$/.test(text)
  return (who) => {
    if (!who) return false
    if (phoneish) return (who.phone ?? '').replace(/\D/g, '').includes(digits)
    const name = (who.name ?? `${who.givenName ?? ''} ${who.familyName ?? ''}`).toLowerCase().replace(/\s+/g, ' ').trim()
    return name.includes(text) || (who.email ?? '').toLowerCase().includes(text)
  }
}

export async function findCustomerBookings(q: string, now = new Date()): Promise<FindResult> {
  const hit = matcher(q)
  const out: FindResult = { classes: [], parties: [], waitlist: [], more: false }

  // Classes: read each ledger in the window, then the full booking view only for classes with a match.
  const classes = await listClasses({ fromIso: new Date(now.getTime() - 120 * DAY).toISOString(), toIso: new Date(now.getTime() + 366 * DAY).toISOString() })
  const matched = (await Promise.all(classes.map(async (c) => {
    const ids = new Set((await getLedger(c.id)).lines.filter((l) => l.state !== 'released' && hit(l.customer)).map((l) => l.bookingId))
    return ids.size ? { c, ids } : null
  }))).filter((x): x is NonNullable<typeof x> => !!x)
  for (const { c, ids } of matched) {
    const { bookings } = await classBookings(c.id)
    for (const b of bookings.filter((x) => ids.has(x.bookingId))) {
      const sessions = c.sessions.filter((s) => b.sessionIds.includes(s.id))
      const first = sessions[0] ?? c.sessions[0]
      out.classes.push({
        classId: c.id, className: c.content.name, startIso: first?.startIso ?? '', endIso: (sessions[sessions.length - 1] ?? first)?.endIso ?? '',
        status: c.status, ticketTypes: c.content.ticketTypes, booking: b,
      })
    }
  }
  // Soonest first; past ones after the ones to come.
  const t = now.getTime()
  const order = (iso: string) => (Date.parse(iso) >= t ? Date.parse(iso) : Number.MAX_SAFE_INTEGER - Date.parse(iso))
  out.classes.sort((a, b) => order(a.startIso) - order(b.startIso))

  const parties = (await listParties()).filter((p: PartyRecord) => hit({ name: p.hostName, email: p.hostEmail, phone: p.hostPhone }))
  out.parties = parties.map((p): FoundParty => ({
    bookingId: p.bookingId, startIso: p.startIso, hostName: p.hostName, craftName: p.craftName, guestCount: p.guestCount,
    status: p.status === 'cancelled' ? 'cancelled' : 'booked', inSquare: p.source !== 'ours',
  })).sort((a, b) => order(a.startIso) - order(b.startIso))

  const byId = new Map(classes.map((c) => [c.id, c]))
  for (const id of await waitlistClassIds()) {
    const c = byId.get(id)
    if (!c) continue
    for (const e of (await getWaitlist(id)).entries.filter((x) => isOnList(x) && hit(x.customer))) {
      out.waitlist.push({ classId: id, className: c.content.name, startIso: c.sessions[0]?.startIso ?? '', seats: e.seats, name: `${e.customer.givenName} ${e.customer.familyName}`.trim() })
    }
  }

  out.more = out.classes.length > FIND_MAX || out.parties.length > FIND_MAX || out.waitlist.length > FIND_MAX
  out.classes = out.classes.slice(0, FIND_MAX)
  out.parties = out.parties.slice(0, FIND_MAX)
  out.waitlist = out.waitlist.slice(0, FIND_MAX)
  return out
}
