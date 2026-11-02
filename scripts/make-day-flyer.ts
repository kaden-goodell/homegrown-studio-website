/**
 * A printable letter-size flyer (PDF) for an announced Craft Café special day
 * (hours.ts CAFE_SPECIAL_DAYS with `announce`), in the same words as the
 * website card, with a QR code to the Craft Café page.
 *
 *   npx tsx scripts/make-day-flyer.ts                  # the next announced day
 *   npx tsx scripts/make-day-flyer.ts --date 2026-11-07
 *
 * Writes flyers/<date>.pdf (and the .html it prints from). Needs Google Chrome
 * installed; the fonts load from Google Fonts, so it needs the internet.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import QRCode from 'qrcode'
import { cafeDayNotices } from '../src/lib/special-day-notice'
import { siteConfig } from '../src/config/site.config'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const argv = process.argv.slice(2)
const dateArg = argv.includes('--date') ? argv[argv.indexOf('--date') + 1] : undefined

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const notices = cafeDayNotices()
const n = dateArg ? notices.find((x) => x.date === dateArg) : notices.find((x) => x.date >= today)
if (!n) {
  console.error(dateArg ? `No announced special day on ${dateArg} (hours.ts announce).` : 'No upcoming announced special day (hours.ts announce).')
  process.exit(1)
}

const [y, m, d] = n.date.split('-').map(Number)
const longDate = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
const pageUrl = `${siteConfig.url.replace(/\/$/, '')}/craft-cafe`
const shownUrl = pageUrl.replace(/^https?:\/\/(www\.)?/, '')
const { street, city, state } = siteConfig.address
const asData = (file: string, type: string) => `data:${type};base64,${readFileSync(resolve('public', file)).toString('base64')}`

async function main() {
  const qr = await QRCode.toString(pageUrl, { type: 'svg', margin: 0, color: { dark: '#3d3229', light: '#0000' } })
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Inter', sans-serif; color: #3d3229; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 8.5in; height: 11in; padding: 0.55in 0.6in; background: #f8f5f1; display: flex; flex-direction: column; align-items: center; text-align: center; position: relative; overflow: hidden; }
  .frame { position: absolute; inset: 0.25in; border: 3px solid #5e8c6a; border-radius: 0.3in; pointer-events: none; }
  .logo { height: 0.85in; margin-top: 0.1in; }
  .eyebrow { margin: 0.3in 0 0; font-size: 15pt; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: #b07a2a; }
  h1 { margin: 0.08in 0 0; font-family: 'Playfair Display', serif; font-weight: 800; font-size: 54pt; line-height: 1; }
  .date { margin: 0.12in 0 0; font-size: 22pt; font-weight: 600; color: #35603f; }
  .photo { width: 100%; height: 3.1in; object-fit: cover; border-radius: 0.2in; margin-top: 0.3in; }
  .hours { margin-top: 0.3in; display: flex; align-items: baseline; gap: 0.18in; justify-content: center; }
  .hours span { font-size: 18pt; color: #6f635b; }
  .hours strong { font-family: 'Playfair Display', serif; font-size: 44pt; line-height: 1; }
  .body { margin: 0.15in auto 0; max-width: 5.6in; font-size: 15pt; line-height: 1.45; }
  .note { margin: 0.12in 0 0; font-size: 11pt; color: #6f635b; }
  .foot { margin-top: auto; width: 100%; padding: 0 0.2in 0.1in; display: flex; align-items: center; justify-content: space-between; gap: 0.3in; text-align: left; }
  .foot .where { font-size: 12pt; line-height: 1.5; }
  .foot .where b { font-size: 14pt; }
  .qr { display: flex; align-items: center; gap: 0.15in; }
  .qr svg { width: 1.25in; height: 1.25in; }
  .qr p { margin: 0; font-size: 11pt; line-height: 1.4; white-space: nowrap; }
</style></head>
<body><div class="page"><div class="frame"></div>
  <img class="logo" src="${asData('images/logo.png', 'image/png')}" alt="Hometown Studio">
  <p class="eyebrow">✦ ${esc(n.headline)} ✦</p>
  <h1>Craft Café</h1>
  <p class="date">${esc(longDate)}</p>
  <img class="photo" src="${asData('images/party-hero.jpg', 'image/jpeg')}" alt="">
  <div class="hours"><span>Open</span><strong>${esc(n.hours)}</strong></div>
  <p class="body">Walk in any time that day. Pick a craft, grab a seat, pay for what you make. No booking needed.</p>
  ${n.regularHours ? `<p class="note">One day only. Regular Craft Café hours are ${esc(n.regularHours)}.</p>` : ''}
  <div class="foot">
    <div class="where"><b>Hometown Studio</b><br>${esc(street)}<br>${esc(city)}, ${esc(state)}</div>
    <div class="qr">${qr}<p>Scan for the craft menu<br><b>${esc(shownUrl)}</b></p></div>
  </div>
</div></body></html>`

  mkdirSync('flyers', { recursive: true })
  const htmlPath = resolve('flyers', `${n.date}.html`)
  const pdfPath = resolve('flyers', `${n.date}.pdf`)
  writeFileSync(htmlPath, html)
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=8000', `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error('Chrome could not print the flyer:', r.stderr?.slice(0, 500))
    process.exit(1)
  }
  console.log(`Flyer: ${pdfPath}`)
}

main()
