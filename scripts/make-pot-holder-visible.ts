import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

/**
 * The Pot Holder Weaving CLASS_TICKET catalog item is auto-created when
 * you add a class via the Appointments UI, but its variation is marked
 * absent from your studio location (default Square behavior for class
 * tickets). That hides it from the normal Item Library view.
 *
 * This script removes the absent-at-location flag so the item appears in
 * Items & services and you can upload an image to it in admin.
 */

const ITEM_ID = 'L4T4PFGYSD4P7UEBM7LTCIAA' // Pot Holder Weaving
const STUDIO_LOCATION_ID = 'LTHCH1W1J3Y4Q'

const token = process.env.SQUARE_ACCESS_TOKEN!
const env = process.env.SQUARE_ENVIRONMENT === 'production'
  ? SquareEnvironment.Production
  : SquareEnvironment.Sandbox

const client = new SquareClient({ token, environment: env })

async function main() {
  console.log(`Fetching ${ITEM_ID}...`)
  const resp: any = await client.catalog.object.get({ objectId: ITEM_ID })
  const item = (resp?.object ?? resp) as any

  if (!item || item.type !== 'ITEM' || item.itemData?.name !== 'Pot Holder Weaving') {
    console.error('Item not as expected. Aborting.')
    console.error('type:', item?.type, 'name:', item?.itemData?.name)
    process.exit(1)
  }

  console.log(`Item: ${item.itemData.name}`)
  console.log(`Variations: ${item.itemData.variations?.length ?? 0}`)

  // Clear absentAtLocationIds on each variation, mark presentAtAllLocations true.
  const updatedVariations = (item.itemData.variations ?? []).map((v: any) => ({
    ...v,
    presentAtAllLocations: true,
    absentAtLocationIds: [],
  }))

  // Strip productType — Square's SDK doesn't accept CLASS_TICKET as input
  // even though Square auto-sets it. The value is preserved server-side
  // when omitted from upsert.
  const { productType, ...itemDataWithoutProductType } = item.itemData

  const updatedItem = {
    ...item,
    itemData: {
      ...itemDataWithoutProductType,
      variations: updatedVariations,
    },
  }

  console.log('\nUpserting updated item...')
  const updateResp: any = await client.catalog.object.upsert({
    idempotencyKey: `make-pot-holder-visible-${Date.now()}`,
    object: updatedItem,
  } as any)

  console.log('Done. Square response:')
  console.log(JSON.stringify(updateResp, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2).slice(0, 600))
  console.log('\nNow check Square dashboard → Items & services → Items.')
  console.log('You should see "Pot Holder Weaving" in the list and be able to open it to upload an image.')
}

main().catch((e) => { console.error('FATAL:', e?.errors ?? e); process.exit(1) })
