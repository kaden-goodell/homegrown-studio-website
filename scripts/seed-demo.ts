/**
 * Demo seed for the branch preview, so Kaden can click through everything.
 *
 * Talks ONLY to the preview (Square SANDBOX, its own stores, emails and texts
 * muted) over its own /admin and /staff APIs:
 *   https://kaden-own-booking-system--iridescent-croissant-494fc3.netlify.app
 * Any other host is refused before a request goes out. The live site and the
 * live Square catalog are only READ (GET), for the real classes' words,
 * prices, dates and photos.
 *
 * Run it (the passcodes go straight from the branch's Netlify env into this
 * process and are never printed):
 *
 *   M=/Users/catherine/source/homegrownStudio; ADMIN_PASSCODE="$(cd $M && netlify env:get ADMIN_PASSCODE --context branch:kaden/own-booking-system)" STAFF_PASSCODE="$(cd $M && netlify env:get STAFF_PASSCODE --context branch:kaden/own-booking-system)" npx tsx scripts/seed-demo.ts
 *
 * Options:
 *   --dry-run   say what it would make; reads the live list, writes nothing
 *   --classes-only  just the copies of the live classes
 *   --remove    cancel every demo class (never refunds) and archive its library
 *               entry, turn DEMO10 off, hide the demo crafts on the website and
 *               mark the demo crew "No longer working here"
 *
 * Re-runnable: everything is looked up first (library entries by the demo
 * note and name, classes by library entry and start), so a second run adds
 * nothing twice. Nothing it makes is named "E2E …" (the sandbox suite's
 * cleanup deletes those).
 */
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import {
  actAsOwner, addDays, chicagoDate, MissingSecretError, OWNER_HEADERS, PreviewClient, PREVIEW_ORIGIN, readSecrets, redact, sayReply, type Reply,
} from './lib/sandbox-e2e/core'
import {
  contentFromLive, craftFromLive, DEMO_CRAFT_NAMES, DEMO_CREW, DEMO_NOTE, DEMO_PROMO, isDemoLibrary, libraryName, LiveReader, parseSeedArgs, sessionAt, slotFor,
  workshopFromCatalog, type LiveWorkshop,
} from './lib/demo-seed/core'

type Log = (line: string) => void

export interface SeedCtx {
  admin: PreviewClient
  staff: PreviewClient
  live: LiveReader
  log: Log
  now: Date
  dryRun: boolean
  made: string[]
  skipped: string[]
}

const DAY = 86_400_000

function ok(r: Reply, what: string, wanted = 200): any {
  if (r.status !== wanted) throw new Error(`${what}: ${sayReply(r)}`)
  return r.body
}

const adminGet = (ctx: SeedCtx, p: string) => ctx.admin.request('GET', p, { headers: OWNER_HEADERS })
const adminPost = (ctx: SeedCtx, p: string, body: unknown) => ctx.admin.request('POST', p, { body, headers: OWNER_HEADERS })

/** Reads a local .env value (the live Square token), never printed. */
function dotenv(key: string): string | null {
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8')
    for (const line of text.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '').trim() || null
    }
  } catch { /* no .env */ }
  return null
}

// ── Library and classes ────────────────────────────────────────────────────

export async function demoLibrary(ctx: SeedCtx, archived = false): Promise<any[]> {
  const body = ok(await adminGet(ctx, `/api/admin/classes/library.json${archived ? '?archived=1' : ''}`), 'Read the class library')
  return (body.data.library ?? []).filter(isDemoLibrary)
}

async function classesAround(ctx: SeedCtx): Promise<any[]> {
  const from = new Date(ctx.now.getTime() - DAY).toISOString()
  const to = new Date(ctx.now.getTime() + 400 * DAY).toISOString()
  const body = ok(await adminGet(ctx, `/api/admin/classes/classes.json?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`), 'Read the classes')
  return Array.isArray(body.data) ? body.data : body.data?.classes ?? []
}

