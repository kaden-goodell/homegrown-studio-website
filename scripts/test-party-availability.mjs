import { SquareClient, SquareEnvironment } from 'square'
import { readFileSync } from 'node:fs'
const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN, environment: SquareEnvironment.Production })
const ids = JSON.parse(readFileSync(new URL('./.test-data-ids.json', import.meta.url)))
const loc = process.env.SQUARE_LOCATION_ID
const TEAM = ['TMeIN-kxF-ZVhTVj', 'TMnRaFgOE4r0ip7o']

async function tryAvail(label, segmentFilters) {
  try {
    const r = await client.bookings.searchAvailability({
      query: { filter: {
        startAtRange: { startAt: '2026-08-06T00:00:00Z', endAt: '2026-08-10T05:00:00Z' },
        locationId: loc, segmentFilters,
      } },
    })
    const a = r.availabilities ?? []
    console.log(`${label}: ${a.length} slots`)
    for (const s of a.slice(0, 8)) console.log('   ', s.startAt, `(${s.appointmentSegments?.[0]?.durationMinutes}min, tm=${s.appointmentSegments?.[0]?.teamMemberId?.slice(-4)})`)
    return a.length
  } catch (e) { console.log(`${label}: ERROR`, e.message); return 0 }
}

console.log('Party variation:', ids.partyVariation)
await tryAvail('with team filter', [{ serviceVariationId: ids.partyVariation, teamMemberIdFilter: { any: TEAM } }])
await tryAvail('no team filter', [{ serviceVariationId: ids.partyVariation }])
