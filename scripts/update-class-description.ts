import 'dotenv/config'

/**
 * Update the description (and optionally price) of a CLASS_TICKET workshop item.
 * Uses raw REST because the v44 SDK's request validation rejects CLASS_TICKET
 * (the API accepts it — see scripts/create-class.ts).
 *
 * Usage:
 *   npx tsx scripts/update-class-description.ts --item <itemId> --description "..." [--price 40]
 */

const token = process.env.SQUARE_ACCESS_TOKEN!
const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const itemId = flag('item')
const description = flag('description')
const price = flag('price')
if (!itemId || (!description && !price)) {
  console.error('Usage: update-class-description.ts --item <id> --description "..." [--price <dollars>]')
  process.exit(1)
}

const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Square-Version': '2025-01-23' }

async function main() {
  const got: any = await (await fetch(`https://connect.squareup.com/v2/catalog/object/${itemId}`, { headers: H })).json()
  const obj = got.object
  if (!obj || obj.item_data?.product_type !== 'CLASS_TICKET') { console.error('Not a CLASS_TICKET item:', JSON.stringify(got).slice(0, 300)); process.exit(1) }
  const item_data: any = { ...obj.item_data }
  if (description) { item_data.description_html = `<p>${description.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>')}</p>`; delete item_data.description; delete item_data.description_plaintext }
  if (price) {
    const cents = Math.round(Number(price) * 100)
    item_data.variations = item_data.variations.map((v: any) => ({ ...v, item_variation_data: { ...v.item_variation_data, price_money: { amount: cents, currency: 'USD' } } }))
  }
  const res = await fetch('https://connect.squareup.com/v2/catalog/object', {
    method: 'POST', headers: H,
    body: JSON.stringify({ idempotency_key: `upd-class-${itemId}-${Date.now()}`, object: { ...obj, item_data } }),
  })
  const out: any = await res.json()
  if (!res.ok) { console.error('FAILED', res.status, JSON.stringify(out.errors ?? out)); process.exit(1) }
  const d = out.catalog_object?.item_data
  console.log(`updated "${d?.name}" — $${(d?.variations?.[0]?.item_variation_data?.price_money?.amount ?? 0) / 100} — ${(d?.description_plaintext ?? '').slice(0, 80)}…`)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