/** Uploads a live photo through the preview's own class-photo upload; its preview URL, or null (said why). */
export async function copyPhoto(ctx: SeedCtx, liveUrl: string | null | undefined, name: string): Promise<string | null> {
  if (!liveUrl) return null
  try {
    const { bytes, type } = await ctx.live.photo(liveUrl)
    const form = new FormData()
    form.append('file', new Blob([bytes as BlobPart], { type }), type === 'image/png' ? 'photo.png' : type === 'image/webp' ? 'photo.webp' : 'photo.jpg')
    const r = await ctx.admin.upload('/api/admin/classes/photo.json', form, OWNER_HEADERS)
    return ok(r, `Upload the photo for ${name}`).data.url
  } catch (e) {
    ctx.skipped.push(`${name}: photo not copied (${e instanceof Error ? e.message : String(e)})`)
    return null
  }
}

/** The demo library entry with this name (made with the demo note, photo copied, on first sight). */
export async function ensureLibrary(ctx: SeedCtx, lib: any[], content: any, livePhoto: string | null | undefined): Promise<any> {
  const have = lib.find((l) => libraryName(l).toLowerCase() === String(content.name).toLowerCase())
  if (have) return have
  if (ctx.dryRun) { ctx.log(`  would add ${content.name} to the library`); return { id: `dry:${content.name}`, versions: [{ content }] } }
  const imageUrl = await copyPhoto(ctx, livePhoto, content.name)
  const saved = ok(await adminPost(ctx, '/api/admin/classes/library.json', { action: 'save', content: { ...content, imageUrl }, note: DEMO_NOTE }), `Add ${content.name} to the library`)
  const entry = saved.data.library
  lib.push(entry)
  ctx.made.push(`library: ${content.name}${imageUrl ? ' (with photo)' : ''}`)
  return entry
}

/** One class on the preview from a library entry, unless one already starts then (status not cancelled). */
export async function ensureClass(
  ctx: SeedCtx, classes: any[], entry: any, sessions: { startIso: string; endIso: string; capacity: number }[], extra: Record<string, unknown> = {},
): Promise<any | null> {
  const name = libraryName(entry)
  const first = sessions[0].startIso
  const have = classes.find((c) => c.libraryId === entry.id && c.status !== 'cancelled' && c.sessions?.[0]?.startIso === first)
  const when = `${chicagoDate(first)} ${new Date(first).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })}`
  if (have) { ctx.log(`  already there: ${name} ${when}`); return have }
  if (ctx.dryRun) { ctx.log(`  would schedule ${name} ${when}`); return null }
  const r = await adminPost(ctx, '/api/admin/classes/classes.json', { action: 'create', libraryId: entry.id, sessions, status: 'open', ...extra })
  if (r.status !== 200) {
    ctx.skipped.push(`${name} ${when}: ${sayReply(r)}`)
    ctx.log(`  NOT scheduled: ${name} ${when} (${sayReply(r)})`)
    return null
  }
  const cls = r.body.data.class
  classes.push(cls)
  ctx.made.push(`class: ${name} ${when}${r.body.warning ? ` (warning: ${r.body.warning})` : ''}`)
  ctx.log(`  scheduled ${name} ${when}${r.body.warning ? ` (warning: ${r.body.warning})` : ''}`)
  return cls
}

// ── Sections ───────────────────────────────────────────────────────────────

/** Every class on the live site today, copied at its own date and time (or the next week's when it's too soon). */
export async function seedLiveWorkshops(ctx: SeedCtx, lib: any[], classes: any[]): Promise<void> {
  ctx.log('\nThe live classes:')
  const live: LiveWorkshop[] = (await ctx.live.workshops()).filter((w) => w?.name && w.startTime && !/^TEST\b/i.test(w.name))
  ctx.log(`  the live site lists ${live.length}`)
  for (const w of live) {
    const content = contentFromLive(w)
    const entry = await ensureLibrary(ctx, lib, content, w.imageUrl)
    const slot = slotFor(w.startTime, content.defaultMinutes, ctx.now)
    await ensureClass(ctx, classes, entry, [{ ...slot, capacity: content.defaultCapacity }])
  }
}

