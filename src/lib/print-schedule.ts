/**
 * Printable window schedules (Kaden, 17 Nov 2026: "one full, one Craft Café
 * only hours, one for just workshops ... pretty ... it's going to hang in our
 * window"; he picked layout A and wanted Catherine to have several options).
 *
 * Built from the PUBLIC calendar events (the same as /api/calendar.json), so
 * the sheet never shows what the website wouldn't: no open party times, booked
 * parties only as "Private party", classes moved off Square never twice.
 *
 * Three layouts (List = A, the default; Cards = B; Poster = C) × three
 * contents (full / café / workshops), letter portrait, one page per week.
 *
 * Pure: no env, no fetch. The /admin/print-schedule route feeds it events.
 */
import type { CalendarEvent } from '@components/calendar/calendar-view-model'

export type PrintLayout = 'list' | 'cards' | 'poster'
export type PrintShow = 'full' | 'cafe' | 'workshops'
export type ItemKind = 'cafe' | 'workshop' | 'party' | 'event' | 'closed'

export interface PrintItem {
  kind: ItemKind
  title: string
  /** "9 AM – 2 PM", "1:30 PM", or '' */
  time: string
  /** sort key, minutes after midnight (closed days first) */
  at: number
}

export interface PrintDay {
  ymd: string
  /** "Mon" */
  dow: string
  /** "Monday" */
  dowLong: string
  /** "Nov 23" */
  short: string
  /** "23" */
  dayNum: string
  items: PrintItem[]
  /** "Closed for Thanksgiving" when the studio is closed that day */
  closed: string | null
}

export const LAYOUTS: { id: PrintLayout; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'cards', label: 'Cards' },
  { id: 'poster', label: 'Poster' },
]
export const SHOWS: { id: PrintShow; label: string }[] = [
  { id: 'full', label: 'Full schedule' },
  { id: 'cafe', label: 'Craft Café hours only' },
  { id: 'workshops', label: 'Workshops only' },
]
export const MAX_DAYS = 14

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const asDate = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)) }
export function addDays(ymd: string, n: number): string {
  const t = asDate(ymd); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10)
}
/** The Monday on or before a date. */
export function mondayOf(ymd: string): string {
  const dow = asDate(ymd).getUTCDay()
  return addDays(ymd, -((dow + 6) % 7))
}
export const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(asDate(s).getTime())

