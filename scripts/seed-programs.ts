/**
 * Seed Square Catalog with program items and required custom attribute definitions.
 *
 * Usage:
 *   npx tsx scripts/seed-programs.ts
 *
 * Creates: program category, custom attribute definitions, and 3 program items.
 * Uses .env for credentials (should be pointing at production).
 */

import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

const token = process.env.SQUARE_ACCESS_TOKEN!
const env = process.env.SQUARE_ENVIRONMENT === 'production'
  ? SquareEnvironment.Production
  : SquareEnvironment.Sandbox
const locationId = process.env.SQUARE_LOCATION_ID!

if (!token || !locationId) {
  console.error('Missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID in env')
  process.exit(1)
}

const client = new SquareClient({ token, environment: env })

console.log(`Seeding programs in ${process.env.SQUARE_ENVIRONMENT ?? 'sandbox'}...\n`)

let counter = 0
function tempId(prefix: string) {
  return `#${prefix}-${++counter}`
}

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------
const programCategoryId = tempId('cat')
const categoryObject = {
  type: 'CATEGORY' as const,
  id: programCategoryId,
  categoryData: { name: 'program' },
}

// ---------------------------------------------------------------------------
// Custom attribute definitions (needed for program metadata)
// ---------------------------------------------------------------------------
const customAttrDefs = [
  { key: 'flow', name: 'Flow Type', type: 'STRING' },
  { key: 'enrollmentType', name: 'Enrollment Type', type: 'STRING' },
  { key: 'ageMin', name: 'Age Min', type: 'NUMBER' },
  { key: 'ageMax', name: 'Age Max', type: 'NUMBER' },
  { key: 'scheduleDays', name: 'Schedule Days', type: 'STRING' },
  { key: 'scheduleTime', name: 'Schedule Time', type: 'STRING' },
  { key: 'totalHours', name: 'Total Hours', type: 'NUMBER' },
  { key: 'instructorEmail', name: 'Instructor Email', type: 'STRING' },
  { key: 'pricePerHead', name: 'Price Per Head', type: 'NUMBER' },
  { key: 'maxCapacity', name: 'Max Capacity', type: 'NUMBER' },
]

const customAttrObjects = customAttrDefs.map((def) => ({
  type: 'CUSTOM_ATTRIBUTE_DEFINITION' as const,
  id: tempId('attr'),
  customAttributeDefinitionData: {
    type: def.type,
    name: def.name,
    key: def.key,
    allowedObjectTypes: ['ITEM'],
    sellerVisibility: 'SELLER_VISIBILITY_READ_WRITE_VALUES',
  },
}))

// ---------------------------------------------------------------------------
// Program items
// ---------------------------------------------------------------------------
interface ProgramDef {
  name: string
  description: string
  durationMinutes: number
  variations: { name: string; priceAmount: number; startDate: string; endDate: string }[]
  customAttrs: Record<string, string | number>
}

function buildProgramItem(def: ProgramDef) {
  const id = tempId('item')
  return {
    type: 'ITEM' as const,
    id,
    customAttributeValues: {
      flow: { stringValue: 'booking' },
      ...Object.fromEntries(
        Object.entries(def.customAttrs).map(([k, v]) => [
          k,
          typeof v === 'number' ? { numberValue: String(v) } : { stringValue: v },
        ]),
      ),
    },
    itemData: {
      name: def.name,
      description: def.description,
      categories: [{ id: programCategoryId }],
      variations: def.variations.map((v) => ({
        type: 'ITEM_VARIATION' as const,
        id: tempId('var'),
        itemVariationData: {
          name: v.name,
          pricingType: 'FIXED_PRICING',
          priceMoney: { amount: BigInt(v.priceAmount), currency: 'USD' },
          serviceDuration: BigInt(def.durationMinutes * 60000),
          locationOverrides: [{ locationId, trackInventory: false }],
          customAttributeValues: {
            startDate: { stringValue: v.startDate },
            endDate: { stringValue: v.endDate },
          },
        },
      })),
    },
  }
}

