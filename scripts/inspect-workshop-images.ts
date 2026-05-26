import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

const locationId = process.env.SQUARE_LOCATION_ID!
const token = process.env.SQUARE_ACCESS_TOKEN!
const env = process.env.SQUARE_ENVIRONMENT === 'production'
  ? SquareEnvironment.Production
  : SquareEnvironment.Sandbox

const client = new SquareClient({ token, environment: env })

function formatDateWithOffset(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0')
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}${sign}${hours}:${minutes}`
}

async function inspectBuyerApi() {
  console.log('=== TEST 1: Buyer-facing classes API — does class_schedules carry image fields? ===\n')
  const now = new Date()
  const end = new Date(); end.setFullYear(end.getFullYear() + 1)
  const res = await fetch(
    `https://app.squareup.com/appointments/api/buyer/classes/class_schedule_instances/search?unit_token=${locationId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://book.squareup.com',
        'Referer': 'https://book.squareup.com/',
      },
      body: JSON.stringify({
        cursor: null,
        sort: { field: 'START_AT' },
        query: { filter: { location_id: locationId, starting_at: { start_at: formatDateWithOffset(now), end_at: formatDateWithOffset(end) }, status: 'CLASS_SCHEDULE_ACTIVE' } },
        includes: ['CLASS_SCHEDULE'],
        limit: 5,
      }),
    }
  )
  const data: any = await res.json()
  const scheds = data.included_resources?.class_schedules ?? []
  console.log(`Found ${scheds.length} class schedules\n`)
  if (scheds.length === 0) { console.log('No class schedules to inspect.'); return [] }
  const first = scheds[0]
  console.log('Top-level keys on class_schedule:')
  console.log(Object.keys(first).sort().join(', '))
  console.log('\nAny key containing "image", "photo", or "media":')
  const imgKeys = Object.keys(first).filter((k) => /image|photo|media/i.test(k))
  console.log(imgKeys.length ? imgKeys : '(none)')
  console.log('\nFull first class_schedule:')
  console.log(JSON.stringify(first, null, 2))
  return scheds
}

async function inspectCatalogForClasses() {
  console.log('\n\n=== TEST 2: Does Square Catalog have class items? ===\n')
  const seenTypes = new Map<string, number>()
  const classCandidates: any[] = []
  for await (const obj of await client.catalog.list({ types: 'ITEM,CATEGORY' as any })) {
    const o = obj as any
    seenTypes.set(o.type, (seenTypes.get(o.type) ?? 0) + 1)
    const name = (o.itemData?.name ?? o.categoryData?.name ?? '').toLowerCase()
    if (/class|workshop/.test(name)) {
      classCandidates.push(o)
    }
  }
  console.log('Catalog object types seen:', Object.fromEntries(seenTypes))
  console.log(`\nObjects with "class" or "workshop" in name: ${classCandidates.length}`)
  for (const c of classCandidates.slice(0, 5)) {
    console.log(`\n--- ${c.type}: ${c.itemData?.name ?? c.categoryData?.name} (id: ${c.id}) ---`)
    console.log('Has imageIds?', !!c.itemData?.imageIds?.length, c.itemData?.imageIds ?? '(none)')
    console.log('Product type:', c.itemData?.productType ?? '(none)')
    console.log('Variations:', c.itemData?.variations?.length ?? 0)
  }
}

async function tryClassScheduleAsCatalogType() {
  console.log('\n\n=== TEST 3: Try fetching one class_schedule ID via the catalog API ===\n')
  const now = new Date()
  const end = new Date(); end.setFullYear(end.getFullYear() + 1)
  const res = await fetch(
    `https://app.squareup.com/appointments/api/buyer/classes/class_schedule_instances/search?unit_token=${locationId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Origin': 'https://book.squareup.com', 'Referer': 'https://book.squareup.com/' },
      body: JSON.stringify({ cursor: null, sort: { field: 'START_AT' }, query: { filter: { location_id: locationId, starting_at: { start_at: formatDateWithOffset(now), end_at: formatDateWithOffset(end) }, status: 'CLASS_SCHEDULE_ACTIVE' } }, includes: ['CLASS_SCHEDULE'], limit: 1 }),
    }
  )
  const data: any = await res.json()
  const first = data.included_resources?.class_schedules?.[0]
  if (!first) { console.log('No class schedule to test.'); return }
  console.log(`Trying client.catalog.object.get with class_schedule.id = ${first.id}`)
  try {
    const resp: any = await client.catalog.object.get({ objectId: first.id })
    const obj = resp?.object ?? resp
    console.log('SUCCESS — class schedule IS a catalog object!')
    console.log('Type:', obj?.type)
    console.log('Has imageIds:', !!obj?.itemData?.imageIds?.length, obj?.itemData?.imageIds ?? '(none)')
  } catch (e: any) {
    console.log('FAILED:', e?.message ?? String(e))
    console.log('(Class schedules are NOT exposed via the catalog API)')
  }
}

async function main() {
  await inspectBuyerApi()
  await inspectCatalogForClasses()
  await tryClassScheduleAsCatalogType()
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
