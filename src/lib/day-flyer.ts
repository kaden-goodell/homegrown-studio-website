/**
 * The printable letter-size flyer for a Craft Café special day, in the same
 * words as the website's big card, with a QR code to the Craft Café page made
 * right here (no outside QR service). One builder for both:
 *   - /admin/flyer/<date> (owners print it from the iPad: Share › Print)
 *   - scripts/make-day-flyer.ts (a developer's PDF, from the same saved settings)
 *
 * Server only (qrcode).
 */
import QRCode from 'qrcode'
import { formatRange, type CafeSpecialDay } from '@config/hours'
import type { CafeHours } from '@config/hours'
import { regularCafeHours } from '@lib/special-day-notice'

export interface FlyerFacts {
  date: string
  /** "Grand Opening Day": the announcement's headline, or the day's name. */
  headline: string
  /** "Saturday, November 7" */
  longDate: string
  /** "9 AM – 8 PM" */
  hours: string
  /** "Saturdays 9 AM – 1 PM", or '' when there are no weekly café hours. */
  regularHours: string
}

/** The flyer's words for a special day (announced or not). */
export function flyerFacts(day: CafeSpecialDay, cafe: CafeHours): FlyerFacts {
  const [y, m, d] = day.date.split('-').map(Number)
  return {
    date: day.date,
    headline: day.announce?.headline || day.name || 'Craft Café',
    longDate: new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
    hours: formatRange(day.opens, day.closes),
    regularHours: regularCafeHours(cafe),
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface FlyerPage {
  facts: FlyerFacts
  /** The Craft Café page the QR code opens. */
  pageUrl: string
  logoSrc: string
  photoSrc: string
  address: { street: string; city: string; state: string }
  /** Adds the on-screen "Print" bar (the admin page); the script's PDF leaves it off. */
  printBar?: { backHref: string }
}

/** The whole flyer as an HTML document, letter size, ready to print. */
export async function flyerHtml(p: FlyerPage): Promise<string> {
  const qr = await QRCode.toString(p.pageUrl, { type: 'svg', margin: 0, color: { dark: '#3d3229', light: '#0000' } })
  const shownUrl = p.pageUrl.replace(/^https?:\/\/(www\.)?/, '')
  const n = p.facts
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Flyer · ${esc(n.headline)} · ${esc(n.longDate)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; }
  html { background: #e9e4dd; }
  body { margin: 0; font-family: 'Inter', sans-serif; color: #3d3229; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 12px; align-items: center; justify-content: center; flex-wrap: wrap; padding: 12px 16px; background: #3d3229; color: #fff; font-size: 15px; }
  .bar button, .bar a { font: inherit; font-weight: 600; border-radius: 999px; padding: 10px 18px; border: 0; cursor: pointer; text-decoration: none; }
  .bar button { background: #fff; color: #3d3229; }
  .bar a { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.5); }
  .wrap { padding: 16px 0; display: flex; justify-content: center; }
  .page { width: 8.5in; height: 11in; padding: 0.55in 0.6in; background: #f8f5f1; display: flex; flex-direction: column; align-items: center; text-align: center; position: relative; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.12); }
  @media screen and (max-width: 8.6in) { .page { zoom: 0.45; } }
  @media print { html { background: none; } .bar { display: none; } .wrap { padding: 0; } .page { box-shadow: none; zoom: 1; } }
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
<body>
${p.printBar ? `<div class="bar"><button type="button" onclick="window.print()">Print</button><a href="${esc(p.printBar.backHref)}">Back to admin</a><span>Letter paper, no margins. On an iPad: Share › Print.</span></div>` : ''}
<div class="wrap"><div class="page"><div class="frame"></div>
  <img class="logo" src="${esc(p.logoSrc)}" alt="Hometown Studio">
  <p class="eyebrow">✦ ${esc(n.headline)} ✦</p>
  <h1>Craft Café</h1>
  <p class="date">${esc(n.longDate)}</p>
  <img class="photo" src="${esc(p.photoSrc)}" alt="">
  <div class="hours"><span>Open</span><strong>${esc(n.hours)}</strong></div>
  <p class="body">Walk in any time that day. Pick a craft, grab a seat, pay for what you make. No booking needed.</p>
  ${n.regularHours ? `<p class="note">One day only. Regular Craft Café hours are ${esc(n.regularHours)}.</p>` : ''}
  <div class="foot">
    <div class="where"><b>Hometown Studio</b><br>${esc(p.address.street)}<br>${esc(p.address.city)}, ${esc(p.address.state)}</div>
    <div class="qr">${qr}<p>Scan for the craft menu<br><b>${esc(shownUrl)}</b></p></div>
  </div>
</div></div>
</body></html>`
}
