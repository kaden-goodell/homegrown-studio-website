import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'
import { partyConfig } from '../src/config/party.config'
import { partyStartsInRange, bookableDates, localToUtcISO } from '../src/lib/party-slots'

/**
 * Compare the party times the site offers with the times Square's own
 * calendar says are free. Read-only: it books nothing and changes nothing.
 *
 * Usage:
 *   npx tsx scripts/compare-party-availability.ts
 */

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN!, environment: SquareEnvironment.Production })
const locationId = process.env.SQUARE_LOCATION_ID!

const label = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: partyConfig.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

async function main() {
  const got: any = await client.catalog.object.get({ objectId: partyConfig.square.catalogItemId })
  const item = got?.object ?? got
  const variation = item?.itemData?.variations?.[0]
  console.log('Party service:', item?.itemData?.name)
  console.log('  available for booking:', variation?.itemVariationData?.availableForBooking)
  console.log('  service duration (ms):', String(variation?.itemVariationData?.serviceDuration))
  console.log('  team members:', variation?.itemVariationData?.teamMemberIds)

  const { first, last } = bookableDates()
  console.log(`\nSite window: ${first} to ${last}`)
  const from = localToUtcISO(first, '00:00')
  const to = localToUtcISO(last, '23:59')
  const offered = partyStartsInRange(from, to)

  // Square answers at most 32 days per question.
  const free = new Set<string>()
  const DAY = 86_400_000
  for (let t = new Date(from).getTime(); t < new Date(to).getTime(); t += 31 * DAY) {
    const end = new Date(Math.min(t + 31 * DAY, new Date(to).getTime())).toISOString()
    const r: any = await client.bookings.searchAvailability({
      query: { filter: { startAtRange: { startAt: new Date(t).toISOString(), endAt: end }, locationId, segmentFilters: [{ serviceVariationId: variation.id }] } },
    })
    for (const a of r.availabilities ?? []) free.add(new Date(a.startAt).toISOString())
  }
  console.log(`Site offers ${offered.length} starts; Square lists ${free.size} free starts in the same span.\n`)
  for (const s of offered) console.log(`  ${free.has(new Date(s).toISOString()) ? 'free in Square  ' : 'NOT free in Square'}  ${label(s)}`)

  const days = new Map<string, number>()
  for (const s of free) { const d = label(s).split(',').slice(0, 2).join(','); days.set(d, (days.get(d) ?? 0) + 1) }
  console.log('\nSquare free starts per day:')
  for (const [d, n] of days) console.log(`  ${d}: ${n}`)
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
