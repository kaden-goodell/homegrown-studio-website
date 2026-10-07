import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { SquareClient, SquareEnvironment } from 'square'
import { partyBlocksClass, partySpanOf, partyClashMessage } from '../src/lib/conflicts'
import { studioDate, studioDayUtcRange } from '../src/lib/studio-time'

/**
 * Create an Appointments "class" schedule (the dated instance the website reads)
 * via Square's undocumented dashboard endpoint. Optionally creates the underlying
 * CLASS_TICKET catalog item first if it doesn't exist yet.
 *
 * The website's SquareWorkshopProvider lists these schedules and joins images from
 * the matching catalog item by name — so creating a schedule is what makes a
 * workshop appear on the site.
 *
 * AUTH: this endpoint uses a logged-in dashboard SESSION, not the SDK access token.
 * Paste your browser cookie (from app.squareup.com while logged in) into
 * `captures/.square-session` (gitignored), or set SQUARE_DASHBOARD_COOKIE.
 * The x-csrf-token is read out of the cookie's `_js_csrf` value automatically.
 * When the session expires you'll get a 401/403 — just refresh the cookie.
 *
 * Usage:
 *   # schedule an existing catalog item by name:
 *   npx tsx scripts/create-class.ts --name "Pot Holder Weaving" \
 *     --start "2026-08-15T18:00" --duration 120 --capacity 12
 *
 *   # or by explicit item id:
 *   npx tsx scripts/create-class.ts --item L4T4PFGYSD4P7UEBM7LTCIAA \
 *     --start "2026-08-15T18:00" --duration 120 --capacity 12
 *
 *   # create a brand-new workshop item + schedule in one go:
 *   npx tsx scripts/create-class.ts --name "Beef Tallow Basics" --create \
 *     --price 45 --description "Render your own tallow..." \
 *     --start "2026-09-05T18:00" --duration 120 --capacity 10
 *
 * Flags:
 *   --name <str>          class/item name (join key with the website + images)
 *   --item <id>           explicit CLASS_TICKET catalog item id (skips name lookup)
 *   --create              create the item if it doesn't exist (needs --price)
 *   --price <dollars>     price per seat, used only when creating the item
 *   --description <str>   item description, used only when creating the item
 *   --start <local>       start time in America/Chicago, "YYYY-MM-DDTHH:mm"
 *   --duration <min>      class length in minutes (default 120)
 *   --capacity <n>        seats available (default 12)
 *   --rrule <RRULE>       recurrence rule for a repeating series (default one-off)
 *   --staff <teamId>      staff/team member id (default SQUARE_TEAM_MEMBER_ID)
 *   --dry-run             print the request body and exit without POSTing
 *
 * Party guard: before creating anything (and on --dry-run) the script reads
 * that day's bookings and refuses if a booked party overlaps the class or
 * the hour of cleanup before it. Move the party in Square first; there is
 * no --force.
 */

const WORKSHOP_CATEGORY_ID = 'QXN2HDQQG2YBZBNLLKNFTZRC'
const DEFAULT_TEAM_MEMBER_ID = 'TMeIN-kxF-ZVhTVj' // Kaden Goodell
const SCHEDULE_URL = 'https://app.squareup.com/appointments/api/class-schedules'

// ---- args ----
const argv = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
function has(name: string): boolean {
  return argv.includes(`--${name}`)
}

const nameArg = flag('name')
let itemId = flag('item')
const doCreate = has('create')
const priceArg = flag('price')
const descriptionArg = flag('description')
const startLocal = flag('start')
const durationMinutes = Number(flag('duration') ?? '120')
const totalCapacity = Number(flag('capacity') ?? '12')
const rrule = flag('rrule') ?? ''
const teamMemberId = flag('staff') ?? process.env.SQUARE_TEAM_MEMBER_ID ?? DEFAULT_TEAM_MEMBER_ID
const dryRun = has('dry-run')

const locationId = process.env.SQUARE_LOCATION_ID
const token = process.env.SQUARE_ACCESS_TOKEN

if (!startLocal) fail('Missing --start "YYYY-MM-DDTHH:mm" (America/Chicago local time).')
if (!itemId && !nameArg) fail('Provide --item <id> or --name <workshop name>.')
if (!locationId) fail('SQUARE_LOCATION_ID not set in environment/.env.')
if (!token) fail('SQUARE_ACCESS_TOKEN not set in environment/.env.')

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

