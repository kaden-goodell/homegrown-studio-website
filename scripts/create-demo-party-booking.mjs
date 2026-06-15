// Creates ONE demo party booking (Sat Aug 8, 12pm) so the calendar shows a "Reserved" slot.
// No payment — just the booking object. Booking id saved for teardown.
// Run: node --env-file=.env scripts/create-demo-party-booking.mjs
import { SquareClient, SquareEnvironment } from 'square'
import { readFileSync, writeFileSync } from 'node:fs'

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN, environment: SquareEnvironment.Production })
const loc = process.env.SQUARE_LOCATION_ID
const idsPath = new URL('./.test-data-ids.json', import.meta.url)
const ids = JSON.parse(readFileSync(idsPath))
const log = (...a) => console.log(...a)

// cancel any existing booking on the target slot (avoid duplicates on re-run)
try {
  const existing = await client.bookings.list({ locationId: loc, startAtMin: '2026-08-08T16:00:00Z', startAtMax: '2026-08-08T18:00:00Z' })
  for (const b of (existing.bookings ?? [])) {
    if (b.status !== 'CANCELLED_BY_CUSTOMER' && b.status !== 'CANCELLED_BY_SELLER') {
      await client.bookings.cancel({ bookingId: b.id, bookingVersion: b.version })
      log('cancelled prior booking:', b.id)
    }
  }
} catch (e) { log('cleanup skip:', e.message) }

// current variation version
const got = await client.catalog.object.get({ objectId: ids.partyItem })
const variation = (got.object ?? got).itemData.variations[0]
const variationId = variation.id
const version = variation.version

// test customer
const cust = await client.customers.create({
  idempotencyKey: 'hgs-demo-party-customer',
  givenName: 'TEST', familyName: 'Reserved Party', emailAddress: 'demo-party@example.com',
})
const customerId = (cust.customer ?? cust).id
log('customer:', customerId)

// booking at 12pm CDT = 17:00Z on Sat Aug 8
const booking = await client.bookings.create({
  booking: {
    startAt: '2026-08-08T17:00:00Z',
    locationId: loc,
    customerId,
    appointmentSegments: [{
      serviceVariationId: variationId,
      serviceVariationVersion: BigInt(version),
      teamMemberId: ids.square?.defaultTeamMemberId ?? 'TMeIN-kxF-ZVhTVj',
      durationMinutes: 120,
    }],
  },
})
const bk = booking.booking ?? booking
log('✓ booking created:', bk.id, bk.startAt, bk.status)

// mark it as a party so the calendar's listBookings filter picks it up
await client.bookings.customAttributes.batchUpsert({
  values: {
    event_type: { bookingId: bk.id, customAttribute: { value: 'party' } },
    guest_count: { bookingId: bk.id, customAttribute: { value: '12' } },
  },
})
log('✓ tagged event_type=party')

ids.demoBookingId = bk.id
ids.demoBookingVersion = Number(bk.version ?? 0)
writeFileSync(idsPath, JSON.stringify(ids, null, 2))
log('saved demoBookingId for teardown')