/** "18:00" → { h:18, m:0 } minutes */
const mins = (hhmm?: string) => { if (!hhmm) return NaN; const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
function clock(total: number, withMeridiem: boolean): string {
  const h = Math.floor(total / 60) % 24, m = total % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  const base = m ? `${h12}:${String(m).padStart(2, '0')}` : `${h12}`
  return withMeridiem ? `${base} ${h < 12 ? 'AM' : 'PM'}` : base
}
/** "9 AM – 2 PM", "4 – 8 PM", "1:30 PM" */
export function timeRange(start?: string, end?: string): string {
  const a = mins(start), b = mins(end)
  if (Number.isNaN(a)) return ''
  if (Number.isNaN(b)) return clock(a, true)
  const same = (a < 720) === (b < 720)
  return `${clock(a, !same)} – ${clock(b, true)}`
}

/** The days to print, with what's on each, for one content choice. */
export function buildDays(events: CalendarEvent[], from: string, days: number, show: PrintShow): PrintDay[] {
  const n = Math.min(Math.max(Math.floor(days) || 7, 1), MAX_DAYS)
  const out: PrintDay[] = []
  for (let i = 0; i < n; i++) {
    const ymd = addDays(from, i)
    const d = asDate(ymd)
    const today = events.filter((e) => e.date === ymd)
    const closure = today.find((e) => e.kind === 'event' && /^Closed\b/.test(e.title))
    const items: PrintItem[] = []
    for (const e of today) {
      if (e.kind === 'party-available') continue // open party times are never printed
      if (e.kind === 'open-studio') {
        if (show === 'workshops') continue
        items.push({ kind: 'cafe', title: 'Craft Café', time: timeRange(e.startTime, e.endTime), at: mins(e.startTime) })
      } else if (e.kind === 'workshop') {
        if (show === 'cafe') continue
        items.push({ kind: 'workshop', title: e.title, time: timeRange(e.startTime, e.endTime), at: mins(e.startTime) })
      } else if (e.kind === 'party-booked') {
        if (show !== 'full') continue
        // Never a host's name: just that the room is booked, and when.
        const many = (e.bookedCount ?? 1) > 1
        items.push({ kind: 'party', title: many ? `${e.bookedCount} private parties` : 'Private party', time: many ? '' : timeRange(e.startTime), at: Number.isNaN(mins(e.startTime)) ? 900 : mins(e.startTime) })
      } else if (e.kind === 'event') {
        if (e === closure) continue
        if (show !== 'full') continue
        if (e.id === 'grand-opening') continue
        items.push({ kind: 'event', title: e.title, time: timeRange(e.startTime, e.endTime), at: Number.isNaN(mins(e.startTime)) ? 0 : mins(e.startTime) })
      }
    }
    items.sort((x, y) => x.at - y.at)
    out.push({
      ymd,
      dow: DOW[d.getUTCDay()],
      dowLong: DOW_LONG[d.getUTCDay()],
      short: `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`,
      dayNum: String(d.getUTCDate()),
      items,
      closed: closure ? closure.title : null,
    })
  }
  return out
}

/** "Monday, November 23 – Sunday, November 29" */
export function rangeLong(days: PrintDay[]): string {
  const f = (p: PrintDay) => { const d = asDate(p.ymd); return `${p.dowLong}, ${MON_LONG[d.getUTCMonth()]} ${d.getUTCDate()}` }
  return days.length === 1 ? f(days[0]) : `${f(days[0])} – ${f(days[days.length - 1])}`
}
/** "November 23 – 29", "November 30 – December 6" */
export function rangeShort(days: PrintDay[]): string {
  const a = asDate(days[0].ymd), b = asDate(days[days.length - 1].ymd)
  if (days.length === 1) return `${MON_LONG[a.getUTCMonth()]} ${a.getUTCDate()}`
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${MON_LONG[a.getUTCMonth()]} ${a.getUTCDate()} – ${b.getUTCDate()}`
    : `${MON_LONG[a.getUTCMonth()]} ${a.getUTCDate()} – ${MON_LONG[b.getUTCMonth()]} ${b.getUTCDate()}`
}
/** Monday through Sunday exactly: "This week at"; anything else: "Coming up at". */
const isWeek = (days: PrintDay[]) => days.length === 7 && days[0].dow === 'Mon'

/** One page per seven days: a two-week range prints as two clean pages. */
export function pagesOf(days: PrintDay[]): PrintDay[][] {
  const pages: PrintDay[][] = []
  for (let i = 0; i < days.length; i += 7) pages.push(days.slice(i, i + 7))
  return pages
}

/**
 * How tightly a page is set, so it never spills onto a second sheet: by the
 * lines it has to hold (a day with nothing still takes a line).
 */
export type Density = 'roomy' | 'snug' | 'tight'
export function densityOf(page: PrintDay[], layout: PrintLayout, show: PrintShow): Density {
  if (layout === 'poster') {
    const ws = page.reduce((n, d) => n + d.items.filter((i) => i.kind === 'workshop').length, 0)
    const cafe = show === 'workshops' ? 0 : page.length
    const load = cafe + ws * (show === 'workshops' ? 1.4 : 2.2)
    return load <= 12 ? 'roomy' : load <= 17 ? 'snug' : 'tight'
  }
  const lines = page.reduce((n, d) => n + Math.max(1, d.items.length), 0)
  if (layout === 'cards') {
    const tallest = Math.max(...page.map((d) => Math.max(1, d.items.length)))
    return tallest <= 3 && lines <= 11 ? 'roomy' : tallest <= 4 && lines <= 15 ? 'snug' : 'tight'
  }
  return lines <= 11 ? 'roomy' : lines <= 15 ? 'snug' : 'tight'
}

// ------------------------------------------------------------------ HTML

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const COL: Record<ItemKind, string> = { cafe: '#5f7f5a', workshop: '#7a4a2e', party: '#a08f80', event: '#a08f80', closed: '#b5523b' }

export const STUDIO = {
  name: 'Hometown Studio',
  address: '525 Hughes Rd, Ste F · Madison',
  phone: '(256) 464-1710',
  site: 'ourhometownstudio.com',
}

function footer(): string {
  return `<div class="foot"><div><div class="brand">${STUDIO.name}</div>${STUDIO.address}<br>${STUDIO.phone} · ${STUDIO.site}</div><div class="foot-r">Book classes &amp; parties<br><b>${STUDIO.site}</b></div></div>`
}

function heading(page: PrintDay[], show: PrintShow, layout: PrintLayout): { kick: string; h1: string; sub: string } {
  const when = isWeek(page) ? 'This week at' : 'Coming up at'
  if (layout === 'poster') {
    const h1 = show === 'cafe' ? 'Craft Café<br>hours' : show === 'workshops' ? 'Workshops<br>coming up' : 'Craft with us<br>this week'
    return { kick: '', h1: isWeek(page) || show !== 'full' ? h1 : 'Craft with us<br>soon', sub: `${rangeShort(page)} · ${STUDIO.name}` }
  }
  if (show === 'cafe') return { kick: `${STUDIO.name} · walk in`, h1: 'Craft Café hours', sub: rangeLong(page) }
  if (show === 'workshops') return { kick: `${STUDIO.name} · book ahead`, h1: 'Workshops', sub: rangeLong(page) }
  return { kick: when, h1: STUDIO.name, sub: rangeLong(page) }
}

/** What a day shows when it has nothing of the chosen kind. */
function emptyLine(day: PrintDay, show: PrintShow): PrintItem | null {
  if (day.closed) return { kind: 'closed', title: day.closed, time: '', at: 0 }
  if (show === 'cafe') return { kind: 'event', title: 'No Craft Café', time: '', at: 0 }
  if (show === 'full') return { kind: 'event', title: 'Closed', time: '', at: 0 }
  return null
}

function listPage(page: PrintDay[], show: PrintShow, d: Density): string {
  const h = heading(page, show, 'list')
  const days = show === 'workshops' ? page.filter((x) => x.items.length > 0) : page
  const rows = days.map((day) => {
    const lines = day.items.length ? day.items : [emptyLine(day, show)!].filter(Boolean)
    const items = lines.map((it) => `<div class="it"><span class="dot" style="background:${COL[it.kind]}"></span><span class="nm${it.kind === 'closed' ? ' cl' : ''}${it.title === 'No Craft Café' || it.title === 'Closed' ? ' mute' : ''}">${esc(it.title)}</span><span class="tm">${esc(it.time)}</span></div>`).join('')
    return `<div class="row"><div class="day"><b>${day.dow}</b><span>${day.short}</span></div><div class="evs">${items}</div></div>`
  }).join('')
  const empty = show === 'workshops' && days.length === 0
    ? '<div class="none">No workshops this week.<br><span>Walk in to Craft Café any open hour — see ourhometownstudio.com.</span></div>' : ''
  const kinds = new Set(page.flatMap((x) => x.items.map((i) => i.kind)))
  const key = show === 'full'
    ? `<div class="key">${([['cafe', 'Craft Café · walk in'], ['workshop', 'Workshop · book ahead'], ['party', 'Private party']] as [ItemKind, string][]).filter(([k]) => k !== 'party' || kinds.has('party') || kinds.has('event')).map(([k, n]) => `<span><i style="background:${COL[k]}"></i>${n}</span>`).join('')}</div>`
    : show === 'workshops' && days.length ? '<div class="key"><span>Book a seat at <b>ourhometownstudio.com</b></span></div>' : show === 'cafe' ? '<div class="key"><span>Walk in, no booking. Pick a craft and pay for what you make.</span></div>' : ''
  return `<section class="page list ${d}"><div class="kick">${esc(h.kick)}</div><h1>${h.h1}</h1><div class="sub">${esc(h.sub)}</div>${rows}${empty}${key}${footer()}</section>`
}

function cardsPage(page: PrintDay[], show: PrintShow, d: Density): string {
  const h = heading(page, show, 'cards')
  const days = show === 'workshops' ? page.filter((x) => x.items.length > 0) : page
  const tag = show === 'cafe' ? 'walk in to Craft Café, no booking' : show === 'workshops' ? 'book your seat at ourhometownstudio.com' : 'walk in to Craft Café, book workshops online'
  const cards = days.map((day) => {
    const off = !!day.closed && day.items.length === 0
    const body = off
      ? `<div class="closed">Closed<br><span>${esc(day.closed!.replace(/^Closed for\s*/i, 'For '))}</span></div>`
      : day.items.length
        ? day.items.map((it) => `<div class="it" style="border-left-color:${COL[it.kind]}"><div class="nm">${esc(it.title)}</div><div class="tm">${esc(it.time)}</div></div>`).join('')
        : `<div class="quiet">${show === 'cafe' ? 'No Craft Café' : 'Closed'}</div>`
    return `<div class="card${off ? ' off' : ''}"><div class="hd"><b>${day.dow}</b> ${day.short}</div>${body}</div>`
  }).join('')
  const empty = show === 'workshops' && days.length === 0
    ? '<div class="none">No workshops this week.<br><span>Walk in to Craft Café any open hour — see ourhometownstudio.com.</span></div>' : ''
  const h1 = show === 'full' ? `${h.kick === 'This week at' ? 'This week' : 'Coming up'} at ${STUDIO.name}` : h.h1
  return `<section class="page cards ${d}"><div class="top"><h1>${h1}</h1><p>${esc(rangeShort(page))} · ${tag}</p></div><div class="grid">${cards}</div>${empty}${footer()}</section>`
}

function posterPage(page: PrintDay[], show: PrintShow, d: Density): string {
  const h = heading(page, show, 'poster')
  let body = ''
  if (show !== 'workshops') {
    const rows = page.map((day) => {
      const cafe = day.items.filter((i) => i.kind === 'cafe').map((i) => i.time).join(' · ')
      const text = cafe || (day.closed ? 'Closed' : '—')
      // Full schedule: the room's other bookings, so nobody walks in on a private party.
      const busy = show === 'full' ? day.items.filter((i) => i.kind === 'party' || i.kind === 'event').map((i) => `${i.title}${i.time ? ` ${i.time}` : ''}`) : []
      const also = busy.length ? `<em>${esc(busy.join(' · '))}</em>` : ''
      return `<div class="cr"><b>${day.dow} ${day.dayNum}</b><span${!cafe ? ' class="mute"' : ''}>${esc(text)}${also}</span></div>`
    }).join('')
    const closures = [...new Set(page.filter((x) => x.closed).map((x) => x.closed!))]
    const note = closures.length ? `<div class="note">${closures.map((c) => esc(c)).join(' · ')}</div>` : ''
    body += `<div class="sec">Craft Café · walk in, no booking</div><div class="band">${rows}</div>${note}`
  }
  if (show !== 'cafe') {
    const ws = page.flatMap((day) => day.items.filter((i) => i.kind === 'workshop').map((i) => ({ day, i })))
    body += `<div class="sec">Workshops · book ahead</div>`
    body += ws.length
      ? ws.map(({ day, i }) => `<div class="ws"><div class="wd">${day.dow}<br><span>${day.short}</span></div><div><div class="wn">${esc(i.title)}</div><div class="wt">${esc(i.time)} · book at ${STUDIO.site}</div></div></div>`).join('')
      : `<div class="none small">No workshops this week — see Craft Café hours${show === 'workshops' ? ' at ourhometownstudio.com' : ' above'}.</div>`
  }
  return `<section class="page poster ${d}"><h1>${h.h1}</h1><div class="sub">${esc(h.sub)}</div>${body}${footer()}</section>`
}

/**
 * The last word on "never a second sheet": once the fonts are in, a page that
 * is too full steps down from roomy to snug, then shrinks its contents (never
 * the footer) a little at a time; only if that would go below 72% does it go
 * to tight (and shrink from there). It starts from roomy every time, so a page
 * is never set smaller than it needs to be.
 */
export const FIT_SCRIPT = `function fitPages(){
var L=['roomy','snug','tight'];
document.querySelectorAll('.page').forEach(function(p){
var over=function(){return p.scrollHeight>p.clientHeight+1};
var kids=[].slice.call(p.children).filter(function(k){return!k.classList.contains('foot')});
var zoom=function(z){kids.forEach(function(k){k.style.zoom=z===1?'':String(z)})};
var set=function(d){L.forEach(function(c){p.classList.remove(c)});p.classList.add(d);zoom(1)};
var shrink=function(floor){var z=1;while(over()&&z-0.03>=floor){z=Math.round((z-0.03)*100)/100;zoom(z)}};
set('roomy');
if(over()){set('snug');shrink(0.72)}
if(over()){set('tight');shrink(0.5)}
p.setAttribute('data-fit',over()?'over':'ok')})}`

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#faf8f5;color:#3b302a;font-family:Inter,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:letter portrait;margin:0}
.page{width:8.5in;height:11in;padding:.58in .62in;display:flex;flex-direction:column;overflow:hidden;background:#faf8f5;page-break-after:always;break-after:page}
.page:last-child{page-break-after:auto;break-after:auto}
h1{font-family:'Playfair Display',Georgia,serif;font-weight:700}
.foot{margin-top:auto;padding-top:14px;display:flex;justify-content:space-between;align-items:flex-end;font-size:15px;color:#6f635b;line-height:1.35}
.foot-r{text-align:right}.foot-r b{color:#7a4a2e}
.brand{font-family:'Playfair Display',Georgia,serif;font-size:22px;color:#7a4a2e;font-weight:700}
.none{font-family:'Playfair Display',Georgia,serif;font-size:30px;color:#7a4a2e;margin:40px 0}.none span{font-family:Inter,sans-serif;font-size:18px;color:#6f635b}
.none.small{font-size:22px;margin:6px 0}
.mute{color:#a69a8f!important;font-weight:500!important}
/* A: list */
.list .kick{letter-spacing:.2em;text-transform:uppercase;font-size:14px;color:#a0826a;font-weight:600}
.list h1{font-size:54px;color:#3b302a;margin:6px 0 4px;line-height:1.05}
.list .sub{font-size:19px;color:#6f635b;margin-bottom:26px}
.list .row{display:flex;border-top:1.5px solid #e6ddd3;padding:15px 0}
.list .row:last-of-type{border-bottom:1.5px solid #e6ddd3}
.list .day{width:130px;flex-shrink:0}.list .day b{display:block;font-family:'Playfair Display',Georgia,serif;font-size:28px}.list .day span{font-size:15px;color:#8a7c70}
.list .evs{flex:1;display:flex;flex-direction:column;gap:8px;justify-content:center}
.list .it{display:flex;align-items:center;gap:12px;font-size:21px}
.list .dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
.list .nm{font-weight:600;flex:1}.list .nm.cl{color:#b5523b}.list .tm{color:#5a4d44;font-weight:500;white-space:nowrap}
.list .key{display:flex;gap:22px;margin:18px 0 0;font-size:15px;color:#6f635b}
.list .key i{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:7px;vertical-align:-1px}
.list.snug h1{font-size:46px}.list.snug .sub{margin-bottom:16px}.list.snug .row{padding:10px 0}.list.snug .it{font-size:18px}.list.snug .evs{gap:5px}.list.snug .day b{font-size:24px}
.list.tight h1{font-size:40px}.list.tight .sub{font-size:16px;margin-bottom:10px}.list.tight .row{padding:6px 0}.list.tight .it{font-size:15.5px}.list.tight .evs{gap:3px}.list.tight .day b{font-size:20px}.list.tight .day span{font-size:13px}.list.tight .key{margin-top:10px}
/* B: cards */
.cards .top{background:#7a4a2e;color:#fff;margin:-.58in -.62in 26px;padding:40px .62in 30px}
.cards .top h1{font-size:46px;line-height:1.05}.cards .top p{font-size:19px;opacity:.85;margin-top:6px}
.cards .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-content:start}
.cards .card{background:#fff;border-radius:16px;padding:16px 18px;border:1.5px solid #eadfd3;min-height:150px}
.cards .card.off{background:#f3ece4}
.cards .hd{font-size:16px;color:#8a7c70;margin-bottom:10px}.cards .hd b{font-family:'Playfair Display',Georgia,serif;font-size:26px;color:#3b302a;margin-right:4px}
.cards .it{padding:6px 0 6px 12px;margin-bottom:8px;border-left:5px solid #ccc}.cards .nm{font-weight:600;font-size:19px}.cards .tm{font-size:17px;color:#6f635b}
.cards .closed{font-family:'Playfair Display',Georgia,serif;font-size:26px;color:#b5523b;padding-top:6px}.cards .closed span{font-family:Inter,sans-serif;font-size:16px;color:#8a7c70}
.cards .quiet{font-size:17px;color:#a69a8f;padding-top:4px}
.cards.snug .top{padding:30px .62in 22px;margin-bottom:18px}.cards.snug .top h1{font-size:40px}.cards.snug .grid{gap:12px}.cards.snug .card{min-height:0;padding:12px 15px}.cards.snug .it{margin-bottom:5px;padding:4px 0 4px 10px}.cards.snug .nm{font-size:16.5px}.cards.snug .tm{font-size:15px}.cards.snug .hd b{font-size:22px}
.cards.tight .top{padding:22px .62in 16px;margin-bottom:12px}.cards.tight .top h1{font-size:34px}.cards.tight .top p{font-size:16px}.cards.tight .grid{gap:9px}.cards.tight .card{min-height:0;padding:9px 12px}.cards.tight .hd{margin-bottom:5px}.cards.tight .hd b{font-size:19px}.cards.tight .it{margin-bottom:3px;padding:2px 0 2px 9px;border-left-width:4px}.cards.tight .nm{font-size:14px}.cards.tight .tm{font-size:13px}
/* C: poster */
.poster h1{font-size:60px;line-height:1.02;color:#7a4a2e}.poster .sub{font-size:20px;color:#6f635b;margin:10px 0 28px}
.poster .sec{font-size:15px;letter-spacing:.18em;text-transform:uppercase;font-weight:700;color:#a0826a;margin:6px 0 12px}
.poster .band{background:#fff;border:1.5px solid #eadfd3;border-radius:18px;padding:10px 24px;margin-bottom:24px}
.poster .cr{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px dashed #e6ddd3;font-size:21px}.poster .cr:last-child{border:0}.poster .cr b{font-family:'Playfair Display',Georgia,serif}
.poster .ws{display:flex;gap:20px;align-items:center;background:#7a4a2e;color:#fff;border-radius:18px;padding:20px 24px;margin-bottom:12px}
.poster .wd{font-family:'Playfair Display',Georgia,serif;font-size:28px;text-align:center;line-height:1;min-width:64px}.poster .wd span{font-family:Inter,sans-serif;font-size:14px;opacity:.85}
.poster .wn{font-family:'Playfair Display',Georgia,serif;font-size:27px;line-height:1.1}.poster .wt{font-size:17px;opacity:.9;margin-top:4px}
.poster .cr span{text-align:right}.poster .cr em{display:block;font-style:normal;font-size:.72em;color:#8a7c70;font-weight:500}
.poster .note{font-size:16px;color:#b5523b;margin:-12px 0 20px}
.poster.snug h1{font-size:48px}.poster.snug .sub{margin-bottom:18px}.poster.snug .cr{padding:7px 0;font-size:18px}.poster.snug .ws{padding:13px 20px;margin-bottom:8px}.poster.snug .wn{font-size:22px}.poster.snug .wt{font-size:15px}.poster.snug .wd{font-size:23px}
.poster.tight h1{font-size:40px}.poster.tight .sub{font-size:16px;margin-bottom:12px}.poster.tight .band{padding:4px 18px;margin-bottom:14px}.poster.tight .cr{padding:4px 0;font-size:15.5px}.poster.tight .ws{padding:8px 16px;margin-bottom:6px;border-radius:12px}.poster.tight .wn{font-size:17px}.poster.tight .wt{font-size:13px}.poster.tight .wd{font-size:18px;min-width:48px}.poster.tight .wd span{font-size:11px}
@media screen{body{padding:0}}
`

/** The whole printable document: one letter page per seven days. */
export function renderPrintSchedule(opts: { days: PrintDay[]; layout: PrintLayout; show: PrintShow; autoPrint?: boolean; title?: string }): string {
  const pages = pagesOf(opts.days).map((page) => {
    const d = densityOf(page, opts.layout, opts.show)
    return opts.layout === 'cards' ? cardsPage(page, opts.show, d) : opts.layout === 'poster' ? posterPage(page, opts.show, d) : listPage(page, opts.show, d)
  }).join('')
  const print = `<script>${FIT_SCRIPT}(function(){var go=function(){fitPages();${opts.autoPrint ? 'setTimeout(function(){window.print()},150)' : ''}};if(document.fonts&&document.fonts.ready){document.fonts.ready.then(go)}else{window.addEventListener('load',go)};fitPages();window.addEventListener('beforeprint',fitPages)})()</script>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=816"><meta name="robots" content="noindex, nofollow"><title>${esc(opts.title ?? 'Hometown Studio schedule')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>${pages}${print}</body></html>`
}