const FAMILY_COPY = [
  'Paint a pumpkin side by side with the whole family.',
  'Everyone picks their own paints and decorates a pumpkin however they want. No experience needed.',
  'Each guest goes home with the pumpkin they paint. Ages 8 and up, with a grown-up.',
].join('\n\n')

const CAMP_COPY = [
  'Four mornings of crafts in December, with something new to make each day.',
  'Everyone paints, beads, stitches and builds a different project every morning. No experience needed.',
  'Each guest goes home with everything they make. Ages 8 and up. This is a drop-off class, so parents can head out and come back for pickup.',
].join('\n\n')

const today = (ctx: SeedCtx) => chicagoDate(ctx.now)
/** A demo library entry already has a class still to come (so a re-run leaves it alone). */
const hasUpcoming = (classes: any[], entry: any, now: Date) =>
  classes.some((c) => c.libraryId === entry.id && c.status !== 'cancelled' && Date.parse(c.sessions?.at(-1)?.endIso ?? '') > now.getTime())
/** The session moved a week at a time until it's in the future (a re-run weeks later still lands on the same weekday and time). */
const future = (ctx: SeedCtx, s: { startIso: string; endIso: string; capacity: number }) => {
  const minutes = Math.round((Date.parse(s.endIso) - Date.parse(s.startIso)) / 60_000)
  return { ...slotFor(s.startIso, minutes, ctx.now, 24), capacity: s.capacity }
}

/** Family class (Adult + Kid tickets), camp (two passes), a full class with comps, the early-bird, the Repeat series. */
export async function seedExtraClasses(ctx: SeedCtx, lib: any[], classes: any[], catalog: any[]): Promise<void> {
  ctx.log('\nThe extra classes:')
  // Family Pumpkin Painting: Adult $25 + Kid $15. Sunday 6–8 PM.
  const family = await ensureLibrary(ctx, lib, {
    ...contentFromLive({ name: 'Family Pumpkin Painting', description: FAMILY_COPY, price: 2500, startTime: '2026-11-22T00:00:00Z', duration: 120 }),
    ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
    prices: { all: { adult: 2500, kid: 1500 } },
  }, null)
  if (!hasUpcoming(classes, family, ctx.now)) await ensureClass(ctx, classes, family, [future(ctx, sessionAt('2026-11-22', '18:00', '20:00'))])
  else ctx.log('  already there: Family Pumpkin Painting')

  // Winter Craft Camp: Mon–Thu mornings, Dec 14–17 (the week before the Christmas closure), Full series $120 / Any one day $35.
  const camp = await ensureLibrary(ctx, lib, {
    ...contentFromLive({ name: 'Winter Craft Camp', description: CAMP_COPY, price: 12000, startTime: '2026-12-14T15:00:00Z', duration: 180 }),
    passes: [{ id: 'all', label: 'Full series', covers: { kind: 'all' } }, { id: 'day', label: 'Any one day', covers: { kind: 'choose', count: 1 } }],
    prices: { all: { person: 12000 }, day: { person: 3500 } },
    defaultCapacity: 20,
  }, null)
  if (!hasUpcoming(classes, camp, ctx.now)) {
    await ensureClass(ctx, classes, camp, ['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17'].map((d) => sessionAt(d, '09:00', '12:00', 20)))
  } else ctx.log('  already there: Winter Craft Camp')

  // Needlepoint 101 (live catalog words, price and photo): 2 seats, both comped, so "Join the waitlist" shows. Saturday 7–9 PM.
  const needleItem = catalog.find((o) => o.type === 'ITEM' && !o.is_deleted && o.item_data?.name === 'Needlepoint 101')
  const needleLive = needleItem ? workshopFromCatalog(needleItem, catalog, '2026-11-29T01:00:00Z') : null
  if (!needleLive) ctx.skipped.push('Needlepoint 101: not in the live catalog')
  else {
    const needle = await ensureLibrary(ctx, lib, contentFromLive(needleLive), needleLive.imageUrl)
    let cls = classes.find((c) => c.libraryId === needle.id && c.status !== 'cancelled' && Date.parse(c.sessions[0].startIso) > ctx.now.getTime())
    if (!cls) cls = await ensureClass(ctx, classes, needle, [{ ...future(ctx, sessionAt('2026-11-28', '19:00', '21:00')), capacity: 2 }])
    else ctx.log('  already there: Needlepoint 101')
    if (cls && !ctx.dryRun) await fillWithComps(ctx, cls)
  }

  // Early-bird: Christmas Earring Bar again on Sunday Nov 29, $29 until a week from today (regular $35).
  const earring = lib.find((l) => libraryName(l) === 'Christmas Earring Bar')
  if (!earring) ctx.skipped.push('Early-bird: the Christmas Earring Bar copy is missing')
  else {
    const content = { ...earring.versions.at(-1).content, earlyBird: { untilYmd: addDays(today(ctx), 7), prices: { all: { person: 2900 } } } }
    await ensureClass(ctx, classes, earring, [future(ctx, sessionAt('2026-11-29', '18:00', '20:00'))], { content })
  }

  // Repeat: Knitting Earwarmer every Sunday 6–8 PM, Jan 3, 10 and 17 (the first free run of three Sundays; Dec 21–Jan 1 is closed).
  const knit = lib.find((l) => libraryName(l) === 'Knitting Earwarmer')
  if (!knit) ctx.skipped.push('Repeat: the Knitting Earwarmer copy is missing')
  else if (classes.some((c) => c.libraryId === knit.id && c.seriesId && c.status !== 'cancelled')) ctx.log('  already there: Knitting Earwarmer weekly series')
  else if (ctx.dryRun) ctx.log('  would repeat Knitting Earwarmer on Sundays Jan 3, 10, 17')
  else await repeatSeries(ctx, classes, knit)
}

