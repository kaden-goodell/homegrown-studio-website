/**
 * Seed Square Catalog with all event types from mock data.
 *
 * Usage:
 *   npx tsx scripts/seed-catalog.ts          # uses .env defaults
 *   SQUARE_ENVIRONMENT=production npx tsx scripts/seed-catalog.ts  # target prod
 *
 * Creates: categories, items with variations, modifier lists (add-ons),
 * and custom attribute definitions for program/party metadata.
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

console.log(`Seeding catalog in ${process.env.SQUARE_ENVIRONMENT ?? 'sandbox'}...\n`)

// ---------------------------------------------------------------------------
// Helper: generate idempotency-safe IDs (prefixed so we can find them later)
// ---------------------------------------------------------------------------
let counter = 0
function tempId(prefix: string) {
  return `#${prefix}-${++counter}`
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
const categories = [
  { name: 'birthday', tempId: tempId('cat') },
  { name: 'party', tempId: tempId('cat') },
  { name: 'corporate', tempId: tempId('cat') },
  { name: 'kids-party', tempId: tempId('cat') },
  { name: 'adult-party', tempId: tempId('cat') },
  { name: 'workshop', tempId: tempId('cat') },
  { name: 'program', tempId: tempId('cat') },
]

const categoryObjects = categories.map((c) => ({
  type: 'CATEGORY' as const,
  id: c.tempId,
  categoryData: { name: c.name },
}))

function catRef(name: string) {
  const cat = categories.find((c) => c.name === name)
  return cat ? { id: cat.tempId } : undefined
}

// ---------------------------------------------------------------------------
// Custom attribute definitions (for program/event metadata)
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
// Modifier lists (add-ons) — shared per party category
// ---------------------------------------------------------------------------
const kidsAddOns = {
  tempId: tempId('modlist'),
  name: 'Kids Party Add-Ons',
  modifiers: [
    { name: 'Extra Child', price: 2500 },
    { name: 'Goodie Bags', price: 800 },
    { name: 'Extra Craft Activity', price: 1200 },
    { name: 'Chocolate Fountain', price: 7500 },
    { name: 'Balloon Arch', price: 5000 },
    { name: 'Extra 30 Minutes', price: 10000 },
  ],
}

const adultAddOns = {
  tempId: tempId('modlist'),
  name: 'Adult Party Add-Ons',
  modifiers: [
    { name: 'Extra Guest', price: 3000 },
    { name: 'Premium Materials Upgrade', price: 1000 },
    { name: 'Chocolate Fountain', price: 7500 },
    { name: 'Balloon Arch', price: 5000 },
    { name: 'Extra 30 Minutes', price: 10000 },
  ],
}

const modifierListObjects = [kidsAddOns, adultAddOns].map((ml) => ({
  type: 'MODIFIER_LIST' as const,
  id: ml.tempId,
  modifierListData: {
    name: ml.name,
    selectionType: 'MULTIPLE',
    modifiers: ml.modifiers.map((m) => ({
      type: 'MODIFIER' as const,
      id: tempId('mod'),
      modifierData: {
        name: m.name,
        priceMoney: { amount: BigInt(m.price), currency: 'USD' },
      },
    })),
  },
}))

// ---------------------------------------------------------------------------
// Helper: build a catalog ITEM object
// ---------------------------------------------------------------------------
interface ItemDef {
  name: string
  description: string
  category: string
  durationMinutes: number
  variations: { name: string; priceAmount: number; startDate?: string; endDate?: string }[]
  modifierListId?: string
  flow?: 'booking' | 'quote'
  customAttrs?: Record<string, string | number>
}

function buildItem(def: ItemDef) {
  const id = tempId('item')
  const cat = catRef(def.category)

  return {
    type: 'ITEM' as const,
    id,
    customAttributeValues: {
      ...(def.flow && { flow: { stringValue: def.flow } }),
      ...Object.fromEntries(
        Object.entries(def.customAttrs ?? {}).map(([k, v]) => [
          k,
          typeof v === 'number' ? { numberValue: String(v) } : { stringValue: v },
        ]),
      ),
    },
    itemData: {
      name: def.name,
      description: def.description,
      categories: cat ? [cat] : [],
      variations: def.variations.map((v) => ({
        type: 'ITEM_VARIATION' as const,
        id: tempId('var'),
        itemVariationData: {
          name: v.name,
          pricingType: 'FIXED_PRICING',
          priceMoney: { amount: BigInt(v.priceAmount), currency: 'USD' },
          serviceDuration: BigInt(def.durationMinutes * 60000),
          locationOverrides: [{ locationId, trackInventory: false }],
          ...(v.startDate && {
            customAttributeValues: {
              startDate: { stringValue: v.startDate },
              endDate: { stringValue: v.endDate },
            },
          }),
        },
      })),
      ...(def.modifierListId && {
        modifierListInfo: [
          { modifierListId: def.modifierListId, enabled: true },
        ],
      }),
    },
  }
}

// ---------------------------------------------------------------------------
// All items from mock data
// ---------------------------------------------------------------------------
const items: ItemDef[] = [
  // === Party category items (for add-on lookup) ===
  {
    name: 'Kids Party',
    description: 'Celebrate your child\'s special day with a hands-on craft birthday party at Homegrown Studio! Each guest creates two custom art projects guided by a dedicated party host.',
    category: 'birthday',
    durationMinutes: 120,
    variations: [{ name: 'Base Package (up to 12 kids)', priceAmount: 40000 }],
    modifierListId: kidsAddOns.tempId,
    flow: 'booking',
  },
  {
    name: 'Adult Workshop Party',
    description: 'Gather your friends for a private craft night at Homegrown Studio! A dedicated instructor guides you step by step, so no experience is needed. Complimentary wine, beer, and a charcuterie spread are included.',
    category: 'party',
    durationMinutes: 150,
    variations: [{ name: 'Base Package (up to 12 guests)', priceAmount: 40000 }],
    modifierListId: adultAddOns.tempId,
    flow: 'booking',
  },
  {
    name: 'Corporate Team Building',
    description: 'Build stronger teams through shared creativity. We accommodate groups of 10-50 and can customize the experience for your timeframe, budget, and objectives.',
    category: 'corporate',
    durationMinutes: 180,
    variations: [{ name: 'Custom Quote', priceAmount: 0 }],
    flow: 'quote',
  },

  // === Kids party types ===
  {
    name: 'Slime Party',
    description: 'Gooey, glittery, totally messy fun! Kids make custom slime creations with mix-ins like foam beads, glitter, and scented oils. Each guest takes home their own slime jar.',
    category: 'kids-party',
    durationMinutes: 120,
    variations: [{ name: 'Base Package', priceAmount: 40000 }],
    flow: 'booking',
    customAttrs: { maxCapacity: 20 },
  },
  {
    name: 'Painting Party',
    description: 'Canvas painting with guided instruction — each guest creates their own masterpiece to take home. Choose from our gallery of kid-friendly designs or request a custom theme.',
    category: 'kids-party',
    durationMinutes: 120,
    variations: [{ name: 'Base Package', priceAmount: 40000 }],
    flow: 'booking',
    customAttrs: { maxCapacity: 20 },
  },
  {
    name: 'Pottery Party',
    description: 'Hand-building with air-dry clay — kids sculpt bowls, animals, and imaginative creations. Each piece is painted and sealed to take home the same day.',
    category: 'kids-party',
    durationMinutes: 120,
    variations: [{ name: 'Base Package', priceAmount: 40000 }],
    flow: 'booking',
    customAttrs: { maxCapacity: 20 },
  },
  {
    name: 'Jewelry Making Party',
    description: 'Beaded bracelets, necklaces, and keychains — kids design and assemble their own wearable art using colorful beads, charms, and cord.',
    category: 'kids-party',
    durationMinutes: 120,
    variations: [{ name: 'Base Package', priceAmount: 40000 }],
    flow: 'booking',
    customAttrs: { maxCapacity: 20 },
  },

  // === Adult party types ===
  {
    name: 'Pottery Party',
    description: 'Wheel throwing and hand-building — your group creates functional pottery pieces like mugs, bowls, and vases. Pieces are kiln-fired and ready for pickup in two weeks.',
    category: 'adult-party',
    durationMinutes: 150,
    variations: [{ name: 'Base Package', priceAmount: 40000 }],
    flow: 'booking',
    customAttrs: { maxCapacity: 36 },
  },
  {
    name: 'Candle Making Party',
    description: 'Custom scented soy candles — choose from 30+ fragrance oils to create your signature blend. Each guest makes two candles in their choice of vessel.',
    category: 'adult-party',
    durationMinutes: 150,
    variations: [{ name: 'Base Package', priceAmount: 40000 }],
    flow: 'booking',
    customAttrs: { maxCapacity: 36 },
  },
  {
    name: 'Knitting Party',
    description: 'Learn to knit with wine and snacks — a relaxed evening of fiber arts. Beginners welcome! Each guest starts a scarf or cowl project to take home.',
    category: 'adult-party',
    durationMinutes: 150,
    variations: [{ name: 'Base Package', priceAmount: 40000 }],
    flow: 'booking',
    customAttrs: { maxCapacity: 36 },
  },
  {
    name: 'Watercolor Party',
    description: 'Guided watercolor painting session — no experience needed. Your group paints a beautiful botanical or landscape piece with step-by-step instruction.',
    category: 'adult-party',
    durationMinutes: 150,
    variations: [{ name: 'Base Package', priceAmount: 40000 }],
    flow: 'booking',
    customAttrs: { maxCapacity: 36 },
  },

  // === Workshops ===
  {
    name: 'Hand-Built Pottery',
    description: 'Discover the meditative art of hand-building with clay in this immersive two-hour workshop. You\'ll learn three foundational techniques — pinch pots, coil vessels, and slab construction — and create two finished pieces to take home.',
    category: 'workshop',
    durationMinutes: 120,
    variations: [{ name: 'Single Seat', priceAmount: 6500 }],
    flow: 'booking',
  },
  {
    name: 'Soy Candle Making',
    description: 'Create two beautiful hand-poured soy candles with your own custom scent blends in this relaxing 90-minute workshop.',
    category: 'workshop',
    durationMinutes: 90,
    variations: [{ name: 'Single Seat', priceAmount: 4500 }],
    flow: 'booking',
  },
  {
    name: 'Modern Macrame',
    description: 'Learn the art of modern macrame and create a stunning wall hanging to display in your home. This 2.5-hour workshop covers essential knots woven into a contemporary geometric design.',
    category: 'workshop',
    durationMinutes: 150,
    variations: [{ name: 'Single Seat', priceAmount: 7500 }],
    flow: 'booking',
  },
  {
    name: 'Watercolor Basics',
    description: 'Dive into the luminous world of watercolor painting in this beginner-friendly two-hour session. You\'ll learn fundamental techniques while painting a beautiful botanical subject.',
    category: 'workshop',
    durationMinutes: 120,
    variations: [{ name: 'Single Seat', priceAmount: 5500 }],
    flow: 'booking',
  },

  // === Programs ===
  {
    name: 'Summer Art Camp',
    description: 'A week of creative exploration for kids ages 6-12! Each day features a different art medium — pottery, painting, printmaking, and mixed media collage.',
    category: 'program',
    durationMinutes: 210,
    variations: [
      { name: 'Week 1 (Jun 8-11)', priceAmount: 22500, startDate: '2026-06-08', endDate: '2026-06-11' },
      { name: 'Week 2 (Jun 15-18)', priceAmount: 22500, startDate: '2026-06-15', endDate: '2026-06-18' },
      { name: 'Week 3 (Jun 22-25)', priceAmount: 22500, startDate: '2026-06-22', endDate: '2026-06-25' },
      { name: 'Week 4 (Jun 29-Jul 2)', priceAmount: 22500, startDate: '2026-06-29', endDate: '2026-07-02' },
    ],
    flow: 'booking',
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
    category: 'program',
    durationMinutes: 180,
    variations: [
      { name: 'Spring 2026 Semester', priceAmount: 45000, startDate: '2026-01-15', endDate: '2026-04-22' },
    ],
    flow: 'booking',
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
    category: 'program',
    durationMinutes: 180,
    variations: [
      { name: 'Week 1 (Dec 21-24)', priceAmount: 17500, startDate: '2026-12-21', endDate: '2026-12-24' },
      { name: 'Week 2 (Dec 28-31)', priceAmount: 17500, startDate: '2026-12-28', endDate: '2026-12-31' },
    ],
    flow: 'booking',
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
// Build and send the batch upsert
// ---------------------------------------------------------------------------
async function seed() {
  const allObjects: any[] = [
    ...categoryObjects,
    ...customAttrObjects,
    ...modifierListObjects,
    ...items.map(buildItem),
  ]

  console.log(`Creating ${categoryObjects.length} categories`)
  console.log(`Creating ${customAttrObjects.length} custom attribute definitions`)
  console.log(`Creating ${modifierListObjects.length} modifier lists`)
  console.log(`Creating ${items.length} catalog items`)
  console.log(`Total objects: ${allObjects.length}\n`)

  try {
    const response = await client.catalog.batchUpsert({
      idempotencyKey: crypto.randomUUID(),
      batches: [
        {
          objects: allObjects,
        },
      ],
    })

    const mapped = (response as any).idMappings ?? []
    console.log(`Success! ${mapped.length} objects created.\n`)

    // Print ID mappings for reference
    console.log('ID Mappings:')
    for (const m of mapped) {
      console.log(`  ${m.clientObjectId} → ${m.objectId}`)
    }

    // Verify by listing items
    console.log('\nVerifying...')
    const verifyItems: any[] = []
    for await (const item of client.catalog.list({ types: 'ITEM' }) as any) {
      verifyItems.push(item)
    }
    console.log(`Catalog now has ${verifyItems.length} items:`)
    for (const item of verifyItems) {
      const cat = item.itemData?.categories?.[0]?.name ?? '(no category)'
      const vars = item.itemData?.variations?.length ?? 0
      console.log(`  - ${item.itemData?.name} [${cat}] (${vars} variation${vars !== 1 ? 's' : ''})`)
    }
  } catch (err: any) {
    console.error('Failed to seed catalog:', err.message)
    if (err.errors) {
      for (const e of err.errors) {
        console.error(`  ${e.category}: ${e.code} — ${e.detail}`)
      }
    }
    process.exit(1)
  }
}

seed()
