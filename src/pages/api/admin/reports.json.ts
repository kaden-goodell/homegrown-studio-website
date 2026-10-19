import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { listClasses } from '@lib/classes/class-store'
import { getLedger, type Ledger } from '@lib/classes/seat-ledger'
import { listParties, type PartyRecord } from '@lib/party-store'
import { localDate } from '@lib/party-slots'

export const prerender = false

export interface MonthReport {
  /** "2026-10", studio time. */
  month: string
  /** Seats on our classes booked this month (online, door, counter, comp, POS), refunded ones included. */
  seatsSold: number
  /** What those seats were paid, tax and extras included, in cents. */
  classSalesCents: number
  /** Refunds on our classes made this month: how many, and how much. */
  refunds: number
  refundedCents: number
  /** Parties booked on the website this month (by the day they were booked). */
  partiesBooked: number
}

const inMonth = (iso: string, month: string) => localDate(iso).slice(0, 7) === month

/** The month's numbers from our own records. Pure, for the route and its tests. */
export function monthReport(ledgers: Ledger[], parties: PartyRecord[], now: Date): MonthReport {
  const month = localDate(now.toISOString()).slice(0, 7)
  let seatsSold = 0, classSalesCents = 0, refunds = 0, refundedCents = 0
  for (const ledger of ledgers) {
    for (const l of ledger.lines) {
      if ((l.state === 'confirmed' || l.state === 'refunded') && inMonth(l.at, month)) {
        seatsSold += 1
        classSalesCents += l.priceCents + l.taxCents + l.addOnCents + l.addOnTaxCents
      }
      for (const r of l.refunds) {
        if (r.cents > 0 && inMonth(r.at, month)) { refunds += 1; refundedCents += r.cents }
      }
    }
  }
  const partiesBooked = parties.filter((p) => inMonth(p.createdAt, month)).length
  return { month, seatsSold, classSalesCents, refunds, refundedCents, partiesBooked }
}

/**
 * GET: this month so far (studio time) for /admin › More › Reports: class
 * seats sold, class sales, refunds, and parties booked. Only what our own
 * records hold: Craft Café, party payments and anything else rung up in
 * Square are in Square's reports. Owners only.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  try {
    const [classes, parties] = await Promise.all([listClasses(), listParties()])
    const ledgers = await Promise.all(classes.map((c) => getLedger(c.id)))
    return json(200, { data: monthReport(ledgers, parties, new Date()) })
  } catch (e) {
    console.error(`[admin/reports] ${e instanceof Error ? e.message : e}`)
    return json(503, { error: "The numbers couldn't be loaded. Try again." })
  }
}