async function repeatSeries(ctx: SeedCtx, classes: any[], entry: any): Promise<void> {
  const createKey = `demo-repeat-${entry.id}`.slice(0, 80)
  const body = { action: 'repeat', libraryId: entry.id, sessions: [sessionAt('2027-01-03', '18:00', '20:00')], pattern: { every: 1, untilYmd: '2027-01-17' }, skip: [], status: 'open', createKey }
  // A reply that ran out of time says `left`: the same body again carries on (and answers with every date made so far).
  const made = new Set<string>(), skipped = new Map<string, string>()
  for (let i = 0; i < 6; i++) {
    const r = await adminPost(ctx, '/api/admin/classes/classes.json', body)
    if (r.status !== 200) { ctx.skipped.push(`Repeat Knitting Earwarmer: ${sayReply(r)}`); break }
    const d = r.body.data
    for (const c of d.created ?? []) if (!made.has(c.ymd)) { made.add(c.ymd); classes.push(c.class) }
    for (const s of d.skipped ?? []) skipped.set(s.ymd, s.reason)
    if (!(d.left ?? []).length) break
  }
  for (const ymd of [...made].sort()) ctx.made.push(`series: Knitting Earwarmer ${ymd}`)
  for (const [ymd, why] of skipped) ctx.skipped.push(`series date ${ymd}: ${why}`)
}

/** Comps "Demo Guest 1" and "Demo Guest 2" into a class until it's full (each comp's attempt id is fixed, so a re-run never adds a third). */
async function fillWithComps(ctx: SeedCtx, cls: any): Promise<void> {
  if (!ctx.staff.jar.has('hg_staff')) throw new Error('Not signed in to /staff, so the comps can’t be added')
  for (const n of [1, 2]) {
    const r = await ctx.staff.post('/api/staff/comp-seat.json', {
      scheduleId: cls.id, givenName: 'Demo', familyName: `Guest ${n}`, email: 'kaden+demo@ourhometownstudio.com', phone: '(402) 980-2907',
      passId: 'all', tickets: { person: 1 }, attempt: `demo-comp-${cls.id}-${n}`, reason: 'Demo seed: fills the class so the waitlist shows',
    })
    if (r.status !== 200) { ctx.skipped.push(`Comp Demo Guest ${n}: ${sayReply(r)}`); continue }
    if (!r.body.data?.replayed) ctx.made.push(`comp: Demo Guest ${n} in ${cls.content?.name}`)
  }
}