// ---- session cookie (dashboard, not SDK) ----
function loadCookie(): { cookie: string; csrf: string } {
  let cookie = process.env.SQUARE_DASHBOARD_COOKIE
  if (!cookie) {
    try {
      cookie = readFileSync('captures/.square-session', 'utf8').trim()
    } catch {
      fail(
        'No dashboard session found. Paste your app.squareup.com cookie into\n' +
          '  captures/.square-session   (gitignored)\n' +
          'or set SQUARE_DASHBOARD_COOKIE. See how in scripts/create-class.ts header.',
      )
    }
  }
  const csrf = /_js_csrf=([^;]+)/.exec(cookie!)?.[1]
  if (!csrf) fail('Cookie is missing the _js_csrf token — re-copy the full cookie string.')
  return { cookie: cookie!, csrf: csrf! }
}

// ---- America/Chicago local -> UTC ISO ----
function chicagoToUtcISO(local: string): string {
  const [datePart, timePart = '00:00'] = local.split('T')
  const [y, mo, d] = datePart.split('-').map(Number)
  const [h, mi] = timePart.split(':').map(Number)
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi))
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(guess)
  const p: Record<string, string> = {}
  for (const part of parts) p[part.type] = part.value
  const asSeen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  const offset = asSeen - guess.getTime()
  return new Date(guess.getTime() - offset).toISOString()
}

const client = new SquareClient({ token: token!, environment: SquareEnvironment.Production })

async function findItemByName(name: string): Promise<any | null> {
  const target = name.trim().toLowerCase()
  for await (const obj of await client.catalog.list({ types: 'ITEM' })) {
    const o = obj as any
    if (o.itemData?.productType === 'CLASS_TICKET' && o.itemData?.name?.trim().toLowerCase() === target) {
      return o
    }
  }
  return null
}

