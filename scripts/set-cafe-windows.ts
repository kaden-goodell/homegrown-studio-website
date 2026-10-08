/**
 * Writes the Craft Café (walk-in) windows onto the Square display item the
 * calendar reads (`partyConfig.square.openStudioItemId`): one window per
 * Saturday, CAFE_HOURS, from OPEN_STUDIO_START_DATE for `--months N` (default
 * 4), skipping closed days. Also names the item "Craft Café" so the
 * dashboard matches the site.
 *
 *   npx tsx scripts/set-cafe-windows.ts            # show what would be written
 *   npx tsx scripts/set-cafe-windows.ts --write    # write it
 *   npx tsx scripts/set-cafe-windows.ts --write --months 6
 *
 * Replaces the whole list each run (the windows are a pure function of the
 * config), so re-run after changing hours, the start date, or closures.
 */
import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'
import { CAFE_HOURS } from '../src/config/hours'
import { OPEN_STUDIO_START_DATE } from '../src/config/opening'
import { studioOpenOn } from '../src/config/closures'
import { partyConfig } from '../src/config/party.config'

const WEEKDAY: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }

const args = process.argv.slice(2)
const write = args.includes('--write')
const monthsArg = args.indexOf('--months')
const months = monthsArg >= 0 ? Number(args[monthsArg + 1]) : 4
if (!Number.isInteger(months) || months < 1 || months > 12) {
  console.error('--months must be 1–12')
  process.exit(1)
}

/** YYYY-MM-DD arithmetic on calendar days, no timezones involved. */
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}
function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

const start = OPEN_STUDIO_START_DATE
const end = addDays(start, Math.round(months * 30.4))
const windows: string[] = []
for (let day = start; day <= end; day = addDays(day, 1)) {
  if (!studioOpenOn(day)) continue
  for (const h of CAFE_HOURS) {
    if (h.days.some((name) => WEEKDAY[name] === weekdayOf(day))) {
      windows.push(`${day}T${h.opens}-${h.closes}`)
    }
  }
}

// Square caps a string custom attribute at 255 characters — about eleven
// windows. Keep as many as fit and say how far that reaches, so the owner
// knows when to re-run this (monthly is plenty).
const LIMIT = 255
const kept: string[] = []
for (const w of windows) {
  if ([...kept, w].join(',').length > LIMIT) break
  kept.push(w)
}
console.log(`Craft Café windows from ${start} (${kept.length} of ${windows.length} fit Square's ${LIMIT}-character limit):`)
for (const w of kept) console.log('  ' + w)
if (kept.length < windows.length) {
  console.log(`  … covered through ${kept[kept.length - 1].slice(0, 10)}; re-run this script before then to roll forward.`)
}
windows.length = 0
windows.push(...kept)

if (!write) {
  console.log('\nDry run. Add --write to store these on the Square item.')
  process.exit(0)
}

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN!, environment: SquareEnvironment.Production })
const itemId = partyConfig.square.openStudioItemId

async function main() {
  const res: any = await client.catalog.object.get({ objectId: itemId, includeRelatedObjects: false })
  const item = res.object ?? res.result?.object
  if (!item) throw new Error(`Square item ${itemId} not found`)
  const before = item.customAttributeValues?.programDates?.stringValue ?? ''
  console.log(`\nItem: "${item.itemData?.name}" (version ${item.version})`)
  console.log(`Current windows: ${before ? before.split(',').length : 0}`)

  const upsert: any = await client.catalog.object.upsert({
    idempotencyKey: `cafe-windows-${Date.now()}`,
    object: {
      ...item,
      itemData: { ...item.itemData, name: 'Craft Café' },
      customAttributeValues: {
        ...(item.customAttributeValues ?? {}),
        flow: { ...(item.customAttributeValues?.flow ?? {}), stringValue: 'display' },
        programDates: { ...(item.customAttributeValues?.programDates ?? {}), stringValue: windows.join(',') },
      },
    },
  })
  const saved = upsert.catalogObject ?? upsert.result?.catalogObject
  const after = saved?.customAttributeValues?.programDates?.stringValue ?? ''
  console.log(`Saved: "${saved?.itemData?.name}" — ${after.split(',').filter(Boolean).length} windows (version ${saved?.version})`)
}

main().catch((err) => {
  console.error('Failed:', err?.body ?? err?.message ?? err)
  process.exit(1)
})
