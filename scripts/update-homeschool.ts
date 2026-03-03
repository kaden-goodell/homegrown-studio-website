import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: process.env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
})

async function main() {
  const item = await client.catalog.object.get({ objectId: '6FIZZSMQK5XEQVR55WTVOUXN' })
  const obj = item.object as any

  // Update variation name and dates to Fall 2026
  obj.itemData.variations[0].itemVariationData.name = 'Fall 2026 Semester'
  obj.itemData.variations[0].itemVariationData.customAttributeValues = {
    startDate: { stringValue: '2026-08-19' },
    endDate: { stringValue: '2026-11-18' },
  }

  const result = await client.catalog.batchUpsert({
    idempotencyKey: crypto.randomUUID(),
    batches: [{ objects: [obj] }],
  })

  console.log('Updated! Mappings:', (result as any).idMappings?.length ?? 0)

  // Verify
  const verify = await client.catalog.object.get({ objectId: '6FIZZSMQK5XEQVR55WTVOUXN' })
  const v = (verify.object as any).itemData.variations[0].itemVariationData
  console.log('Variation name:', v.name)
}

main().catch(console.error)
