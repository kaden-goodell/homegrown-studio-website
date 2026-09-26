import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

/**
 * Show (and optionally set) the customer-facing name on every Square location.
 * Receipts, booking confirmations, and the Square-hosted pages use the location
 * name; the merchant-level businessName is read-only via the API (Dashboard →
 * Account & Settings → Business information).
 *
 * Usage:
 *   npx tsx scripts/rename-location.ts                   # list only
 *   npx tsx scripts/rename-location.ts --name "Hometown Studio"
 */

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN!, environment: SquareEnvironment.Production })
const argv = process.argv.slice(2)
const i = argv.indexOf('--name')
const newName = i >= 0 ? argv[i + 1] : undefined

async function main() {
  const merchant: any = await client.merchants.get({ merchantId: 'me' })
  console.log(`merchant businessName (read-only via API): ${merchant.merchant?.businessName}`)
  const res: any = await client.locations.list()
  for (const loc of res.locations ?? []) {
    console.log(`location ${loc.id} | name="${loc.name}" | businessName="${loc.businessName ?? ''}" | ${loc.status}`)
    if (newName && loc.status === 'ACTIVE' && loc.name !== newName) {
      const upd: any = await client.locations.update({ locationId: loc.id, location: { name: newName } })
      console.log(`  → renamed to "${upd.location?.name}"`)
    }
  }
}

main().catch((e) => { console.error('FATAL:', e?.errors ?? e?.body ?? e); process.exit(1) })