const programs: ProgramDef[] = [
  {
    name: 'Summer Art Camp',
    description: 'A week of creative exploration for kids ages 6-12! Each day features a different art medium — pottery, painting, printmaking, and mixed media collage.',
    durationMinutes: 210,
    variations: [
      { name: 'Week 1 (Jun 8-11)', priceAmount: 22500, startDate: '2026-06-08', endDate: '2026-06-11' },
      { name: 'Week 2 (Jun 15-18)', priceAmount: 22500, startDate: '2026-06-15', endDate: '2026-06-18' },
      { name: 'Week 3 (Jun 22-25)', priceAmount: 22500, startDate: '2026-06-22', endDate: '2026-06-25' },
      { name: 'Week 4 (Jun 29-Jul 2)', priceAmount: 22500, startDate: '2026-06-29', endDate: '2026-07-02' },
    ],
    customAttrs: {
      enrollmentType: 'per-session',
      ageMin: 6,
      ageMax: 12,
      scheduleDays: 'Mon–Thu',
      scheduleTime: '9:00 AM – 12:30 PM',
      totalHours: 3.5,
      pricePerHead: 22500,
      maxCapacity: 12,
      instructorEmail: 'instructor@homegrowncraftstudio.com',
    },
  },
  {
    name: 'Homeschool Studio Days',
    description: 'A semester-long art enrichment program designed specifically for homeschool families. Every Wednesday, students dive deep into a rotating curriculum.',
    durationMinutes: 180,
    variations: [
      { name: 'Spring 2026 Semester', priceAmount: 45000, startDate: '2026-01-15', endDate: '2026-04-22' },
    ],
    customAttrs: {
      enrollmentType: 'full',
      ageMin: 7,
      ageMax: 14,
      scheduleDays: 'Wednesdays',
      scheduleTime: '10:00 AM – 1:00 PM',
      totalHours: 3,
      pricePerHead: 45000,
      maxCapacity: 10,
      instructorEmail: 'instructor@homegrowncraftstudio.com',
    },
  },
  {
    name: 'Winter Break Camp',
    description: 'Keep the creativity alive over winter break! This camp runs Monday through Thursday each week with a cozy, festive theme.',
    durationMinutes: 180,
    variations: [
      { name: 'Week 1 (Dec 21-24)', priceAmount: 17500, startDate: '2026-12-21', endDate: '2026-12-24' },
      { name: 'Week 2 (Dec 28-31)', priceAmount: 17500, startDate: '2026-12-28', endDate: '2026-12-31' },
    ],
    customAttrs: {
      enrollmentType: 'per-session',
      ageMin: 5,
      ageMax: 12,
      scheduleDays: 'Mon–Thu',
      scheduleTime: '9:00 AM – 12:00 PM',
      totalHours: 3,
      pricePerHead: 17500,
      maxCapacity: 12,
      instructorEmail: 'instructor@homegrowncraftstudio.com',
    },
  },
]

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------
async function seed() {
  const allObjects: any[] = [
    categoryObject,
    ...customAttrObjects,
    ...programs.map(buildProgramItem),
  ]

  console.log(`Creating 1 category (program)`)
  console.log(`Creating ${customAttrObjects.length} custom attribute definitions`)
  console.log(`Creating ${programs.length} program items`)
  console.log(`Total objects: ${allObjects.length}\n`)

  try {
    const response = await client.catalog.batchUpsert({
      idempotencyKey: crypto.randomUUID(),
      batches: [{ objects: allObjects }],
    })

    const mapped = (response as any).idMappings ?? []
    console.log(`Success! ${mapped.length} objects created.\n`)

    console.log('ID Mappings:')
    for (const m of mapped) {
      console.log(`  ${m.clientObjectId} → ${m.objectId}`)
    }

    // Verify
    console.log('\nVerifying programs...')
    const items: any[] = []
    for await (const item of await client.catalog.list({ types: 'ITEM' }) as any) {
      items.push(item)
    }
    const programItems = items.filter((i: any) =>
      i.itemData?.categories?.some((c: any) => {
        // Check if this is our program category by checking the mapped ID
        return mapped.some((m: any) => m.clientObjectId === programCategoryId && m.objectId === c.id)
      })
    )
    console.log(`Found ${programItems.length} program items:`)
    for (const item of programItems) {
      const vars = item.itemData?.variations?.length ?? 0
      const attrs = Object.keys(item.customAttributeValues ?? {})
      console.log(`  - ${item.itemData?.name} (${vars} variations, attrs: [${attrs.join(', ')}])`)
    }
  } catch (err: any) {
    console.error('Failed to seed programs:', err.message)
    if (err.errors) {
      for (const e of err.errors) {
        console.error(`  ${e.category}: ${e.code} — ${e.detail}`)
      }
    }
    process.exit(1)
  }
}

seed()
