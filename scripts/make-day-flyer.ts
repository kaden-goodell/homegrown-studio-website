/**
 * DEV TOOL. Owners print flyers from /admin (Hours & Craft Café › a special
 * day › Print a flyer, which opens /admin/flyer/<date>); this makes the same
 * flyer as a PDF on a developer's machine.
 *
 * A printable letter-size flyer (PDF) for a Craft Café special day, in the
 * same words as the website card, with a QR code to the Craft Café page. The
 * page is built by src/lib/day-flyer.ts, shared with /admin/flyer/<date>.
 *
 *   npx tsx scripts/make-day-flyer.ts                  # the next announced day
 *   npx tsx scripts/make-day-flyer.ts --date 2026-11-07
 *   npx tsx scripts/make-day-flyer.ts --config         # the config's days, not the saved ones
 *
 * Reads the owners' saved special days from the production store (needs the
 * authed netlify CLI), the same rule the site uses (the config until an owner
 * first saves). Writes flyers/<date>.pdf (and the .html it prints from).
 * Needs Google Chrome installed; the fonts load from Google Fonts, so it needs
 * the internet.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { flyerFacts, flyerHtml } from '../src/lib/day-flyer'
import { studioDaysFromJson } from '../src/lib/studio-settings'
import { CONFIG_STUDIO_DAYS } from '../src/config/studio-days'
import { siteConfig } from '../src/config/site.config'
import { blobGet, requireNetlifyCli } from './lib/netlify-blobs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const argv = process.argv.slice(2)
const dateArg = argv.includes('--date') ? argv[argv.indexOf('--date') + 1] : undefined
const fromConfig = argv.includes('--config')

async function main() {
  let days = CONFIG_STUDIO_DAYS
  if (!fromConfig) {
    requireNetlifyCli()
    const saved = await blobGet('studio-settings', 'settings')
    days = studioDaysFromJson(saved)
    console.log(saved ? 'Using the special days saved on /admin.' : 'Nothing saved on /admin yet: using the config.')
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const day = dateArg
    ? days.cafe.special.find((x) => x.date === dateArg)
    : days.cafe.special.filter((x) => x.announce && x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0]
  if (!day) {
    console.error(dateArg ? `No special day on ${dateArg}.` : 'No upcoming announced special day.')
    process.exit(1)
  }
  const asData = (file: string, type: string) => `data:${type};base64,${readFileSync(resolve('public', file)).toString('base64')}`
  const html = await flyerHtml({
    facts: flyerFacts(day, days.cafe),
    pageUrl: `${siteConfig.url.replace(/\/$/, '')}/craft-cafe`,
    logoSrc: asData('images/logo.png', 'image/png'),
    photoSrc: asData('images/party-hero.jpg', 'image/jpeg'),
    address: siteConfig.address,
  })

  mkdirSync('flyers', { recursive: true })
  const htmlPath = resolve('flyers', `${day.date}.html`)
  const pdfPath = resolve('flyers', `${day.date}.pdf`)
  writeFileSync(htmlPath, html)
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=8000', `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error('Chrome could not print the flyer:', r.stderr?.slice(0, 500))
    process.exit(1)
  }
  console.log(`Flyer: ${pdfPath}`)
}

main()
