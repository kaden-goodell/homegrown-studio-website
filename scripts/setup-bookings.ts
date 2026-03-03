import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: SquareEnvironment.Sandbox,
})

const LOCATION_ID = process.env.SQUARE_LOCATION_ID!

async function main() {
  // 1. Check booking profile
  console.log('=== Booking Profile ===')
  try {
    const profile = await client.bookings.businessBookingProfile.get()
    console.log('Profile:', JSON.stringify(profile, null, 2))
  } catch (e: any) {
    console.log('Profile error:', e.message || JSON.stringify(e))
  }

  // 2. Check team members
  console.log('\n=== Team Members ===')
  const team = await client.teamMembers.search({
    query: { filter: { status: 'ACTIVE', locationIds: [LOCATION_ID] } },
  })
  const members = team.teamMembers ?? []
  console.log(`Found ${members.length} active team members`)
  for (const m of members) {
    console.log(`  ${m.id} — ${m.givenName} ${m.familyName}`)
  }

  // 3. If no team members, create one
  let teamMemberId: string
  if (members.length === 0) {
    console.log('\nCreating team member...')
    const created = await client.teamMembers.create({
      idempotencyKey: crypto.randomUUID(),
      teamMember: {
        givenName: 'Studio',
        familyName: 'Host',
        emailAddress: 'host@homegrowncraftstudio.com',
        status: 'ACTIVE',
        assignedLocations: {
          assignmentType: 'EXPLICIT_LOCATIONS',
          locationIds: [LOCATION_ID],
        },
      },
    })
    teamMemberId = created.teamMember!.id!
    console.log(`Created team member: ${teamMemberId}`)
  } else {
    teamMemberId = members[0].id!
    console.log(`Using existing team member: ${teamMemberId}`)
  }

  // 4. Get all catalog items that are bookable (workshops + parties)
  console.log('\n=== Catalog Items ===')
  const items: any[] = []
  for await (const obj of await client.catalog.list({ types: 'ITEM' })) {
    items.push(obj)
  }
  console.log(`Found ${items.length} catalog items`)

  // 5. For each item's variations, check if they have serviceDuration set
  // and link them as bookable services via the team member's booking profile
  const bookableVariations: { itemId: string; variationId: string; name: string; duration: number }[] = []
  for (const item of items) {
    const itemData = item.itemData
    if (!itemData) continue
    for (const v of itemData.variations ?? []) {
      const varData = v.itemVariationData ?? {}
      const duration = varData.serviceDuration ? Number(varData.serviceDuration) / 60000 : 0
      if (duration > 0) {
        bookableVariations.push({
          itemId: item.id,
          variationId: v.id,
          name: `${itemData.name} — ${varData.name}`,
          duration,
        })
      }
    }
  }
  console.log(`Found ${bookableVariations.length} variations with serviceDuration`)
  for (const v of bookableVariations) {
    console.log(`  ${v.name} (${v.duration} min) — ${v.variationId}`)
  }

  // 6. Try to search availability to test
  if (bookableVariations.length > 0) {
    console.log('\n=== Testing Availability Search ===')
    const testVar = bookableVariations[0]
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
              serviceVariationId: testVar.variationId,
              teamMemberIdFilter: { any: [teamMemberId] },
            }],
          },
        },
      } as any)
      const slots = (avail as any).availabilities ?? []
      console.log(`Availability for "${testVar.name}": ${slots.length} slots`)
      if (slots.length > 0) {
        console.log(`  First slot: ${slots[0].startAt}`)
      }
    } catch (e: any) {
      console.log('Availability error:', e.message || JSON.stringify(e))
      console.log('\nThis likely means the team member needs booking hours set up.')
      console.log('Trying without team member filter...')
      try {
        const avail2 = await client.bookings.searchAvailability({
          query: {
            filter: {
              startAtRange: {
                startAt: new Date().toISOString(),
                endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              },
              locationId: LOCATION_ID,
              segmentFilters: [{
                serviceVariationId: testVar.variationId,
              }],
            },
          },
        } as any)
        const slots2 = (avail2 as any).availabilities ?? []
        console.log(`Availability (no team filter): ${slots2.length} slots`)
      } catch (e2: any) {
        console.log('Still failing:', e2.message || JSON.stringify(e2))
      }
    }
  }

  // 7. Check if items need serviceDuration set on variations
  const missingDuration = items.filter(item => {
    const vars = item.itemData?.variations ?? []
    return vars.every((v: any) => !v.itemVariationData?.serviceDuration)
  })
  if (missingDuration.length > 0) {
    console.log(`\n=== Items Missing serviceDuration (${missingDuration.length}) ===`)
    for (const item of missingDuration) {
      console.log(`  ${item.itemData?.name}`)
    }
    console.log('\nThese items need serviceDuration on their variations to be bookable.')
  }
}

main().catch(console.error)
