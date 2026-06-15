// Deletes all TEST dummy data created by test-data-setup.mjs.
// Run: node --env-file=.env scripts/test-data-teardown.mjs
import { SquareClient, SquareEnvironment } from 'square'
import { readFileSync } from 'node:fs'

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN, environment: SquareEnvironment.Production })
const log = (...a) => console.log(...a)

// 1) Delete by saved IDs (if present)
let ids = {}
try { ids = JSON.parse(readFileSync(new URL('./.test-data-ids.json', import.meta.url))) } catch {}

// 0) Cancel the demo party booking, if one was created.
if (ids.demoBookingId) {
  try {
    const g = await client.bookings.get({ bookingId: ids.demoBookingId })
    const b = g.booking ?? g
    if (b.status !== 'CANCELLED_BY_CUSTOMER' && b.status !== 'CANCELLED_BY_SELLER') {
      await client.bookings.cancel({ bookingId: b.id, bookingVersion: b.version })
      log('cancelled demo booking:', ids.demoBookingId)
    }
  } catch (e) { log('demo booking cancel skipped:', e.message) }
}
const savedIds = [ids.openStudioItem, ids.partyItem, ids.craftModifierList, ids.categoryOpenStudio, ids.categoryParty].filter(Boolean)

// 2) Safety net: scan catalog for any leftover "TEST —" objects
const scanned = []
for await (const obj of await client.catalog.list({ types: 'ITEM,CATEGORY,MODIFIER_LIST' })) {
  const n = obj.itemData?.name ?? obj.categoryData?.name ?? obj.modifierListData?.name ?? ''
  if (n.startsWith('TEST —')) scanned.push(obj.id)
}
const all = [...new Set([...savedIds, ...scanned])]
if (all.length === 0) { log('Nothing to delete — already clean ✅'); process.exit(0) }

await client.catalog.batchDelete({ objectIds: all })
const check = await client.catalog.batchGet({ objectIds: all })
const remaining = (check.objects ?? []).length
log(`🧹 Deleted ${all.length} TEST objects; remaining: ${remaining}`, remaining === 0 ? '✅' : '⚠️')