/** DEMO10: 10% off every class, ends in a month, 50 uses. */
export async function seedPromo(ctx: SeedCtx): Promise<void> {
  ctx.log('\nThe promo code:')
  const list = ok(await adminGet(ctx, '/api/admin/promos.json'), 'Read the promo codes').data.codes ?? []
  const have = list.find((c: any) => c.code === DEMO_PROMO.code)
  if (have?.active) { ctx.log('  already there: DEMO10'); return }
  if (ctx.dryRun) { ctx.log('  would add DEMO10'); return }
  if (have) {
    const r = await adminPost(ctx, '/api/admin/promos.json', { action: 'active', code: have.code, active: true, expectedUpdatedAt: have.updatedAt })
    if (r.status === 200) ctx.made.push('promo: DEMO10 turned back on'); else ctx.skipped.push(`DEMO10: ${sayReply(r)}`)
    return
  }
  const r = await adminPost(ctx, '/api/admin/promos.json', { action: 'save', expectedUpdatedAt: null, fields: { ...DEMO_PROMO, endsYmd: addDays(today(ctx), 30) } })
  if (r.status === 200) ctx.made.push(`promo: DEMO10 (10% off, ends ${addDays(today(ctx), 30)}, 50 uses)`); else ctx.skipped.push(`DEMO10: ${sayReply(r)}`)
}

