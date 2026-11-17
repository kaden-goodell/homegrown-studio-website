/**
 * The printable quote flyer (spec §7, S-55): one US Letter page in the
 * customer page's Invitation look. The event, every visible package with its
 * lines (dotted leaders, normal prices), the normal price per person crossed
 * out beside theirs, the total for the guests, and a QR code to the
 * customer's link made right here (no outside QR service). Owners only ever
 * see material numbers on the quote sheet: none of them reach this page.
 *
 * Shape follows src/lib/day-flyer.ts. Server only (qrcode).
 */
import QRCode from 'qrcode'
import { partyConfig } from '@config/party.config'
import { siteConfig } from '@config/site.config'
import { formatDay, formatTimeSpan } from '@lib/studio-time'
import { normalPerPerson, totalCents } from './money'
import type { Quote, QuoteLine } from './types'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** "$40", "$1,250", "$12.50". */
function usd(cents: number): string {
  const opts = cents % 100 === 0 ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  return `$${(cents / 100).toLocaleString('en-US', opts)}`
}

function longDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: partyConfig.timezone })
}

export interface QuoteFlyerOpts {
  /** The site the customer's link opens on (the request's origin). */
  origin: string
  firstName: string
  /** Where the print bar's "Back" goes. */
  backHref?: string
}

const lineHtml = (l: QuoteLine) =>
  `<li><span class="lbl">${esc(l.label)}</span><span class="dots"></span><span class="amt">${usd(l.cents)}<small>${l.per === 'person' ? ' /person' : ' /event'}</small></span></li>`

