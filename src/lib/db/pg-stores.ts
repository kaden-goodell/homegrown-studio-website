/**
 * The stores whose "write only if unchanged" decides money or seats, and so
 * live in Postgres (kv_store), not Netlify Blobs (Kaden, 16 Nov 2026: two
 * simultaneous blob writes could both win). Everything else stays in blobs.
 *
 * All of these belong to the own booking system: none exists on the live
 * Square-era site, so production has nothing in them to carry over.
 */
export const PG_STORES: ReadonlySet<string> = new Set([
  'seat-ledger', // class seats: holds + paid seats vs capacity
  'party-book', // party times: holds + booked
  'party-locks', // one change per party at a time (lease)
  'party-checkouts', // a party checkout attempt (guards a double charge)
  'party-payments', // party payments filed under a party
  'waitlists', // waitlist entries and their charging state
  'refund-requests', // refunds asked for (caps per seat/booking)
  'promo-uses', // promo code uses and reservations (limits)
  'class-cancels', // customers' self-cancel attempts (one refund)
  'reader-orders', // card-reader sales in flight
  'reader-sales',
  'paid-not-seated', // Square payments with no seat yet
  'paid-on-cancelled', // payments that landed on a cancelled class
  'refund-flags', // Square refund bookkeeping
  'refund-replacements',
  'quotes', // private-event quotes: pick, pay, save and withdraw race
])
