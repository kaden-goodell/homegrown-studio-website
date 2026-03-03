import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: SquareEnvironment.Sandbox,
})

const LOCATION_ID = process.env.SQUARE_LOCATION_ID!
const TEAM_MEMBER_ID = 'TM7rNYg3S4RwQ2Ma' // Sandbox Seller

async function main() {
  // Get all our catalog items
  const items: any[] = []
  for await (const obj of await client.catalog.list({ types: 'ITEM' })) {
    // Skip the default Square Appointments items (haircuts etc.)
    const name = obj.itemData?.name ?? ''
    if (['Women\'s haircut', 'Color treatment', 'Men\'s haircut', 'Shampoo style'].includes(name)) {
      continue
    }
    items.push(obj)
  }
  console.log(`Found ${items.length} items to make bookable`)

  // Update each item to be an APPOINTMENTS_SERVICE with team member assignment
  const batches: any[] = []
  const batchObjects: any[] = []

  for (const item of items) {
    const variations = (item.itemData?.variations ?? []).map((v: any) => ({
      ...v,
      itemVariationData: {
        ...v.itemVariationData,
        // Assign team member to each variation
        teamMemberIds: [TEAM_MEMBER_ID],
        // Ensure it's available at our location
        availableForBooking: true,
      },
      presentAtLocationIds: [LOCATION_ID],
    }))

    batchObjects.push({
      type: 'ITEM',
      id: item.id,
      version: item.version,
      presentAtLocationIds: [LOCATION_ID],
      itemData: {
        ...item.itemData,
        productType: 'APPOINTMENTS_SERVICE',
        variations,
      },
    })
  }

  // Batch upsert in chunks of 1000
  for (let i = 0; i < batchObjects.length; i += 1000) {
    batches.push({ objects: batchObjects.slice(i, i + 1000) })
  }

  console.log(`Updating ${batchObjects.length} items in ${batches.length} batch(es)...`)

  const result = await client.catalog.batchUpsert({
    idempotencyKey: crypto.randomUUID(),
    batches,
  })

  const updated = (result as any).objects ?? []
  console.log(`Updated ${updated.length} catalog objects`)

  // Now test availability
  console.log('\n=== Testing Availability ===')
  const testItem = items[0]
  const testVarId = testItem.itemData?.variations?.[0]?.id
  console.log(`Testing: ${testItem.itemData?.name} — ${testVarId}`)

  try {
    const avail = await client.bookings.searchAvailability({
      query: {
        filter: {
          startAtRange: {
            startAt: new Date().toISOString(),
            endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          },
          locationId: LOCATION_ID,
          segmentFilters: [{
            serviceVariationId: testVarId,
            teamMemberIdFilter: { any: [TEAM_MEMBER_ID] },
          }],
        },
      },
    } as any)
    const slots = (avail as any).availabilities ?? []
    console.log(`Found ${slots.length} availability slots!`)
    for (const s of slots.slice(0, 5)) {
      console.log(`  ${s.startAt}`)
    }
    if (slots.length > 5) console.log(`  ... and ${slots.length - 5} more`)
  } catch (e: any) {
    console.log('Availability error:', e.message || JSON.stringify(e))
  }
}

main().catch(console.error)
