import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: process.env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
})

async function main() {
  console.log('=== LOCATIONS ===')
  const locs = await client.locations.list()
  for (const l of (locs as any).locations ?? []) {
    console.log(`  ${l.name} (${l.id}) status=${l.status}`)
    console.log(`    address: ${JSON.stringify(l.address)}`)
    console.log(`    taxIds: ${JSON.stringify(l.taxIds)}`)
  }

  console.log('\n=== CATALOG TAX OBJECTS ===')
  let found = 0
  for await (const tax of await client.catalog.list({ types: 'TAX' }) as any) {
    found++
    const d = tax.taxData
    console.log(`  ${d?.name}: ${d?.percentage}% inclusion=${d?.inclusionType} phase=${d?.calculationPhase} enabled=${d?.enabled} appliesToCustomAmounts=${d?.appliesToCustomAmounts}`)
    console.log(`    id: ${tax.id}`)
  }
  if (!found) console.log('  (none configured)')
}

main().catch(e => { console.error(e); process.exit(1) })

async function itemTaxes() {
  console.log('\n=== ITEM TAX LINKAGE ===')
  for await (const item of await client.catalog.list({ types: 'ITEM' }) as any) {
    const taxIds = item.itemData?.taxIds ?? []
    const isTaxable = item.itemData?.isTaxable
    console.log(`  ${item.itemData?.name}: taxIds=[${taxIds.join(',')}] isTaxable=${isTaxable}`)
  }
}
itemTaxes().catch(e => { console.error(e); process.exit(1) })
