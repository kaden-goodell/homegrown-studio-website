import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { SquareClient, SquareEnvironment } from 'square'

/**
 * Upload a local image file to Square's Catalog Images API and attach it
 * to a catalog item (by item ID). The image's caption is set to the role
 * ("card" or "flyer") so the provider knows which slot it belongs in.
 *
 * Usage: npx tsx scripts/upload-workshop-image.ts <itemId> <imagePath> [--role card|flyer]
 *
 * Default role is "card". Pass --role flyer to upload a flyer image.
 *
 * Example:
 *   npx tsx scripts/upload-workshop-image.ts \
 *     L4T4PFGYSD4P7UEBM7LTCIAA \
 *     "~/Library/Mobile Documents/com~apple~CloudDocs/Canva/Pot Holder Weaving.png" \
 *     --role card
 */

const args = process.argv.slice(2)
const roleIdx = args.indexOf('--role')
const role = roleIdx >= 0 ? (args[roleIdx + 1] ?? 'card') : 'card'
const positional = args.filter((_, i) => i !== roleIdx && i !== roleIdx + 1)
const itemId = positional[0]
const imagePath = positional[1]?.replace(/^~/, process.env.HOME ?? '~')

if (!itemId || !imagePath) {
  console.error('Usage: npx tsx scripts/upload-workshop-image.ts <itemId> <imagePath> [--role card|flyer]')
  process.exit(1)
}
if (role !== 'card' && role !== 'flyer') {
  console.error(`Invalid --role: ${role}. Must be "card" or "flyer".`)
  process.exit(1)
}

const token = process.env.SQUARE_ACCESS_TOKEN!
const env = process.env.SQUARE_ENVIRONMENT === 'production'
  ? SquareEnvironment.Production
  : SquareEnvironment.Sandbox

const client = new SquareClient({ token, environment: env })

function bigIntJson(o: unknown): string {
  return JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
}

async function main() {
  console.log(`Square env: ${env}`)
  console.log(`Item ID: ${itemId}`)
  console.log(`Image: ${imagePath}`)
  console.log(`Role: ${role}`)

  // 1. Read the file.
  const fileBuf = readFileSync(imagePath)
  const fileName = basename(imagePath)
  console.log(`File: ${fileName}, ${fileBuf.length} bytes`)

  // 2. Sanity check the target item exists.
  const itemResp: any = await client.catalog.object.get({ objectId: itemId })
  const item = (itemResp?.object ?? itemResp) as any
  if (!item || item.type !== 'ITEM') {
    console.error('Target object is not a catalog ITEM. Aborting.')
    console.error('type:', item?.type)
    process.exit(1)
  }
  console.log(`Target item: ${item.itemData?.name ?? '(unnamed)'}`)
  console.log(`Existing imageIds: ${item.itemData?.imageIds?.join(', ') ?? '(none)'}`)

  // 3. Upload via Catalog Images API. The SDK accepts a Blob/File-like.
  // Convert Node Buffer → Blob to satisfy the multipart upload.
  const blob = new Blob([fileBuf as any], { type: fileName.endsWith('.png') ? 'image/png' : 'image/jpeg' })
  // Attach a name so the SDK form-data field gets a filename.
  ;(blob as any).name = fileName

  console.log('\nUploading to Square Catalog Images API...')
  const uploadResp: any = await (client.catalog as any).images.create({
    request: {
      idempotencyKey: `upload-${itemId}-${Date.now()}`,
      image: {
        type: 'IMAGE',
        id: '#new-image',
        imageData: {
          name: fileName,
          caption: role, // "card" or "flyer" — read by SquareWorkshopProvider to slot the image.
        },
      },
      objectId: itemId, // Attach to the item directly.
    },
    imageFile: blob,
  })

  console.log('\nUpload response:')
  console.log(bigIntJson(uploadResp).slice(0, 800))

  const newImageId = uploadResp?.image?.id ?? uploadResp?.result?.image?.id
  console.log(`\nNew imageId: ${newImageId ?? '(not found in response — check the JSON above)'}`)

  // 4. Verify by re-fetching the item.
  console.log('\nVerifying item now has the image attached...')
  const verifyResp: any = await client.catalog.object.get({ objectId: itemId })
  const verifyItem = (verifyResp?.object ?? verifyResp) as any
  console.log(`Item imageIds after upload: ${verifyItem.itemData?.imageIds?.join(', ') ?? '(none)'}`)
}

main().catch((e) => { console.error('FATAL:', e?.errors ?? e?.body ?? e); process.exit(1) })