async function createItem(name: string): Promise<any> {
  if (!priceArg) fail('--create requires --price <dollars>.')
  const cents = Math.round(Number(priceArg) * 100)
  if (!Number.isFinite(cents)) fail(`Invalid --price "${priceArg}".`)
  console.log(`  creating CLASS_TICKET item "${name}" at $${(cents / 100).toFixed(2)}...`)
  // Raw REST call: the v44 SDK's request validation rejects the undocumented
  // CLASS_TICKET product type before the request is even sent (see
  // square-sdk-v44-shapes memory) — the API itself accepts it fine.
  const httpResp = await fetch('https://connect.squareup.com/v2/catalog/batch-upsert', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Square-Version': '2025-01-23',
    },
    body: JSON.stringify({
      idempotency_key: `create-class-item-${name}-${Date.now()}`,
      batches: [
        {
          objects: [
            {
              type: 'ITEM',
              id: '#item',
              item_data: {
                name,
                description: descriptionArg ?? undefined,
                product_type: 'CLASS_TICKET',
                categories: [{ id: WORKSHOP_CATEGORY_ID, ordinal: 0 }],
                reporting_category: { id: WORKSHOP_CATEGORY_ID },
                variations: [
                  {
                    type: 'ITEM_VARIATION',
                    id: '#var',
                    item_variation_data: {
                      item_id: '#item',
                      name: 'Regular',
                      pricing_type: 'FIXED_PRICING',
                      price_money: { amount: cents, currency: 'USD' },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  })
  const resp: any = await httpResp.json()
  if (!httpResp.ok) fail(`Item creation failed (${httpResp.status}): ${JSON.stringify(resp.errors ?? resp)}`)
  // Raw REST returns snake_case — normalize the bits main() reads (id,
  // itemData.name, variations[].id/version) to the SDK's camelCase shape.
  const createdRaw = (resp?.objects ?? []).find((o: any) => o.type === 'ITEM')
  if (!createdRaw) fail('Item creation did not return an ITEM object.')
  return {
    id: createdRaw.id,
    type: 'ITEM',
    itemData: {
      name: createdRaw.item_data?.name,
      variations: (createdRaw.item_data?.variations ?? []).map((v: any) => ({
        id: v.id,
        version: v.version,
      })),
    },
  }
}

/**
 * HARD RULE (Kaden, 2026-10-06): a class is never created over a booked party.
 * Read-only: lists that studio day's bookings and exits 1 on any party that
 * overlaps [class start − cleanup, class end] (`@lib/conflicts`). It never
 * touches a booking, and there is no override.
 */
async function refuseIfPartyInTheWay(startIso: string, minutes: number): Promise<void> {
  const { startIso: from, endIso: to } = studioDayUtcRange(studioDate(startIso))
  const found: any[] = []
  // v44: bookings.list returns a paginator; iterate to collect.
  for await (const b of (await client.bookings.list({ locationId: locationId!, startAtMin: from, startAtMax: to })) as any) found.push(b)
  const live = found.filter((b) => !/^(CANCELLED|DECLINED)/.test(String(b.status ?? '')))
  const parties = await Promise.all(
    live.map(async (b) => {
      let hostName: string | undefined
      if (b.customerId) {
        try {
          const r: any = await client.customers.get({ customerId: b.customerId })
          const c = r?.customer ?? r
          hostName = [c?.givenName, c?.familyName].filter(Boolean).join(' ') || undefined
        } catch {
          // A name is a nicety; the refusal still prints the time and booking id.
        }
      }
      return partySpanOf({ id: b.id, slot: { startAt: b.startAt, duration: b.appointmentSegments?.[0]?.durationMinutes } }, hostName)
    }),
  )
  const endIso = new Date(Date.parse(startIso) + minutes * 60_000).toISOString()
  const clashes = partyBlocksClass(startIso, endIso, parties)
  if (clashes.length > 0) fail(partyClashMessage(clashes))
  console.log('  party check: no booked party in the way')
}

async function main() {
  // 0. party guard first: a refused class must leave nothing behind (no catalog item, no POST).
  // Runs on --dry-run too: it only reads, so a dry run shows the refusal.
  const startAtIso = chicagoToUtcISO(startLocal!)
  await refuseIfPartyInTheWay(startAtIso, durationMinutes)
  if (rrule) console.log('  note: only the first date of a repeating series was checked for parties.')

  // 1. resolve the catalog item (+ its variation token/version)
  let item: any
  if (itemId) {
    const r: any = await client.catalog.object.get({ objectId: itemId })
    item = r?.object ?? r
    if (item?.type !== 'ITEM') fail(`--item ${itemId} is not a catalog ITEM.`)
  } else {
    item = await findItemByName(nameArg!)
    if (!item) {
      if (doCreate) {
        item = await createItem(nameArg!)
      } else {
        fail(`No existing CLASS_TICKET named "${nameArg}". Re-run with --create --price <dollars> to make it.`)
      }
    }
  }

  const variation = item.itemData?.variations?.[0]
  if (!variation) fail(`Item "${item.itemData?.name}" has no variation.`)

  const body = {
    class_schedule: {
      duration_minutes: durationMinutes,
      item_token: item.id,
      item_variation_token: variation.id,
      item_variation_version: Number(variation.version),
      location_id: locationId,
      rrule,
      start_at: startAtIso,
      status: 'CLASS_SCHEDULE_ACTIVE',
      team_member_id: teamMemberId,
      total_capacity: totalCapacity,
      class_bookings: [],
    },
  }

  console.log(`\nClass: ${item.itemData?.name}  (item ${item.id})`)
  console.log(`  start:    ${startLocal} America/Chicago  ->  ${body.class_schedule.start_at}`)
  console.log(`  duration: ${durationMinutes} min   capacity: ${totalCapacity}   rrule: ${rrule || '(one-off)'}`)

  if (dryRun) {
    console.log('\n--dry-run, request body:\n' + JSON.stringify(body, null, 2))
    return
  }

  // 2. attach the dated schedule via the dashboard endpoint.
  // Try the SDK access token (Bearer) first — if that works we need no cookie at
  // all. Fall back to a dashboard session cookie only if the token is rejected.
  const baseHeaders: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    origin: 'https://app.squareup.com',
    referer: 'https://app.squareup.com/dashboard/appointments/classes/new',
    'x-requested-with': 'XMLHttpRequest',
  }

  async function post(headers: Record<string, string>) {
    const r = await fetch(SCHEDULE_URL, { method: 'POST', headers: { ...baseHeaders, ...headers }, body: JSON.stringify(body) })
    return { r, text: await r.text() }
  }

  let { r: res, text } = await post({ authorization: `Bearer ${token}` })
  let authUsed = 'API key (Bearer)'
  if (res.status === 401 || res.status === 403) {
    console.log('  API key rejected for this endpoint — falling back to dashboard session cookie...')
    const { cookie, csrf } = loadCookie()
    ;({ r: res, text } = await post({ cookie, 'x-csrf-token': csrf }))
    authUsed = 'dashboard session cookie'
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      fail(`${res.status} — dashboard session expired/invalid. Refresh captures/.square-session and retry.\n${text.slice(0, 400)}`)
    }
    fail(`Schedule create failed (${res.status}):\n${text.slice(0, 800)}`)
  }
  console.log(`  auth: ${authUsed}`)

  let scheduleId = ''
  try {
    scheduleId = JSON.parse(text)?.class_schedule?.id ?? ''
  } catch {}
  console.log(`\n✓ Class schedule created${scheduleId ? ` (${scheduleId})` : ''}. It will show on the site once it's a future dated instance with open capacity.`)
}

main().catch((e) => {
  console.error('FATAL:', e?.errors ?? e?.body ?? e)
  process.exit(1)
})