/** Party crafts copied from the live catalog (words, price, badge, photo) into the sandbox's party craft category. */
export async function seedCrafts(ctx: SeedCtx, catalog: any[]): Promise<void> {
  ctx.log('\nThe party crafts:')
  const now = ok(await adminGet(ctx, '/api/admin/crafts.json'), 'Read the crafts').data
  if (now.refusal) { ctx.skipped.push(`Crafts: ${now.refusal}`); return }
  for (const name of DEMO_CRAFT_NAMES) {
    const item = catalog.find((o) => o.type === 'ITEM' && !o.is_deleted && o.item_data?.name === name)
    const craft = item ? craftFromLive(item, catalog) : null
    if (!craft) { ctx.skipped.push(`Craft ${name}: not in the live catalog`); continue }
    const have = now.crafts.find((c: any) => c.name === name)
    if (have) {
      ctx.log(`  already there: ${name}`)
      if (have.hidden && !ctx.dryRun) await adminPost(ctx, '/api/admin/crafts.json', { action: 'show', id: have.id })
      continue
    }
    if (ctx.dryRun) { ctx.log(`  would add ${name} ($${craft.cents / 100})`); continue }
    const requestId = `demo-craft-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 64)
    const r = await adminPost(ctx, '/api/admin/crafts.json', { action: 'create', requestId, name, description: craft.description, cents: craft.cents, popular: craft.popular })
    if (r.status !== 200) { ctx.skipped.push(`Craft ${name}: ${sayReply(r)}`); continue }
    const made = r.body.data.craft
    ctx.made.push(`craft: ${name} $${craft.cents / 100}${r.body.warning ? ` (warning: ${r.body.warning})` : ''}`)
    const photo = await copyPhoto(ctx, craft.photoUrl, name)
    if (photo) {
      const p = await adminPost(ctx, '/api/admin/crafts.json', { action: 'photo', id: made.id, photoUrl: photo })
      if (p.status !== 200) ctx.skipped.push(`Craft photo ${name}: ${sayReply(p)}`)
    }
  }
}

/** Demo Crew Sam and Jess on the staff list, each with weekly times they can work. */
export async function seedCrew(ctx: SeedCtx, staffPasscode: string): Promise<void> {
  ctx.log('\nThe demo crew:')
  const people = ok(await adminGet(ctx, '/api/admin/staff-people.json'), 'Read the staff list').data.people ?? []
  const times: Record<string, any>[] = [
    { '4': { kind: 'can', range: { from: '17:30', to: '20:30' }, note: '' }, '6': { kind: 'can', range: { from: '09:00', to: '21:00' }, note: '' } },
    { '5': { kind: 'can', range: { from: '16:00', to: '21:00' }, note: '' }, '0': { kind: 'can', range: { from: '12:30', to: '20:00' }, note: '' } },
  ]
  for (const [i, p] of DEMO_CREW.entries()) {
    let person = people.find((x: any) => x.givenName === p.givenName && x.familyName === p.familyName)
    if (person && !person.active && !ctx.dryRun) await adminPost(ctx, '/api/admin/staff-people.json', { action: 'return', id: person.id })
    if (!person) {
      if (ctx.dryRun) { ctx.log(`  would add ${p.givenName} ${p.familyName}`); continue }
      const r = await adminPost(ctx, '/api/admin/staff-people.json', { action: 'add', ...p, role: 'crew', phone: '' })
      if (r.status !== 200) { ctx.skipped.push(`${p.givenName} ${p.familyName}: ${sayReply(r)}`); continue }
      person = r.body.data.person
      ctx.made.push(`crew: ${p.givenName} ${p.familyName}`)
    } else ctx.log(`  already there: ${p.givenName} ${p.familyName}`)
    if (ctx.dryRun) continue
    // Their times are theirs to set, so sign in to /staff as them (a client of its own) and save a usual week.
    const crew = new PreviewClient()
    try {
      ok(await crew.post('/api/staff/login.json', { passcode: staffPasscode }), 'Staff passcode')
      ok(await crew.post('/api/staff/pick.json', { passcode: staffPasscode, staffId: person.id }), `Pick ${p.familyName}`)
      const mine = ok(await crew.get('/api/staff/shifts.json'), 'Read their shifts').data.availability
      const weekly = { ...mine.weekly, ...times[i] }
      if (JSON.stringify(mine.weekly) === JSON.stringify(weekly)) continue
      ok(await crew.post('/api/staff/shifts.json', { action: 'availability', weekly, dates: mine.dates, expectedUpdatedAt: mine.updatedAt }), 'Save their times')
      ctx.made.push(`times: ${p.givenName} ${p.familyName}`)
    } catch (e) {
      ctx.skipped.push(`${p.familyName}'s times: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await crew.request('DELETE', '/api/staff/login.json').catch(() => undefined)
    }
  }
}

/** Café hours, special days and closed days saved (from the config when nothing is saved yet), and online booking open for everything. */
export async function seedSettings(ctx: SeedCtx): Promise<void> {
  ctx.log('\nStudio settings and online booking:')
  const s = ok(await adminGet(ctx, '/api/admin/settings.json'), 'Read the studio settings').data.settings
  if (s.updatedAt) ctx.log(`  café hours, ${s.cafeSpecialDays.length} special day(s) and ${s.closures.length} closed stretch(es) already saved`)
  else if (ctx.dryRun) ctx.log('  would save the config’s café hours, special days and closed days')
  else {
    const r = await adminPost(ctx, '/api/admin/settings.json', { studioWeekly: s.studioWeekly, cafeWeekly: s.cafeWeekly, cafeSpecialDays: s.cafeSpecialDays, closures: s.closures, expectedUpdatedAt: null })
    if (r.status === 200) ctx.made.push('settings: café hours, special days and closed days saved from the config'); else ctx.skipped.push(`Settings: ${sayReply(r)}`)
  }
  const b = ok(await adminGet(ctx, '/api/admin/online-booking.json'), 'Read online booking').data
  const allOpen = b.open.parties && b.open.workshops && b.open.kits
  if (allOpen) { ctx.log(`  online booking already open for parties, workshops and kits (${b.source === 'setup' ? 'from the hosting settings' : 'saved'})`); return }
  if (ctx.dryRun) { ctx.log('  would open online booking for everything'); return }
  const r = await adminPost(ctx, '/api/admin/online-booking.json', { open: { parties: true, workshops: true, kits: true }, pauseNote: b.pauseNoteWritten ? b.pauseNote : '', expectedUpdatedAt: b.updatedAt })
  if (r.status === 200) ctx.made.push('online booking: open for parties, workshops and kits'); else ctx.skipped.push(`Online booking: ${sayReply(r)}`)
}

