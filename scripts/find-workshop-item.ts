import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

/** Find a CLASS_TICKET catalog item by name fragment (case-insensitive). */

const query = (process.argv[2] ?? '').toLowerCase()
if (!query) {
  console.error('Usage: npx tsx scripts/find-workshop-item.ts <name-fragment>')
  process.exit(1)
}

const token = process.env.SQUARE_ACCESS_TOKEN!
const env = process.env.SQUARE_ENVIRONMENT === 'production'
  ? SquareEnvironment.Production
  : SquareEnvironment.Sandbox

const client = new SquareClient({ token, environment: env })

async function main() {
  console.log(`Searching for items with name containing "${query}"...\n`)
  for await (const obj of await client.catalog.list({ types: 'ITEM' })) {
    const item = obj as any
    const name: string = item.itemData?.name ?? ''
    if (!name.toLowerCase().includes(query)) continue
    console.log(`Name: ${name}`)
    console.log(`  id:          ${item.id}`)
    console.log(`  productType: ${item.itemData?.productType ?? '(none)'}`)
    console.log(`  imageIds:    ${item.itemData?.imageIds?.length ? item.itemData.imageIds.join(', ') : '(none)'}`)
    console.log()
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
