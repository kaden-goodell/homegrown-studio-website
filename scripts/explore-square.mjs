// READ-ONLY Square exploration. No writes. Run: node --env-file=.env scripts/explore-square.mjs
import { SquareClient, SquareEnvironment } from 'square'

const token = process.env.SQUARE_ACCESS_TOKEN
const locationId = process.env.SQUARE_LOCATION_ID
const env = process.env.SQUARE_ENVIRONMENT
const client = new SquareClient({
  token,
  environment: env === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
})

const log = (...a) => console.log(...a)
const hr = (t) => log('\n' + '═'.repeat(4), t, '═'.repeat(40))
const j = (o) => JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? Number(v) : v), 2)

log(`ENV=${env}  LOCATION=${locationId}`)

// 1) Locations + business hours + timezone
hr('LOCATIONS (business hours / timezone)')
try {
  const resp = await client.locations.list()
  for (const loc of resp.locations ?? []) {
    log(`• ${loc.name} [${loc.id}] tz=${loc.timezone} status=${loc.status}`)
    if (loc.businessHours?.periods) {
      for (const p of loc.businessHours.periods) log(`    ${p.dayOfWeek} ${p.startLocalTime}-${p.endLocalTime}`)
    } else log('    (no business hours set)')
  }
} catch (e) { log('locations error:', e.message) }

// 2) Catalog: items, categories, services, custom-attr definitions
hr('CATALOG OBJECTS (by type)')
const byType = {}
const items = []
const customAttrDefs = []
try {
  for await (const obj of await client.catalog.list({ types: 'ITEM,CATEGORY,CUSTOM_ATTRIBUTE_DEFINITION,IMAGE,MODIFIER_LIST' })) {
    byType[obj.type] = (byType[obj.type] ?? 0) + 1
    if (obj.type === 'ITEM') items.push(obj)
    if (obj.type === 'CUSTOM_ATTRIBUTE_DEFINITION') customAttrDefs.push(obj)
  }
  log('counts by type:', j(byType))
} catch (e) { log('catalog list error:', e.message) }

hr('CUSTOM ATTRIBUTE DEFINITIONS (what fields exist to extend)')
for (const d of customAttrDefs) {
  const cd = d.customAttributeDefinitionData ?? {}
  log(`• name="${cd.name}" key=${cd.key} type=${cd.type} appliesTo=${(cd.allowedObjectTypes ?? []).join(',')}`)
}

hr('CATALOG ITEMS (name / productType / category / customAttrs)')
for (const it of items) {
  const d = it.itemData ?? {}
  const cats = (d.categories ?? []).map((c) => c.id).join(',')
  const attrs = Object.keys(it.customAttributeValues ?? {})
  log(`• "${d.name}"  productType=${d.productType ?? d.isArchived ?? '—'}  variations=${(d.variations ?? []).length}  cats=[${cats}]  customAttrs=[${attrs.join(',')}]`)
}

// 3) Buyer-facing Classes API (same call workshop.ts makes)
hr('BUYER-FACING CLASS INSTANCES (real structure)')
try {
  const now = new Date()
  const end = new Date(); end.setFullYear(end.getFullYear() + 1)
  const fmt = (dt) => dt.toISOString().replace('Z', '+00:00')
  const body = {
    cursor: null,
    sort: { field: 'START_AT' },
    query: { filter: { location_id: locationId, starting_at: { start_at: fmt(now), end_at: fmt(end) }, status: 'CLASS_SCHEDULE_ACTIVE' } },
    includes: ['CLASS_SCHEDULE'],
    limit: 5,
  }
  const r = await fetch(`https://app.squareup.com/appointments/api/buyer/classes/class_schedule_instances/search?unit_token=${locationId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://book.squareup.com', Referer: 'https://book.squareup.com/' },
    body: JSON.stringify(body),
  })
  log('HTTP', r.status)
  if (r.ok) {
    const data = await r.json()
    const inst = (data.class_schedule_instances ?? [])[0]
    const sched = (data.included_resources?.class_schedules ?? [])[0]
    log('instance count:', (data.class_schedule_instances ?? []).length)
    log('sample INSTANCE keys:', inst ? Object.keys(inst).join(', ') : '(none)')
    log('sample INSTANCE:', j(inst))
    log('sample SCHEDULE keys:', sched ? Object.keys(sched).join(', ') : '(none)')
    log('sample SCHEDULE:', j(sched))
  } else {
    log('body:', (await r.text()).slice(0, 300))
  }
} catch (e) { log('classes api error:', e.message) }

// 4) Team members (needed to own a class/service)
hr('TEAM MEMBERS')
try {
  const r = await client.teamMembers.search({ query: { filter: { locationIds: [locationId], status: 'ACTIVE' } } })
  for (const tm of r.teamMembers ?? []) log(`• ${tm.givenName ?? ''} ${tm.familyName ?? ''} [${tm.id}] ${tm.isOwner ? '(owner)' : ''}`)
} catch (e) { log('team members error:', e.message) }

log('\n✅ read-only exploration complete (no writes performed)')