/** --remove: cancel every class made from a demo library entry (never refunds), then archive the entries. */
export async function removeDemo(ctx: SeedCtx): Promise<void> {
  const lib = await demoLibrary(ctx)
  const ids = new Set(lib.map((l) => l.id))
  const classes = (await classesAround(ctx)).filter((c) => ids.has(c.libraryId) && c.status !== 'cancelled')
  for (const c of classes) {
    const r = await adminPost(ctx, '/api/admin/classes/classes.json', { action: 'cancel', id: c.id, expectedUpdatedAt: c.updatedAt })
    if (r.status === 200) ctx.made.push(`cancelled ${c.content?.name} ${chicagoDate(c.sessions[0].startIso)}`)
    else ctx.skipped.push(`cancel ${c.content?.name}: ${sayReply(r)}`)
  }
  // DEMO10 off (codes are never deleted).
  const codes = ok(await adminGet(ctx, '/api/admin/promos.json'), 'Read the promo codes').data.codes ?? []
  const promo = codes.find((c: any) => c.code === DEMO_PROMO.code && c.active)
  if (promo) {
    const r = await adminPost(ctx, '/api/admin/promos.json', { action: 'active', code: promo.code, active: false, expectedUpdatedAt: promo.updatedAt })
    if (r.status === 200) ctx.made.push('turned off DEMO10'); else ctx.skipped.push(`DEMO10: ${sayReply(r)}`)
  }
  // The demo crafts hidden on the website (catalog items are never deleted).
  const crafts = ok(await adminGet(ctx, '/api/admin/crafts.json'), 'Read the crafts').data.crafts ?? []
  for (const c of crafts.filter((x: any) => (DEMO_CRAFT_NAMES as readonly string[]).includes(x.name) && !x.hidden)) {
    const r = await adminPost(ctx, '/api/admin/crafts.json', { action: 'hide', id: c.id })
    if (r.status === 200) ctx.made.push(`hid craft ${c.name}`); else ctx.skipped.push(`hide ${c.name}: ${sayReply(r)}`)
  }
  // The demo crew marked "No longer working here" (kept for the record).
  const people = ok(await adminGet(ctx, '/api/admin/staff-people.json'), 'Read the staff list').data.people ?? []
  for (const p of people.filter((x: any) => x.active && DEMO_CREW.some((d) => d.givenName === x.givenName && d.familyName === x.familyName))) {
    const r = await adminPost(ctx, '/api/admin/staff-people.json', { action: 'leave', id: p.id })
    if (r.status === 200) ctx.made.push(`${p.givenName} ${p.familyName} no longer working here`); else ctx.skipped.push(`${p.familyName}: ${sayReply(r)}`)
  }
  for (const l of lib) {
    const r = await adminPost(ctx, '/api/admin/classes/library.json', { action: 'archive', id: l.id })
    if (r.status === 200) ctx.made.push(`archived ${libraryName(l)}`)
    else ctx.skipped.push(`archive ${libraryName(l)}: ${sayReply(r)}`)
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function preflight(ctx: SeedCtx, secrets: { adminPasscode: string }): Promise<void> {
  const a = await ctx.admin.post('/api/admin/login.json', { passcode: secrets.adminPasscode })
  ok(a, 'Sign in to /admin')
  if (!ctx.admin.jar.has('hg_admin')) throw new Error('Signed in to /admin but no cookie came back')
  actAsOwner(a.body?.data?.owners)
  const sandbox = ok(await adminGet(ctx, '/api/admin/classes/seed-sandbox.json'), 'Ask the preview which Square it uses')
  if (sandbox.data?.sandbox !== true) throw new Error('The preview is not on the Square sandbox. Stopping before anything is made.')
  const muted = ok(await adminGet(ctx, '/api/admin/preview-messages.json'), 'Ask the preview whether its emails and texts are muted')
  if (muted.data?.muted !== true) throw new Error('The preview would send real emails and texts (not muted). Stopping before anything is made.')
}

/** /staff as the first owner (an owner also needs the admin passcode), for the comps. */
async function staffSignIn(ctx: SeedCtx, secrets: { staffPasscode: string; adminPasscode: string }): Promise<void> {
  if (ctx.dryRun) return
  const s = ok(await ctx.staff.post('/api/staff/login.json', { passcode: secrets.staffPasscode }), 'Staff passcode')
  const staff: { id: string; role: string }[] = s.data?.staff ?? []
  const who = staff.find((m) => m.role === 'owner') ?? staff[0]
  if (!who) throw new Error('The staff list is empty')
  ok(await ctx.staff.post('/api/staff/pick.json', { passcode: secrets.staffPasscode, staffId: who.id, ...(who.role === 'owner' ? { adminPasscode: secrets.adminPasscode } : {}) }), 'Pick who is on the iPad')
}

export async function main(argv: string[], env: Record<string, string | undefined>): Promise<number> {
  let args
  try { args = parseSeedArgs(argv) } catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 2 }
  if (args.help) { console.log('npx tsx scripts/seed-demo.ts [--dry-run] [--remove]   (see the header of this file)'); return 0 }
  let secrets
  try { secrets = readSecrets(env) } catch (e) {
    if (e instanceof MissingSecretError) { console.error(e.message.replace('scripts/sandbox-e2e.ts', 'scripts/seed-demo.ts')); return 2 }
    throw e
  }
  const liveToken = (env.SQUARE_ACCESS_TOKEN ?? '').trim() || dotenv('SQUARE_ACCESS_TOKEN')
  const hide = [secrets.adminPasscode, secrets.staffPasscode, liveToken]
  const log: Log = (line) => console.log(redact(line, hide))
  const ctx: SeedCtx = {
    admin: new PreviewClient(), staff: new PreviewClient(), live: new LiveReader(fetch, liveToken),
    log, now: new Date(), dryRun: args.dryRun, made: [], skipped: [],
  }
  try {
    await preflight(ctx, secrets)
    log(`Signed in to ${PREVIEW_ORIGIN} (sandbox, messages muted) as ${OWNER_HEADERS['X-Admin-Who']}.`)
    if (args.remove) {
      await removeDemo(ctx)
    } else {
      const lib = await demoLibrary(ctx)
      const classes = await classesAround(ctx)
      await seedLiveWorkshops(ctx, lib, classes)
      if (!args.classesOnly) {
        await seedSettings(ctx)
        await staffSignIn(ctx, secrets)
        const catalog = await ctx.live.catalog('ITEM,CATEGORY,IMAGE')
        await seedExtraClasses(ctx, lib, classes, catalog)
        await seedPromo(ctx)
        await seedCrafts(ctx, catalog)
        await seedCrew(ctx, secrets.staffPasscode)
      }
    }
  } catch (e) {
    log(`Stopped: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  } finally {
    await ctx.admin.request('DELETE', '/api/admin/login.json').catch(() => undefined)
    if (ctx.staff.jar.has('hg_staff')) await ctx.staff.request('DELETE', '/api/staff/login.json').catch(() => undefined)
    log(`\n${args.remove ? 'Removed' : 'Made'} ${ctx.made.length}:`)
    for (const m of ctx.made) log(`  - ${m}`)
    if (ctx.skipped.length) { log(`Skipped ${ctx.skipped.length}:`); for (const s of ctx.skipped) log(`  - ${s}`) }
  }
  return ctx.skipped.length ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code))
}
