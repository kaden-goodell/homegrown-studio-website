/**
 * DEPRECATED (Jul 2026): predates the real-only catalog rebuild — the party
 * model is now seeded by scripts/seed-party.ts. Kept for reference only.
 * (Queries the dead 'kids-party'/'adult-party' categories.)
 */

import 'dotenv/config'
import { SquareCatalogProvider } from '../src/providers/square/catalog'

console.error('DEPRECATED: this script encodes the old Kids/Adult Party model. Use scripts/seed-party.ts. Set RUN_DEPRECATED=1 to force.')
if (!process.env.RUN_DEPRECATED) process.exit(1)

async function main() {
  const provider = new SquareCatalogProvider({
    accessToken: process.env.SQUARE_ACCESS_TOKEN!,
    environment: process.env.SQUARE_ENVIRONMENT as any,
    locationId: process.env.SQUARE_LOCATION_ID!,
    applicationId: process.env.SQUARE_APPLICATION_ID!,
  })

  const all = await provider.getEventTypes()
  console.log('All items:', all.length)
  for (const e of all) {
    console.log(`  ${e.name} [${e.category}] — $${e.variations[0]?.priceAmount / 100} — flow: ${e.flow}`)
  }

  console.log('\n--- kids-party filter ---')
  const kids = await provider.getEventTypes({ category: 'kids-party' })
  for (const e of kids) {
    console.log(`  ${e.name} [${e.category}]`)
  }

  console.log('\n--- adult-party filter ---')
  const adults = await provider.getEventTypes({ category: 'adult-party' })
  for (const e of adults) {
    console.log(`  ${e.name} [${e.category}]`)
  }

  console.log('\n--- workshop filter ---')
  const workshops = await provider.getEventTypes({ category: 'workshop' })
  for (const e of workshops) {
    console.log(`  ${e.name} [${e.category}] — $${e.variations[0]?.priceAmount / 100}`)
  }

  console.log('\n--- program filter ---')
  const programs = await provider.getEventTypes({ category: 'program' })
  for (const e of programs) {
    console.log(`  ${e.name} [${e.category}] — ${e.variations.length} variation(s) — enrollment: ${e.enrollmentType}`)
  }

  // Test add-ons for Kids Party
  const kidsParty = all.find(e => e.name === 'Kids Party')
  if (kidsParty) {
    console.log('\n--- add-ons for Kids Party ---')
    const addOns = await provider.getAddOns(kidsParty.id)
    for (const a of addOns) {
      console.log(`  ${a.name} — $${a.priceAmount / 100}`)
    }
  }
}

main().catch(console.error)