/** The whole flyer as an HTML document, letter size, ready to print. */
export async function quoteFlyerHtml(quote: Quote, opts: QuoteFlyerOpts): Promise<string> {
  const url = `${opts.origin.replace(/\/$/, '')}/quote/${quote.token}`
  const qr = await QRCode.toString(url, { type: 'svg', margin: 0, color: { dark: '#3d3229', light: '#0000' } })
  const tiers = quote.tiers.filter((t) => !t.hidden)
  const a = siteConfig.address
  const where = quote.place === 'away' ? quote.address : `Hometown Studio, ${a.street}, ${a.city}`
  const facts = [
    quote.startIso ? longDay(quote.startIso) : 'Date to be set',
    quote.startIso && quote.endIso ? formatTimeSpan(quote.startIso, quote.endIso) : '',
    `${quote.guests} guests`,
  ].filter(Boolean)
  const greeting = opts.firstName ? `For ${opts.firstName}` : 'For you'
  const cols = Math.max(1, tiers.length)

  const tierHtml = tiers.map((t) => {
    const normal = normalPerPerson(t, quote.guests)
    const showNormal = normal > t.priceCents
    return `<section class="tier">
      <h2>${esc(t.name)}</h2>
      <ul>${t.lines.map(lineHtml).join('')}</ul>
      <div class="price">${showNormal ? `<s>${usd(normal)}</s> ` : ''}<strong>${usd(t.priceCents)}</strong> <span>per person</span></div>
      <div class="total">${usd(totalCents(t.priceCents, quote.guests))} for ${quote.guests} guests</div>
    </section>`
  }).join('\n')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Flyer · ${esc(greeting)}${quote.startIso ? ` · ${esc(formatDay(quote.startIso))}` : ''}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,500;1,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
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
  .page { width: 8.5in; height: 11in; padding: 0.45in; background: #efe6da; position: relative; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.12); }
  @media screen and (max-width: 8.6in) { .page { zoom: 0.45; } }
  @media print { html, body { height: 11in; overflow: hidden; } html { background: none; } .bar { display: none; } .wrap { padding: 0; } .page { box-shadow: none; zoom: 1; height: 10.95in; break-after: avoid; page-break-after: avoid; break-inside: avoid; } }
  .card { height: 100%; background: #fffdf9; border: 4px double #c4a882; outline: 1px solid #c4a882; outline-offset: 5px; padding: 0.4in 0.45in 0.3in; display: flex; flex-direction: column; align-items: center; text-align: center; overflow: hidden; }
  .eyebrow { margin: 0; font-size: 11pt; font-weight: 700; letter-spacing: 0.24em; text-transform: uppercase; color: #7a4a2e; }
  h1 { margin: 0.12in 0 0; font-family: 'Playfair Display', serif; font-style: italic; font-weight: 700; font-size: 40pt; line-height: 1.05; }
  .for { margin: 0.08in 0 0; font-family: 'Playfair Display', serif; font-style: italic; font-weight: 500; font-size: 16pt; color: #7a4a2e; }
  .facts { margin: 0.16in 0 0; font-size: 12.5pt; font-weight: 600; }
  .facts span + span::before { content: '·'; margin: 0 0.1in; color: #c4a882; }
  .where { margin: 0.05in 0 0; font-size: 11pt; color: #6f635b; }
  .rule { width: 1.4in; height: 1px; background: #c4a882; margin: 0.2in auto 0; }
  .tiers { margin-top: 0.22in; width: 100%; display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 0.22in; text-align: left; }
  .tier { border: 1px solid #e3d6c3; border-radius: 0.1in; padding: 0.16in 0.16in 0.14in; display: flex; flex-direction: column; }
  .tier h2 { margin: 0 0 0.1in; font-family: 'Playfair Display', serif; font-style: italic; font-weight: 700; font-size: 17pt; text-align: center; }
  .tier ul { list-style: none; margin: 0; padding: 0; font-size: 9.5pt; line-height: 1.35; flex: 1; }
  .tier li { display: flex; align-items: baseline; gap: 4px; margin: 0 0 0.05in; }
  .tier .lbl { flex: 0 1 auto; }
  .tier .dots { flex: 1 1 0.2in; min-width: 0.2in; border-bottom: 1.5px dotted #c4a882; transform: translateY(-3px); }
  .tier .amt { flex: 0 0 auto; white-space: nowrap; color: #6f635b; }
  .tier .amt small { font-size: 7.5pt; }
  .price { margin-top: 0.12in; text-align: center; font-size: 11pt; }
  .price s { color: #9a8d82; }
  .price strong { font-family: 'Playfair Display', serif; font-size: 20pt; color: #7a4a2e; }
  .price span { color: #6f635b; font-size: 9.5pt; }
  .total { margin-top: 0.03in; text-align: center; font-size: 10pt; font-weight: 600; }
  .note { margin: 0.2in auto 0; max-width: 5.8in; font-family: 'Playfair Display', serif; font-style: italic; font-size: 12pt; line-height: 1.45; }
  .foot { margin-top: auto; width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 0.3in; text-align: left; padding-top: 0.2in; }
  .foot .reply { font-size: 11pt; line-height: 1.55; }
  .foot .reply b { font-family: 'Playfair Display', serif; font-style: italic; font-size: 14pt; }
  .qr { display: flex; align-items: center; gap: 0.15in; }
  .qr svg { width: 1.2in; height: 1.2in; }
  .qr p { margin: 0; font-size: 10pt; line-height: 1.4; white-space: nowrap; }
</style></head>
<body>
<div class="bar"><button type="button" onclick="window.print()">Print</button>${opts.backHref ? `<a href="${esc(opts.backHref)}">Back to admin</a>` : ''}<span>Letter paper. On an iPad: tap Share, then Print.</span></div>
<div class="wrap"><div class="page"><div class="card">
  <p class="eyebrow">Hometown Studio</p>
  <h1>An Evening of Making</h1>
  <p class="for">${esc(greeting)}</p>
  <p class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</p>
  <p class="where">${esc(where)}</p>
  <div class="rule"></div>
  <div class="tiers">${tierHtml}</div>
  ${quote.note.trim() ? `<p class="note">${esc(quote.note.trim())}</p>` : ''}
  <div class="foot">
    <div class="reply"><b>Kindly reply by ${esc(formatDay(quote.expiresAt))}</b><br>Pick a package and reserve with a ${quote.depositPct}% deposit.<br>Questions? Text us at ${esc(siteConfig.contactPhone)}</div>
    <div class="qr">${qr}<p>Scan to see it<br>and reserve</p></div>
  </div>
</div></div></div>
</body></html>`
}
