import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: process.env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
})

async function main() {
  const res: any = await client.orders.search({
    locationIds: ['LTHCH1W1J3Y4Q'],
    limit: 10,
    query: { sort: { sortField: 'CREATED_AT', sortOrder: 'DESC' } },
  })
  for (const o of res.orders ?? []) {
    console.log(`Order ${o.id} created=${o.createdAt} state=${o.state}`)
    for (const li of o.lineItems ?? []) {
      console.log(`  item: ${li.name} qty=${li.quantity} base=${li.basePriceMoney?.amount} tax=${li.totalTaxMoney?.amount}`)
    }
    console.log(`  TOTAL: ${o.totalMoney?.amount} (tax portion: ${o.totalTaxMoney?.amount})`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
