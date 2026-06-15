// Creates TEST dummy data in Square for the Open Studio + Party prototype.
// All objects are prefixed "TEST —" and their IDs saved to scripts/.test-data-ids.json
// Run:  node --env-file=.env scripts/test-data-setup.mjs
// Wipe: node --env-file=.env scripts/test-data-teardown.mjs
import { SquareClient, SquareEnvironment } from 'square'
import { writeFileSync } from 'node:fs'

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN, environment: SquareEnvironment.Production })
const TEAM = ['TMeIN-kxF-ZVhTVj', 'TMnRaFgOE4r0ip7o'] // Kaden, Catherine
const log = (...a) => console.log(...a)

// Open Studio week-1 windows (open -> 6pm), encoded as YYYY-MM-DDTHH:MM-HH:MM
const OPEN_STUDIO_DATES = [
  '2026-07-31T16:00-18:00', // Fri (grand opening) 4-6pm
  '2026-08-01T09:00-18:00', // Sat 9am-6pm
  '2026-08-02T14:00-18:00', // Sun 2-6pm
].join(',')

// Craft choices — per-head price varies by craft
const CRAFTS = [
  { name: 'Candle Making', cents: 2500 },
  { name: 'Pottery Painting', cents: 3500 },
  { name: 'Watercolor', cents: 2000 },
  { name: 'Macrame Wall Hanging', cents: 3000 },
]

const objects = [
  { type: 'CATEGORY', id: '#cat_os', categoryData: { name: 'TEST — Open Studio' } },
  { type: 'CATEGORY', id: '#cat_party', categoryData: { name: 'TEST — Party' } },
  {
    type: 'MODIFIER_LIST', id: '#craft',
    modifierListData: {
      name: 'TEST — Craft Choice', selectionType: 'SINGLE',
      modifiers: CRAFTS.map((c, i) => ({
        type: 'MODIFIER', id: `#craft_${i}`,
        modifierData: { name: c.name, priceMoney: { amount: BigInt(c.cents), currency: 'USD' }, ordinal: i + 1 },
      })),
    },
  },
  // Open Studio — non-bookable display item (flow=display, dates in programDates)
  {
    type: 'ITEM', id: '#os',
    itemData: {
      name: 'TEST — Open Studio (Walk-in)', productType: 'REGULAR',
      categories: [{ id: '#cat_os' }],
      variations: [{ type: 'ITEM_VARIATION', id: '#os_var',
        itemVariationData: { name: 'Walk-in', pricingType: 'FIXED_PRICING', priceMoney: { amount: 0n, currency: 'USD' } } }],
    },
    customAttributeValues: {
      flow: { key: 'flow', stringValue: 'display' },
      programDates: { key: 'programDates', stringValue: OPEN_STUDIO_DATES },
      scheduleTime: { key: 'scheduleTime', stringValue: 'Walk-in until 6pm' },
    },
  },
  // Whole Studio Party — bookable APPOINTMENTS_SERVICE, $200 flat + craft modifier list
  {
    type: 'ITEM', id: '#party',
    itemData: {
      name: 'TEST — Whole Studio Party', productType: 'APPOINTMENTS_SERVICE',
      categories: [{ id: '#cat_party' }],
      description: 'Rent the whole studio for a private party. $200 flat + craft cost per guest.',
      modifierListInfo: [{ modifierListId: '#craft', enabled: true, minSelectedModifiers: 1, maxSelectedModifiers: 1 }],
      variations: [{ type: 'ITEM_VARIATION', id: '#party_var',
        itemVariationData: {
          name: '2-Hour Party', pricingType: 'FIXED_PRICING',
          priceMoney: { amount: 20000n, currency: 'USD' }, // $200 flat base
          serviceDuration: 7200000n, // 2h (1h cleanup enforced app-side)
          availableForBooking: true, teamMemberIds: TEAM,
        } }],
    },
  },
]

const resp = await client.catalog.batchUpsert({ idempotencyKey: 'hgs-test-data-v1', batches: [{ objects }] })
const map = Object.fromEntries((resp.idMappings ?? []).map((m) => [m.clientObjectId, m.objectId]))
const ids = {
  categoryOpenStudio: map['#cat_os'], categoryParty: map['#cat_party'],
  craftModifierList: map['#craft'], openStudioItem: map['#os'], partyItem: map['#party'],
  partyVariation: null, // filled below
}

// Fetch the party item to grab the real variation id + version (needed for booking)
const got = await client.catalog.object.get({ objectId: ids.partyItem })
const party = got.object ?? got
const partyVar = party.itemData?.variations?.[0]
ids.partyVariation = partyVar?.id
ids.partyVariationVersion = Number(partyVar?.version ?? 0)

writeFileSync(new URL('./.test-data-ids.json', import.meta.url), JSON.stringify(ids, null, 2))

log('✅ Created TEST data:')
for (const [k, v] of Object.entries(ids)) log(`  ${k}: ${v}`)
log('\nOpen Studio windows:', OPEN_STUDIO_DATES)
log('Crafts:', CRAFTS.map((c) => `${c.name} $${c.cents / 100}/head`).join(', '))
log('\nIDs saved to scripts/.test-data-ids.json — wipe with test-data-teardown.mjs')
