import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: process.env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
})

async function main() {
  // List all catalog items
  const items: any[] = []
  for await (const item of await client.catalog.list({ types: 'ITEM' }) as any) {
    items.push(item)
  }
  console.log('=== CATALOG ITEMS ===')
  console.log(items.length + ' items total\n')
  for (const item of items) {
    const catId = item.itemData?.categories?.[0]?.id ?? '(no cat)'
    const vars = item.itemData?.variations?.length ?? 0
    const desc = (item.itemData?.description ?? '').substring(0, 80)
    const customAttrs = Object.keys(item.customAttributeValues ?? {})
    const modLists = item.itemData?.modifierListInfo?.length ?? 0
    const imageIds = item.itemData?.imageIds?.length ?? 0
    console.log(`  ${item.itemData?.name}`)
    console.log(`    id: ${item.id}`)
    console.log(`    cat: ${catId}, vars: ${vars}, modLists: ${modLists}, images: ${imageIds}`)
    console.log(`    customAttrs: [${customAttrs.join(', ')}]`)
    console.log(`    desc: ${desc}...`)
    // Print variation details
    for (const v of item.itemData?.variations ?? []) {
      const price = v.itemVariationData?.priceMoney?.amount
      const duration = v.itemVariationData?.serviceDuration
      const prodType = v.itemVariationData?.itemVariationVendorInfos?.[0]?.productType ?? v.itemVariationData?.productType
      console.log(`    var: "${v.itemVariationData?.name}" price=${price} duration=${duration} productType=${prodType}`)
    }
    console.log()
  }

  // List categories
  const cats: any[] = []
  for await (const cat of await client.catalog.list({ types: 'CATEGORY' }) as any) {
    cats.push(cat)
  }
  console.log('=== CATEGORIES ===')
  for (const cat of cats) {
    console.log(`  ${cat.id} => ${cat.categoryData?.name}`)
  }

  // List custom attribute definitions
  const attrs: any[] = []
  for await (const attr of await client.catalog.list({ types: 'CUSTOM_ATTRIBUTE_DEFINITION' }) as any) {
    attrs.push(attr)
  }
  console.log('\n=== CUSTOM ATTRIBUTE DEFINITIONS ===')
  for (const attr of attrs) {
    console.log(`  ${attr.id} => key="${attr.customAttributeDefinitionData?.key}" name="${attr.customAttributeDefinitionData?.name}" type=${attr.customAttributeDefinitionData?.type}`)
  }
}

main().catch(console.error)
