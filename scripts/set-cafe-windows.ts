/**
 * Writes the Craft Café (walk-in) windows onto the Square display item the
 * calendar reads (`partyConfig.square.openStudioItemId`): one window per
 * café day (the saved weekly hours, or a special day), from today (never before
 * OPEN_STUDIO_START_DATE) for `--months N` (default 4), skipping closed days. The
 * calls live in src/lib/cafe-windows.ts, shared with /admin's settings save. Also names the item "Craft Café" so the
 * dashboard matches the site.
 *
 *   npx tsx scripts/set-cafe-windows.ts            # show what would be written
 *   npx tsx scripts/set-cafe-windows.ts --write    # write it
 *   npx tsx scripts/set-cafe-windows.ts --write --months 6
 *
 * Reads the owners' saved settings from the production store (needs the
 * authed netlify CLI). The site also rolls these forward every night
 * (netlify/functions/cafe-windows.ts), so this is only for a by-hand check.
 */
import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'
import { OPEN_STUDIO_START_DATE } from '../src/config/opening'
import { studioDaysFromJson } from '../src/lib/studio-settings'
import { blobGet, requireNetlifyCli } from './lib/netlify-blobs'
import { partyConfig } from '../src/config/party.config'
import { addDays, cafeWindows, fitWindows, readCafeItem, SQUARE_WINDOW_LIMIT, writeCafeWindows } from '../src/lib/cafe-windows'

const args = process.argv.slice(2)
const write = args.includes('--write')
const monthsArg = args.indexOf('--months')
const months = monthsArg >= 0 ? Number(args[monthsArg + 1]) : 4
if (!Number.isInteger(months) || months < 1 || months > 12) {
  console.error('--months must be 1–12')
  process.exit(1)
}

// R38: the owners' saved hours, special days and closed days from the PRODUCTION store (the same rule the
// site uses: the config until an owner first saves), so running this never undoes a save on /admin.
requireNetlifyCli()
const saved = await blobGet('studio-settings', 'settings')
const studioDays = studioDaysFromJson(saved)
console.log(saved ? 'Using the hours and closed days saved on /admin.\n' : 'Nothing saved on /admin yet: using the config hours and closed days.\n')

// Past days only use up Square's character limit: start today at the earliest.
const todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: partyConfig.timezone })
const start = todayYmd > OPEN_STUDIO_START_DATE ? todayYmd : OPEN_STUDIO_START_DATE
const end = addDays(start, Math.round(months * 30.4))
const all = cafeWindows(studioDays, start, end)

// Square caps a string custom attribute at 255 characters — about eleven
// windows. Keep as many as fit and say how far that reaches, so the owner
// knows when to re-run this (monthly is plenty).
const windows = fitWindows(all)
console.log(`Craft Café windows from ${start} (${windows.length} of ${all.length} fit Square's ${SQUARE_WINDOW_LIMIT}-character limit):`)
for (const w of windows) console.log('  ' + w)
if (windows.length < all.length) {
  console.log(`  … covered through ${windows[windows.length - 1].slice(0, 10)}; re-run this script before then to roll forward.`)
}

if (!write) {
  console.log('\nDry run. Add --write to store these on the Square item.')
  process.exit(0)
}

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN!, environment: SquareEnvironment.Production })
const itemId = partyConfig.square.openStudioItemId

async function main() {
  const item = await readCafeItem(client, itemId)
  if (!item) throw new Error(`Square item ${itemId} not found`)
  const before = item.customAttributeValues?.programDates?.stringValue ?? ''
  console.log(`\nItem: "${item.itemData?.name}" (version ${item.version})`)
  console.log(`Current windows: ${before ? before.split(',').length : 0}`)
  const saved = await writeCafeWindows(client, item, windows)
  console.log(`Saved: "${saved.name}" — ${saved.count} windows (version ${saved.version})`)
}

main().catch((err) => {
  console.error('Failed:', err?.body ?? err?.message ?? err)
  process.exit(1)
})
