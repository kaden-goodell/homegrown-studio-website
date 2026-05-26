import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

const token = process.env.SQUARE_ACCESS_TOKEN!
const env = process.env.SQUARE_ENVIRONMENT === 'production'
  ? SquareEnvironment.Production
  : SquareEnvironment.Sandbox

const client = new SquareClient({ token, environment: env })

async function main() {
  const WORKSHOP_CATEGORY_ID = 'QXN2HDQQG2YBZBNLLKNFTZRC'

  console.log('=== Items in the Workshop catalog category ===\n')
  for await (const o of await client.catalog.list({ types: 'ITEM' })) {
    const item = o as any
    const inWorkshop = (item.itemData?.categories ?? []).some((c: any) => c.id === WORKSHOP_CATEGORY_ID)
    if (!inWorkshop) continue
    console.log(`- ${item.itemData?.name ?? '(no name)'} (id: ${item.id})`)
    console.log(`    description: ${item.itemData?.description ?? '(none)'}`)
    console.log(`    imageIds: ${item.itemData?.imageIds?.length ? item.itemData.imageIds.join(', ') : '(none)'}`)
    console.log(`    variations: ${item.itemData?.variations?.length ?? 0}`)
    console.log()
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
