/**
 * Party end-to-end scenarios (stage 2, Task 14), scenarios 24–40. Staffing
 * (stage 3) takes 41–48. scripts/sandbox-e2e.ts appends them to the list it
 * runs: same --only, --dry-run, --cleanup-only, stop handling and summary.
 *
 * Setup, once per run (the first party scenario that runs does it):
 *   - a party craft from /api/party/service-info.json (the sandbox seed's
 *     "Sandbox Keychain Bar"); none → every party scenario is skipped with
 *     how to fix it ("Set up sandbox" + SQUARE_PARTY_CRAFT_CATEGORY_ID);
 *   - Parties setup on the preview (STORE_NAMESPACE=preview, never live) gets
 *     a test package "E2E <run> Test party" ($1, 90 minutes, Only with the
 *     link: S2-R18), an "E2E <run> extra half hour" ($1, 30 minutes, offered
 *     online: scenario 29 books it on /book), "E2E <run> bags" ($1 per guest,
 *     NOT offered online: only owners add it), and POOL_SIZE dated party days at 4:00 and
 *     6:30 AM (or 4:00 and 4:00 + the longest package + cleanup), on studio
 *     days with no opening hours (Mon–Wed), no café, no closure, no dated
 *     party day already, 20+ days out (clear of the staffing scenarios' next
 *     two weeks and stage 1's 90–300 days) and inside Parties setup's notice
 *     and booking window. Nothing real is ever offered at 4 AM, so a test
 *     party can't take a customer's time.
 *     What anyone on the preview sees while a run is going: dated days apply
 *     to every package (Parties setup has no link-only time), and the extra
 *     half hour is offered online, so /book on the PREVIEW shows 4 AM times
 *     and the "E2E … extra half hour" until the run's cleanup. Don't walk
 *     through the preview during a run. The live site never sees any of it
 *     (party writes are refused on any site without STORE_NAMESPACE).
 *   - The run's cleanup (after the last scenario, and on Ctrl-C) takes those
 *     package, extras and days out of Parties setup again and puts the Square
 *     read switch back as it was.
 *   - A stop (Ctrl-C) halts the running scenario first: its next request to
 *     the preview throws, and the stop waits for it to settle before the
 *     cleanups and the Parties setup restore run (core.ts Halt).
 *
 * Every party it books has a host named "E2E <run> …", the email E2E_EMAIL
 * and Kaden's phone (the preview reroutes every email and text to Kaden
 * anyway). Each scenario cancels its parties at the end (cancelling never
 * refunds), taps "I told them" so no "Host not told yet" item is left in To
 * decide, and lets go of any time still held for them. Money: sandbox card
 * nonces only. Refunds only in 35, 36, 37 and 40 (sandbox money), and 27's
 * own sandbox payment is refunded by its cleanup.
 *
 * With SQUARE_SANDBOX_ACCESS_TOKEN each charge is checked in the sandbox
 * (order by reference_id, untaxed "Party — …" lines, the payment), refunds by
 * id, and "no Square booking" by ListBookings; 40 and 27's To decide half need it.
 */
import { createHash, randomUUID } from 'node:crypto'
import { STUDIO_HOURS, WEEKDAYS } from '../../../src/config/hours'
import {
  addDays, check, checkEqual, checkStatus, chicagoDate, chicagoToUtcIso, Cleanup, sayReply, SkipScenario, SquareError, weekdayOf,
  type Reply, type Scenario, type Scope,
} from './core'
import {
  blockedDay, CARD_DECLINED, CARD_OK, checkNotCharged, checkRefundInSquare, GIFT_CARD_OK, noSquare, ordersFor, reconcile, sinceNow,
  testContent, toDecide, type Ctx,
} from './scenarios'

/** What the party scenarios need besides the stage-1 context. */
export interface PartyCtx extends Ctx {
  /** run-level undo steps: run once after the last scenario (and on a stop), never per scenario */
  runCleanup: Cleanup
  /** set by the first party scenario: the test package, extras and days (null: no party craft, every party scenario skips) */
  party?: PartySetup | null
}

export interface PartySetup {
  ids: { pkg: string; half: string; bags: string }
  pkgName: string
  halfLabel: string
  bagsLabel: string
  craftId: string
  /** the dated test party days, handed out in order by takeDay */
  days: string[]
  /** the two start times on each test day, 'HH:MM' studio time */
  starts: [string, string]
  used: number
  /** Parties setup as it was before the run, and as the run saved it */
  before: any
  saved: any
}

// ── Constants and pure helpers (unit tested) ──────────────────────────────

/** How many dated test days a run saves; every scenario takes one or two. */
export const POOL_SIZE = 20
/** Days ahead of today the first test day can be. */
export const POOL_FIRST_OFFSET = 20
/** The first test start each day: an hour the studio never runs a real party. */
export const FIRST_START = '04:00'
/** A dated party day whose starts are all before this is a test day (owners' own times start 8 AM or later, DV3). */
export const TEST_DAY_BEFORE = '08:00'
export const PARTY_CLEANUP_MINUTES = 60

export const NO_CRAFT = 'The preview has no party craft, so a party can’t be booked. In /admin tap "Set up sandbox", set SQUARE_PARTY_CRAFT_CATEGORY_ID for the branch as it says, redeploy, then run this again.'
export const OWNER_HEADERS = { 'X-Admin-Who': 'Kaden' }
const REASON = 'E2E sandbox test'

/** Our party id for a key (attempt id or create key): the same rule as src/lib/booking-core/ids.ts idFor('pty', key). */
export function partyIdOf(key: string): string {
  return `pty_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
}

export function testIds(runTag: string): PartySetup['ids'] {
  return { pkg: `pkg_e2e_${runTag}`, half: `add_e2e_half_${runTag}`, bags: `add_e2e_bags_${runTag}` }
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** The two test starts: 4:00 and the earliest next start the longest package allows (6:30 for 90 minutes). */
export function testStarts(settings: any): [string, string] {
  const live = ((settings?.packages ?? []) as any[]).filter((p) => !p.archived).map((p) => Number(p.minutes) || 0)
  const longest = Math.max(90, ...live)
  return [FIRST_START, toHhmm(toMin(FIRST_START) + longest + PARTY_CLEANUP_MINUTES)]
}

/** Weekdays with no studio opening hours: a 4 AM party start is only allowed there. */
export function noHoursWeekdays(): Set<string> {
  const open = new Set<string>(STUDIO_HOURS.flatMap((h) => h.days))
  return new Set(WEEKDAYS.filter((d) => !open.has(d)))
}

/**
 * The test party days: from today + POOL_FIRST_OFFSET (or later, for Parties
 * setup's notice; a dated day is offered even before the first party day), only weekdays with no opening
 * hours, never a closed day, a café day or a day Parties setup already has
 * dated times for, and never past the booking window (/book wouldn't offer
 * them). Too few such days → a plain error saying what to change.
 */
export function partyDayPool(todayYmd: string, n: number, studioSettings: any, partySettings: any): string[] {
  const allowed = noHoursWeekdays()
  const busy = blockedDay(studioSettings)
  const t = partySettings?.times ?? {}
  const dated = new Set(Object.keys(t.dates ?? {}))
  const windowDays = Number.isInteger(t.bookingWindowDays) ? t.bookingWindowDays : 90
  const leadDays = Number.isInteger(t.minLeadDays) ? t.minLeadDays : 0
  const last = addDays(todayYmd, windowDays)
  let d = addDays(todayYmd, Math.max(POOL_FIRST_OFFSET, leadDays))
  const out: string[] = []
  for (; out.length < n && d <= last; d = addDays(d, 1)) {
    if (allowed.has(weekdayOf(d)) && !busy(d) && !dated.has(d)) out.push(d)
  }
  if (out.length < n) {
    throw new Error(
      `Only ${out.length} free test party days inside the preview's booking window (${windowDays} days ahead); the run needs ${n}. `
      + 'In the preview\'s /admin › Parties setup, set "Up to (days ahead)" to 90, save, and run this again.',
    )
  }
  return out
}

/** The four fields Parties setup saves. */
export function settingsInput(s: any): { times: any; packages: any[]; addOns: any[]; readSquareBookings: boolean } {
  return { times: s.times, packages: s.packages, addOns: s.addOns ?? [], readSquareBookings: s.readSquareBookings }
}

export function testPackage(runTag: string) {
  return {
    id: testIds(runTag).pkg, name: `E2E ${runTag} Test party`, priceCents: 100, minutes: 90,
    minGuests: 1, maxGuests: 4, defaultGuests: 1, quickPicks: [], who: 'link' as const, archived: false,
  }
}
export function testAddOns(runTag: string) {
  const ids = testIds(runTag)
  return [
    { id: ids.half, label: `E2E ${runTag} extra half hour`, priceCents: 100, per: 'party' as const, extraMinutes: 30 as const, maxQty: 1, online: true, archived: false },
    // Owners only (scenario 33 adds it from /admin): never on the preview's /book during a run.
    { id: ids.bags, label: `E2E ${runTag} bags`, priceCents: 100, per: 'guest' as const, extraMinutes: 0 as const, maxQty: 1, online: false, archived: false },
  ]
}

/** Parties setup plus this run's test package, extras and dated days. */
export function withTestSetup(input: ReturnType<typeof settingsInput>, t: { runTag: string; days: string[]; starts: [string, string] }) {
  const dates = { ...input.times.dates }
  for (const d of t.days) dates[d] = [...t.starts]
  return {
    ...input,
    times: { ...input.times, dates },
    packages: [...input.packages, testPackage(t.runTag)],
    addOns: [...input.addOns, ...testAddOns(t.runTag)],
  }
}

const isTest = (name: unknown) => typeof name === 'string' && name.startsWith('E2E ')

/**
 * Parties setup without anything a test run added: packages and extras named
 * "E2E …", and the dated days given (or, without a list, every dated day whose
 * starts are all before 8 AM: only tests use those). Null when there is nothing to take out.
 */
export function withoutTestSetup(input: ReturnType<typeof settingsInput>, opts: { days?: string[]; readSquareBookings?: boolean } = {}) {
  const dates: Record<string, string[]> = {}
  let dropped = 0
  for (const [d, starts] of Object.entries(input.times.dates as Record<string, string[]>)) {
    const test = opts.days ? opts.days.includes(d) : starts.length > 0 && starts.every((s) => s < TEST_DAY_BEFORE)
    if (test) dropped++
    else dates[d] = starts
  }
  const packages = input.packages.filter((p) => !isTest(p.name))
  const addOns = input.addOns.filter((a) => !isTest(a.label))
  const read = opts.readSquareBookings ?? input.readSquareBookings
  if (!dropped && packages.length === input.packages.length && addOns.length === input.addOns.length && read === input.readSquareBookings) return null
  return { ...input, times: { ...input.times, dates }, packages, addOns, readSquareBookings: read }
}

/** The fields of a calendar file's one event. */
export function parseIcs(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.replace(/\r\n[ \t]/g, '').split(/\r?\n/)) {
    const i = raw.indexOf(':')
    if (i > 0) {
      const k = raw.slice(0, i).split(';')[0]
      if (!(k in out)) out[k] = raw.slice(i + 1)
    }
  }
  return out
}

/** An ISO instant as a calendar file writes it (20261208T100000Z). */
export const icsUtc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** A payment link's party id and key. */
export function linkParts(url: string): { id: string; k: string } {
  const u = new URL(url)
  const id = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '')
  return { id, k: u.searchParams.get('k') ?? '' }
}

const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b)
const includesTime = (list: string[], iso: string) => list.some((x) => sameInstant(x, iso))

// ── Talking to the preview ────────────────────────────────────────────────

function ownerPost(ctx: PartyCtx, path: string, body: unknown): Promise<Reply> {
  return ctx.admin.request('POST', path, { body, headers: OWNER_HEADERS })
}

async function readPartySettings(ctx: Pick<PartyCtx, 'admin'>): Promise<{ settings: any; legacyRemaining: { count: number; lastIso: string | null } | null }> {
  const r = await ctx.admin.get('/api/admin/parties/settings.json')
  checkStatus(r, 200, 'Read Parties setup')
  return r.body.data
}

async function saveParty(ctx: PartyCtx, input: unknown, expectedUpdatedAt: string | null): Promise<Reply> {
  return ownerPost(ctx, '/api/admin/parties/settings.json', { ...(input as object), expectedUpdatedAt })
}

/** Takes this run's test bits out of Parties setup (the run's cleanup). */
async function restorePartySetup(ctx: PartyCtx, days: string[], readSquareBookings: boolean): Promise<void> {
  const { settings } = await readPartySettings(ctx)
  const next = withoutTestSetup(settingsInput(settings), { days, readSquareBookings })
  if (!next) return
  checkStatus(await saveParty(ctx, next, settings.updatedAt), 200, 'Put Parties setup back')
}

/** Once per run: the party craft, the test package and extras, the dated test days (see the file header). */
export async function ensureParty(ctx: PartyCtx): Promise<PartySetup> {
  if (ctx.party) return ctx.party
  if (ctx.party === null) throw new SkipScenario(NO_CRAFT)
  const info = await ctx.pub.get('/api/party/service-info.json')
  checkStatus(info, 200, 'Read the party crafts')
  const craft = (info.body?.data?.crafts ?? [])[0]
  if (!craft?.id) { ctx.party = null; throw new SkipScenario(NO_CRAFT) }

  const { settings: before } = await readPartySettings(ctx)
  const days = partyDayPool(chicagoDate(new Date()), POOL_SIZE, ctx.settings, before)
  const starts = testStarts(before)
  const next = withTestSetup(settingsInput(before), { runTag: ctx.runTag, days, starts })
  const r = await saveParty(ctx, next, before.updatedAt)
  checkStatus(r, 200, 'Save the test party days, package and extras in Parties setup')
  ctx.runCleanup.add('take the test package, extras and days out of Parties setup', () => restorePartySetup(ctx, days, before.readSquareBookings))
  const pkg = testPackage(ctx.runTag)
  const [half, bags] = testAddOns(ctx.runTag)
  ctx.party = {
    ids: testIds(ctx.runTag), pkgName: pkg.name, halfLabel: half.label, bagsLabel: bags.label, craftId: craft.id,
    days, starts, used: 0, before, saved: r.body.data.settings,
  }
  return ctx.party
}

/** The next unused test day. */
export async function takeDay(ctx: PartyCtx): Promise<string> {
  const s = await ensureParty(ctx)
  if (s.used >= s.days.length) throw new Error(`Out of test party days (${s.days.length}). Raise POOL_SIZE.`)
  return s.days[s.used++]
}

/** The UTC instant of a test day's first (0) or second (1) start. */
export function at(s: Pick<PartySetup, 'starts'>, day: string, i: 0 | 1): string {
  return chicagoToUtcIso(day, s.starts[i])
}

function host(ctx: PartyCtx, what: string) {
  return { firstName: 'E2E', lastName: `${ctx.runTag} ${what}`.slice(0, 60), email: ctx.person.email, phone: ctx.person.phone }
}

export interface PartyBooked { reply: Reply; key: string; partyId: string }

/** Book on /book as a customer (through the shared gate): the test package by its link. */
export async function publicBook(
  ctx: PartyCtx,
  o: { startIso: string; what: string; token?: string; addOns?: Record<string, number>; guests?: number; attemptId?: string; gated?: boolean },
): Promise<PartyBooked> {
  const s = await ensureParty(ctx)
  const key = o.attemptId ?? randomUUID()
  const token = o.token ?? CARD_OK
  const reply = await ctx.pub.post('/api/party/book.json', {
    startTime: o.startIso, packageId: s.ids.pkg, linkPackageId: s.ids.pkg, guests: o.guests ?? 1, craftId: s.craftId,
    ...(o.addOns ? { addOns: o.addOns } : {}),
    paymentToken: token, sourceKind: token.startsWith('cnon:gift') ? 'gift_card' : 'card', attemptId: key,
    customer: host(ctx, o.what),
  }, { gated: o.gated ?? true })
  if (reply.status === 403) throw new Error(`Party bookings are closed on the preview (${sayReply(reply)}). Set BOOKINGS_OPEN to include parties for the branch.`)
  return { reply, key, partyId: partyIdOf(key) }
}

/** Book from /admin: by payment link (create key) or by card (attempt id). */
export async function adminBook(
  ctx: PartyCtx,
  o: { startIso: string; what: string; pay: 'link' | 'card'; key?: string; guests?: number; token?: string; expectedCents?: number },
): Promise<PartyBooked> {
  const s = await ensureParty(ctx)
  const key = o.key ?? (o.pay === 'link' ? `e2e-${randomUUID()}` : randomUUID())
  const reply = await ownerPost(ctx, '/api/admin/parties/book.json', {
    ...(o.pay === 'link' ? { createKey: key } : {}),
    startIso: o.startIso, packageId: s.ids.pkg, guests: o.guests ?? 1, craftId: s.craftId, host: host(ctx, o.what),
    pay: o.pay === 'link' ? { kind: 'link' } : { kind: 'card', attemptId: key, paymentToken: o.token ?? CARD_OK },
    expectedCents: o.expectedCents ?? 100,
  })
  return { reply, key, partyId: partyIdOf(key) }
}

export async function partyOf(ctx: Pick<PartyCtx, 'admin'>, id: string): Promise<any | null> {
  const r = await ctx.admin.get(`/api/admin/party.json?id=${encodeURIComponent(id)}`)
  checkStatus(r, 200, `Read party ${id}`)
  return r.body.data.party
}

export async function act(ctx: PartyCtx, id: string, action: string, extra: Record<string, unknown> = {}): Promise<Reply> {
  return ownerPost(ctx, '/api/admin/parties/actions.json', { id, action, ...extra })
}

/**
 * Cancel a test party (never refunds), tap "I told them" so its "Host not
 * told yet" item leaves To decide, and let go of any time still held for it.
 * Nothing when it was never made. Used by every scenario's cleanup and by --cleanup-only.
 */
export async function clearTestParty(ctx: Pick<PartyCtx, 'admin'>, id: string): Promise<void> {
  const owner = (action: string, extra: Record<string, unknown> = {}) =>
    ctx.admin.request('POST', '/api/admin/parties/actions.json', { body: { id, action, ...extra }, headers: OWNER_HEADERS })
  let p = await partyOf(ctx, id)
  if (!p || p.legacy) return
  if (p.status !== 'cancelled') {
    checkStatus(await owner('cancel', { note: 'E2E cleanup' }), 200, `Cancel ${id}`)
    p = await partyOf(ctx, id)
  }
  if (p?.notTold?.at) {
    checkStatus(await owner('mark-told', { notToldAt: p.notTold.at }), 200, `I told them (${id})`)
    p = await partyOf(ctx, id)
  }
  for (const f of (p?.holdState?.freeable ?? []) as { startIso: string }[]) {
    checkStatus(await owner('free-time', { startIso: f.startIso, shownStartIso: p.startIso, shownVersion: p.timeVersion }), 200, `Free ${f.startIso} for ${id}`)
  }
}

/** A scenario's cleanup for one party (see clearTestParty). */
export async function cancelTestParty(ctx: PartyCtx, id: string): Promise<void> {
  await clearTestParty(ctx, id)
}

/** How a clash refusal names a test party: "the <last word of the host's name> party" (conflicts.ts partyName). */
export function clashLabel(what: string): string {
  return `the ${what.trim().split(/\s+/).pop()} party`
}

const registered = new WeakMap<Scope, Set<string>>()
/** Registers the cleanup for a party id BEFORE it is booked, so a crash after the booking still cancels it. Once per party. */
export function cleanUpParty(ctx: PartyCtx, scope: Scope, id: string): void {
  const seen = registered.get(scope) ?? new Set<string>()
  registered.set(scope, seen)
  if (seen.has(id)) return
  seen.add(id)
  scope.cleanup.add(`cancel party ${id}`, () => cancelTestParty(ctx, id))
}

/** The free party times owners see on one day (times.json; the test package unless it's a move). */
export async function adminOpen(ctx: PartyCtx, day: string, opts: { exclude?: string; addOns?: string } = {}): Promise<string[]> {
  const s = await ensureParty(ctx)
  const q = new URLSearchParams({ from: day, to: day, ...(opts.exclude ? { exclude: opts.exclude } : { packageId: s.ids.pkg }), ...(opts.addOns ? { addOns: opts.addOns } : {}) })
  const r = await ctx.admin.get(`/api/admin/parties/times.json?${q.toString()}`)
  checkStatus(r, 200, `Read the owners' party times on ${day}`)
  return r.body.data.open
}

/** The party times /book offers on one day for the test package (available-dates). */
export async function publicOpen(ctx: PartyCtx, day: string): Promise<string[]> {
  const s = await ensureParty(ctx)
  const r = await ctx.pub.post('/api/party/available-dates.json', { packageId: s.ids.pkg })
  if (r.status === 403) throw new Error(`Party bookings are closed on the preview (${sayReply(r)}). Set BOOKINGS_OPEN to include parties for the branch.`)
  checkStatus(r, 200, 'Read the dates /book offers')
  return ((r.body.data.times?.[day] ?? []) as { startAt: string }[]).map((t) => t.startAt)
}

/** Square bookings in the sandbox on a day (ListBookings), or null when the sandbox won't list them. */
async function squareBookingCount(ctx: PartyCtx, scope: Scope, day: string): Promise<number | null> {
  if (!ctx.square) return null
  try {
    const q = new URLSearchParams({ start_at_min: chicagoToUtcIso(day, '00:00'), start_at_max: chicagoToUtcIso(addDays(day, 1), '00:00'), limit: '100' })
    return ((await ctx.square.get(`/bookings?${q.toString()}`)).bookings ?? []).length
  } catch (e) {
    if (e instanceof SquareError) { scope.note(`Square bookings not checked (${e.message})`); return null }
    throw e
  }
}

/**
 * A party that should be paid: the record (booked, paid, nothing due), its
 * charges, and in the sandbox each charge's order (COMPLETED, reference_id =
 * party id, untaxed "Party — …" lines, total = the charge) and payment.
 */
export async function checkPartyPaid(
  ctx: PartyCtx, scope: Scope, partyId: string,
  expect: { cents: number; via: 'online' | 'admin-card' | 'link'; charges?: number; giftCard?: boolean; lines?: string[] },
): Promise<any> {
  const s = await ensureParty(ctx)
  const p = await partyOf(ctx, partyId)
  check(p, `No party ${partyId} was recorded`)
  checkEqual(p.status, 'booked', 'Party status')
  checkEqual(p.legacy, false, 'Party is ours')
  checkEqual(p.paymentState, 'paid', 'Payment state')
  checkEqual(p.dueCents, 0, 'Still due (cents)')
  const charges = p.charges as any[]
  check(!charges.some((c) => c.simulated), 'The preview simulated the payment (DEV_BYPASS_PAYMENT is on for the branch); turn it off so the sandbox is charged')
  checkEqual(charges.length, expect.charges ?? 1, 'Charges on the party')
  const charge = charges[charges.length - 1]
  checkEqual(charge.via, expect.via, 'How the last charge was taken')
  checkEqual(charge.cents, expect.cents, 'Last charge (cents)')
  check(charge.orderId && charge.paymentId, 'The charge has no Square order or payment id')

  if (!ctx.square) { noSquare(scope); return p }
  const order = (await ctx.square.get(`/orders/${encodeURIComponent(charge.orderId)}`)).order
  checkEqual(order.state, 'COMPLETED', 'Square order state')
  checkEqual(order.reference_id, partyId, 'Square order reference')
  checkEqual(Number(order.total_money?.amount), expect.cents, 'Square order total')
  checkEqual(Number(order.total_tax_money?.amount ?? 0), 0, 'Square tax on a party order')
  check(!(order.taxes ?? []).length, 'The party order carries a tax (party lines are untaxed, OWNER-1)')
  check(!order.pricing_options?.auto_apply_taxes, 'The party order asks Square to apply taxes')
  const names = ((order.line_items ?? []) as any[]).map((li) => String(li.name))
  for (const n of names) check(n.startsWith('Party — '), `Square line "${n}" doesn't read "Party — …"`)
  for (const want of expect.lines ?? []) check(names.includes(want), `No Square line "${want}" (lines: ${names.join(', ')})`)
  const pkgLine = (order.line_items as any[]).find((li) => li.name === `Party — ${s.pkgName}`)
  if (pkgLine) checkEqual(pkgLine.note, s.ids.pkg, 'Square note on the package line')
  const payment = (await ctx.square.get(`/payments/${encodeURIComponent(charge.paymentId)}`)).payment
  checkEqual(payment.status, 'COMPLETED', 'Square payment status')
  checkEqual(Number(payment.total_money?.amount), expect.cents, 'Square payment amount')
  checkEqual(payment.order_id, charge.orderId, 'Square payment order')
  if (expect.giftCard) checkEqual(payment.card_details?.card?.card_brand, 'SQUARE_GIFT_CARD', 'Square payment card brand')
  return p
}

/** The guest calendar file (cache-busted: the route lets the CDN keep it 5 minutes). */
async function inviteIcs(ctx: PartyCtx, id: string): Promise<Reply> {
  return ctx.pub.request('GET', `/api/party/invite.ics?party=${encodeURIComponent(id)}&e2e=${Date.now()}`, { headers: { Accept: 'text/calendar' } })
}

async function checkIcs(ctx: PartyCtx, id: string, startIso: string, sequence: number): Promise<void> {
  const r = await inviteIcs(ctx, id)
  checkStatus(r, 200, 'The guest calendar file')
  const ev = parseIcs(r.text)
  checkEqual(ev.UID, `party-${id}@ourhometownstudio.com`, 'Calendar file UID (from the booking id, never the time)')
  checkEqual(ev.SEQUENCE, String(sequence), 'Calendar file SEQUENCE')
  checkEqual(ev.DTSTART, icsUtc(startIso), 'Calendar file start')
}

/** Refund through /admin. */
function ownerRefund(ctx: PartyCtx, body: Record<string, unknown>): Promise<Reply> {
  return ownerPost(ctx, '/api/admin/parties/refund.json', { reason: REASON, attempt: randomUUID(), ...body })
}

async function payLink(ctx: PartyCtx, link: { id: string; k: string }, expectedCents: number, token = CARD_OK, attemptId: string = randomUUID()): Promise<Reply> {
  return ctx.pub.post('/api/party/pay.json', { id: link.id, k: link.k, attemptId, expectedCents, paymentToken: token, sourceKind: 'card' }, { gated: true })
}

async function balance(ctx: PartyCtx, link: { id: string; k: string }): Promise<Reply> {
  return ctx.pub.get(`/api/party/balance.json?id=${encodeURIComponent(link.id)}&k=${encodeURIComponent(link.k)}`)
}

/** A party that should be booked and paid by card on /book, checked. */
async function bookPaidPublic(ctx: PartyCtx, scope: Scope, startIso: string, what: string): Promise<{ partyId: string; party: any; hostToken: string }> {
  const b = publicBook(ctx, { startIso, what })
  const booked = await b
  cleanUpParty(ctx, scope, booked.partyId)
  checkStatus(booked.reply, 200, `Book ${what} on /book`)
  const party = await checkPartyPaid(ctx, scope, booked.partyId, { cents: 100, via: 'online' })
  return { partyId: booked.partyId, party, hostToken: booked.reply.body.data.hostToken }
}

/** A party booked from /admin by card, checked. */
async function bookPaidOwner(ctx: PartyCtx, scope: Scope, startIso: string, what: string, guests = 1): Promise<{ partyId: string; key: string; party: any }> {
  const key = randomUUID()
  cleanUpParty(ctx, scope, partyIdOf(key))
  const b = await adminBook(ctx, { startIso, what, pay: 'card', key, guests })
  checkStatus(b.reply, 200, `Book ${what} from /admin by card`)
  const party = await checkPartyPaid(ctx, scope, b.partyId, { cents: 100, via: 'admin-card' })
  return { partyId: b.partyId, key, party }
}

/** A party booked from /admin with a payment link (nothing paid), checked. */
async function bookByLink(ctx: PartyCtx, scope: Scope, startIso: string, what: string): Promise<{ partyId: string; key: string; reply: Reply }> {
  const key = `e2e-${randomUUID()}`
  cleanUpParty(ctx, scope, partyIdOf(key))
  const b = await adminBook(ctx, { startIso, what, pay: 'link', key })
  checkStatus(b.reply, 200, `Book ${what} from /admin with a payment link`)
  checkEqual(b.reply.body.data.party.bookingId, b.partyId, 'Party id from the create key')
  return { partyId: b.partyId, key, reply: b.reply }
}

// ── The scenarios ──────────────────────────────────────────────────────────

export const partyScenarios: Scenario<PartyCtx>[] = [
  {
    id: 24,
    title: 'Parties setup: test days, package, stale save',
    plan: [
      'save the test package "E2E <run> Test party" ($1, Only with the link), two $1 extras and 20 dated test days at 4:00 and 6:30 AM',
      'Parties setup reads them back; history names the package; the weekly party times are unchanged',
      '/book offers the test days with ?package=; /book without it does not list the test package',
      'a save from a stale screen → 409 with the current settings',
      'the Square read switch: off → saved only while no Square-booked party remains (0 on the sandbox), then back on',
      'run cleanup (after the last scenario): the package, extras and days come out again',
    ],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const { settings, legacyRemaining } = await readPartySettings(ctx)
      const pkg = (settings.packages as any[]).find((p) => p.id === s.ids.pkg)
      check(pkg, 'The test package is not in Parties setup')
      checkEqual([pkg.priceCents, pkg.minutes, pkg.who], [100, 90, 'link'], 'Test package price, minutes, who')
      checkEqual((settings.addOns as any[]).filter((a) => a.id === s.ids.half || a.id === s.ids.bags).length, 2, 'Test extras saved')
      for (const d of s.days) checkEqual(settings.times.dates[d], [...s.starts], `Party times on ${d}`)
      checkEqual(settings.times.weekly, s.before.times.weekly, 'Weekly party times (unchanged)')
      check((settings.history?.[0]?.changed ?? []).some((c: string) => c.includes(s.pkgName)), 'Parties setup history does not name the test package')

      const day = s.days[0]
      const offered = await publicOpen(ctx, day)
      for (const i of [0, 1] as const) check(includesTime(offered, at(s, day, i)), `/book does not offer ${s.starts[i]} on ${day}`)
      const plain = await ctx.pub.get('/api/party/service-info.json')
      checkStatus(plain, 200, 'service-info without ?package')
      check(!((plain.body.data.facts?.packages ?? []) as any[]).some((p) => p.id === s.ids.pkg), 'The link-only test package is listed on /book without its link')
      const linked = await ctx.pub.get(`/api/party/service-info.json?package=${encodeURIComponent(s.ids.pkg)}`)
      checkStatus(linked, 200, 'service-info with ?package')
      check(((linked.body.data.facts?.packages ?? []) as any[]).some((p) => p.id === s.ids.pkg), 'The test package is not offered by its link')

      const stale = await saveParty(ctx, settingsInput(settings), s.before.updatedAt)
      checkStatus(stale, 409, 'A save from a stale screen')
      check(stale.body?.stale === true, 'The stale answer has no stale flag')
      checkEqual(stale.body?.current?.updatedAt, settings.updatedAt, 'The stale answer carries the current settings')

      if (!settings.readSquareBookings) return scope.note('the Square read switch is already off on the preview; switch not checked')
      if (legacyRemaining === null) return scope.note('Square could not be asked about parties booked there; switch not checked')
      const off = await saveParty(ctx, { ...settingsInput(settings), readSquareBookings: false }, settings.updatedAt)
      if (legacyRemaining.count > 0) {
        checkStatus(off, 409, 'Turning the Square read off while Square parties remain')
        check(off.body?.field === 'readSquareBookings', 'The refusal is not on the switch')
        return
      }
      scope.note('the sandbox has no Square-booked parties, so "refused while some remain" is covered by unit tests only')
      checkStatus(off, 200, 'Turn the Square read off (none remain)')
      const back = await saveParty(ctx, { ...settingsInput(settings), readSquareBookings: true }, off.body.data.settings.updatedAt)
      checkStatus(back, 200, 'Turn the Square read back on')
    },
  },
  {
    id: 25,
    title: 'Public /book, sandbox card: one order, one payment',
    plan: [
      'book the $1 test package by its link at 4:00 on a test day with the sandbox card',
      'one charge on the record (online), Square order reference_id = party id, untaxed "Party — E2E … Test party" line, payment COMPLETED',
      '4:00 is gone from /book and /admin; 6:30 that day is still offered',
      'no Square booking was made (ListBookings for the day unchanged)',
      'the guest calendar file: UID party-<id>, SEQUENCE 0; the host page key does not open the payment link',
    ],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const start = at(s, day, 0)
      const bookingsBefore = await squareBookingCount(ctx, scope, day)
      const b = await publicBook(ctx, { startIso: start, what: 'Public card' })
      cleanUpParty(ctx, scope, b.partyId)
      checkStatus(b.reply, 200, 'Book on /book')
      const d = b.reply.body.data
      check(!d.simulated, 'The preview simulated the payment (DEV_BYPASS_PAYMENT is on for the branch)')
      checkEqual(d.bookingId, b.partyId, 'Party id from the attempt id')
      checkEqual(d.totalCharged, 100, 'Charged (cents)')
      check(d.hostToken, 'No host page key came back')
      await checkPartyPaid(ctx, scope, b.partyId, { cents: 100, via: 'online', lines: [`Party — ${s.pkgName}`] })
      check(!includesTime(await publicOpen(ctx, day), start), '/book still offers the booked time')
      check(includesTime(await publicOpen(ctx, day), at(s, day, 1)), `/book no longer offers ${s.starts[1]} after a 4:00 party`)
      check(!includesTime(await adminOpen(ctx, day), start), '/admin still offers the booked time')
      if (bookingsBefore !== null) checkEqual(await squareBookingCount(ctx, scope, day), bookingsBefore, 'Square bookings that day')
      else if (ctx.square === null) noSquare(scope)
      await checkIcs(ctx, b.partyId, start, 0)
      const wrongKey = await balance(ctx, { id: b.partyId, k: d.hostToken })
      checkStatus(wrongKey, 404, 'The payment page opened with the host page key')
    },
  },
  {
    id: 26,
    title: 'Two bookings of one party time at once',
    plan: ['two customers book the same 4:00 at the same moment', 'one 200, one 409 slot_taken; one payment; the loser has no party and nothing charged'],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const start = at(s, day, 0)
      const since = sinceNow()
      const keys = [randomUUID(), randomUUID()]
      for (const k of keys) cleanUpParty(ctx, scope, partyIdOf(k))
      await ctx.gate.take(2)
      const both = await Promise.all(keys.map((k, i) => publicBook(ctx, { startIso: start, what: `Race ${i + 1}`, attemptId: k, gated: false })))
      checkEqual(both.map((b) => b.reply.status).sort(), [200, 409], 'Answers')
      const winner = both.find((b) => b.reply.status === 200)!
      const loser = both.find((b) => b.reply.status === 409)!
      checkEqual(loser.reply.body?.code, 'slot_taken', 'The refused one says the time was taken')
      await checkPartyPaid(ctx, scope, winner.partyId, { cents: 100, via: 'online' })
      check(!(await partyOf(ctx, loser.partyId)), 'The refused booking has a party record')
      await checkNotCharged(ctx, scope, [loser.partyId], since)
    },
  },
  {
    id: 27,
    title: 'Declined card holds nothing; To decide for a stray payment',
    plan: [
      'book 4:00 with the declined sandbox card → 402 card_declined, no party, the time offered again, nothing charged',
      'the panel\'s next try (a new attempt id) with a good card books it',
      'sandbox token only: pay the declined try\'s Square order in the sandbox, run the reconcile → To decide "Party payment to check" for it',
      '"Checked in Square" clears it; nothing is booked from it; cleanup refunds that sandbox payment',
    ],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const start = at(s, day, 0)
      const since = sinceNow()
      const bad = await publicBook(ctx, { startIso: start, what: 'Declined', token: CARD_DECLINED })
      cleanUpParty(ctx, scope, bad.partyId)
      checkStatus(bad.reply, 402, 'A declined card')
      checkEqual(bad.reply.body?.code, 'card_declined', 'Refusal code')
      check(!(await partyOf(ctx, bad.partyId)), 'A declined card left a party record')
      check(includesTime(await publicOpen(ctx, day), start), '/book no longer offers the time after a declined card')
      check(includesTime(await adminOpen(ctx, day), start), '/admin no longer offers the time after a declined card')
      await checkNotCharged(ctx, scope, [bad.partyId], since)
      await bookPaidPublic(ctx, scope, start, 'Declined then paid')

      if (!ctx.square) return scope.note('the To decide half needs SQUARE_SANDBOX_ACCESS_TOKEN; not checked')
      const open = (await ordersFor(ctx.square, [bad.partyId], since)).find((o) => o.state === 'OPEN')
      if (!open) return scope.note('the declined try left no open Square order to pay; To decide not checked')
      const total = Number(open.total_money?.amount)
      const paid = (await ctx.square.post('/payments', {
        idempotency_key: randomUUID(), source_id: CARD_OK, order_id: open.id, location_id: open.location_id,
        amount_money: { amount: total, currency: open.total_money?.currency ?? 'USD' },
      })).payment
      scope.cleanup.add(`refund the sandbox payment ${paid.id}`, () => ctx.square!.post('/refunds', {
        idempotency_key: randomUUID(), payment_id: paid.id, amount_money: { amount: total, currency: 'USD' }, reason: 'E2E cleanup',
      }))
      await reconcile(ctx)
      const item = (await toDecide(ctx)).find((i) => i.kind === 'party-paid-unclear' && i.detail?.partyId === bad.partyId)
      check(item, 'To decide has no "Party payment to check" for the paid declined try')
      checkEqual(item.detail.elsewhere, true, 'It is a payment with nothing to book it from')
      const decided = await ownerPost(ctx, '/api/admin/to-decide.json', { id: item.id, action: 'sorted' })
      checkStatus(decided, 200, 'Checked in Square')
      check(!(await toDecide(ctx)).some((i) => i.id === item.id), 'The item is still in To decide')
      check(!(await partyOf(ctx, bad.partyId)), 'A party was booked from the stray payment')
    },
  },
  {
    id: 28,
    title: 'Gift card pays for a party',
    plan: ['book 4:00 with the sandbox gift card nonce', 'paid; the Square payment is a SQUARE_GIFT_CARD'],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const b = await publicBook(ctx, { startIso: at(s, day, 0), what: 'Gift card', token: GIFT_CARD_OK })
      cleanUpParty(ctx, scope, b.partyId)
      checkStatus(b.reply, 200, 'Book with a gift card')
      await checkPartyPaid(ctx, scope, b.partyId, { cents: 100, via: 'online', giftCard: true })
    },
  },
  {
    id: 29,
    title: 'Online with the extra half hour',
    plan: [
      'book 4:00 with "E2E extra half hour" on /book: $2 charged, two Square lines',
      'the party ends 2 hours after it starts; the 6:30 start that day is gone from /book and /admin',
    ],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const start = at(s, day, 0)
      const b = await publicBook(ctx, { startIso: start, what: 'Extra time online', addOns: { [s.ids.half]: 1 } })
      cleanUpParty(ctx, scope, b.partyId)
      checkStatus(b.reply, 200, 'Book with extra time')
      const p = await checkPartyPaid(ctx, scope, b.partyId, { cents: 200, via: 'online', lines: [`Party — ${s.pkgName}`, `Party — ${s.halfLabel}`] })
      checkEqual(Date.parse(p.endIso) - Date.parse(start), 120 * 60_000, 'Party length with the extra half hour (ms)')
      check(!includesTime(await publicOpen(ctx, day), at(s, day, 1)), `/book still offers ${s.starts[1]} after a long 4:00 party`)
      check(!includesTime(await adminOpen(ctx, day), at(s, day, 1)), `/admin still offers ${s.starts[1]} after a long 4:00 party`)
    },
  },
  {
    id: 30,
    title: 'Same attempt sent again after success',
    plan: ['book 4:00, then send the very same request (same attempt id) again', 'the stored answer (replayed), one charge, one paid Square order'],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const since = sinceNow()
      const first = await publicBook(ctx, { startIso: at(s, day, 0), what: 'Retry' })
      cleanUpParty(ctx, scope, first.partyId)
      checkStatus(first.reply, 200, 'First try')
      const again = await publicBook(ctx, { startIso: at(s, day, 0), what: 'Retry', attemptId: first.key })
      checkStatus(again.reply, 200, 'The same try again')
      checkEqual(again.reply.body.data.replayed, true, 'The repeat is a replay')
      checkEqual(again.reply.body.data.bookingId, first.partyId, 'Same party')
      await checkPartyPaid(ctx, scope, first.partyId, { cents: 100, via: 'online' })
      if (!ctx.square) return noSquare(scope)
      const paid = (await ordersFor(ctx.square, [first.partyId], since)).filter((o) => o.state === 'COMPLETED')
      checkEqual(paid.length, 1, 'Paid Square orders for the party')
    },
  },
  {
    id: 31,
    title: 'Owner books with a payment link; host pays it',
    plan: [
      '/admin Book a party, Send payment link: party booked with $1 due, its time held, the link sent once (to Kaden)',
      'the same create key again → replay, no second link',
      'the payment page shows $1 due; paying it with the sandbox card → Paid (via link) in the record and Square',
      'paying again → "Already paid", nothing charged',
    ],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const start = at(s, day, 0)
      const b = await bookByLink(ctx, scope, start, 'Link')
      const d = b.reply.body.data
      checkEqual(d.replay, false, 'First book is not a replay')
      checkEqual(d.party.dueCents, 100, 'Due after booking (cents)')
      checkEqual(d.party.paymentState, 'waiting', 'Payment state after booking')
      const url: string | undefined = d.link?.url ?? d.party.payUrl
      check(url, `No payment link came back (${b.reply.body.warning ?? 'no warning'})`)
      if (d.link) check(d.link.email || d.link.text, 'The payment link went out by neither email nor text')
      check(!includesTime(await adminOpen(ctx, day), start), 'A link booking does not hold its time')
      const again = await adminBook(ctx, { startIso: start, what: 'Link', pay: 'link', key: b.key })
      checkStatus(again.reply, 200, 'The same create key again')
      checkEqual(again.reply.body.data.replay, true, 'The repeat is a replay')
      checkEqual(again.reply.body.data.link, null, 'A second link was sent')

      const link = linkParts(url)
      checkEqual(link.id, b.partyId, 'The link is for this party')
      const view = await balance(ctx, link)
      checkStatus(view, 200, 'The payment page')
      checkEqual(view.body.data.dueCents, 100, 'Due on the payment page (cents)')
      const pay = await payLink(ctx, link, 100)
      checkStatus(pay, 200, 'Pay by the link')
      checkEqual([pay.body.data.state, pay.body.data.paidCents, pay.body.data.stillDueCents], ['paid', 100, 0], 'Payment answer')
      await checkPartyPaid(ctx, scope, b.partyId, { cents: 100, via: 'link' })
      const twice = await payLink(ctx, link, 0)
      checkStatus(twice, 200, 'Pay again')
      checkEqual(twice.body.data.alreadyPaid, true, 'Paying again says already paid')
      checkEqual(twice.body.data.paidCents, 0, 'Charged the second time (cents)')
      const after = await partyOf(ctx, b.partyId)
      checkEqual(after.charges.length, 1, 'Charges after paying twice')
    },
  },
  {
    id: 32,
    title: 'Owner takes a card; replay; past and clashing times refused',
    plan: [
      '/admin Book a party, Take card now (sandbox card): paid via admin-card',
      'the same attempt again → replay, still one charge',
      'another booking at that time → refused "Clashes with the Card party, …"; a start an hour ago → refused (R37); nothing charged for either',
    ],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const start = at(s, day, 0)
      const since = sinceNow()
      const first = await bookPaidOwner(ctx, scope, start, 'Card')
      const again = await adminBook(ctx, { startIso: start, what: 'Card', pay: 'card', key: first.key })
      checkStatus(again.reply, 200, 'The same card booking again')
      checkEqual(again.reply.body.data.replay, true, 'The repeat is a replay')
      checkEqual((await partyOf(ctx, first.partyId)).charges.length, 1, 'Charges after the repeat')

      const clashKey = `e2e-${randomUUID()}`
      cleanUpParty(ctx, scope, partyIdOf(clashKey))
      const clash = await adminBook(ctx, { startIso: start, what: 'Clash', pay: 'link', key: clashKey })
      checkStatus(clash.reply, 409, 'Booking over a party')
      check(String(clash.reply.body?.error ?? '').startsWith(`Clashes with ${clashLabel('Card')},`), `The refusal doesn't name the party in the way ("Clashes with ${clashLabel('Card')}, …"): ${clash.reply.body?.error}`)
      const pastKey = `e2e-${randomUUID()}`
      cleanUpParty(ctx, scope, partyIdOf(pastKey))
      const past = await adminBook(ctx, { startIso: new Date(Date.now() - 60 * 60_000).toISOString(), what: 'Past', pay: 'link', key: pastKey })
      checkStatus(past.reply, [400, 409], 'Booking an hour ago')
      check(!(await partyOf(ctx, partyIdOf(pastKey))), 'A party was booked in the past')
      check(!(await partyOf(ctx, partyIdOf(clashKey))), 'A clashing party was booked')
      await checkNotCharged(ctx, scope, [partyIdOf(clashKey), partyIdOf(pastKey)], since)
    },
  },
  {
    id: 33,
    title: 'Extras after booking; the link pays only them',
    plan: [
      'owner books 4:00 for 2 guests by card ($1); adds "E2E bags" per guest ($2) and the extra half hour ($1)',
      'the hold grows: the 6:30 start that day is gone; the same add again (same key) is a replay',
      'Send payment link → the payment page shows only the $3 of extras; paying it charges $3 (two lines), nothing left due',
      'taking off a paid extra is refused',
    ],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const start = at(s, day, 0)
      const { partyId } = await bookPaidOwner(ctx, scope, start, 'Extras', 2)
      const bagsKey = `e2e-${randomUUID()}`
      const bags = await act(ctx, partyId, 'add-extra', { addOnId: s.ids.bags, count: 1, createKey: bagsKey })
      checkStatus(bags, 200, 'Add the bags')
      checkEqual([bags.body.data.item.qty, bags.body.data.item.cents], [2, 200], 'Bags line (qty, cents)')
      const half = await act(ctx, partyId, 'add-extra', { addOnId: s.ids.half, count: 1, createKey: `e2e-${randomUUID()}` })
      checkStatus(half, 200, 'Add the extra half hour')
      const p = half.body.data.party
      checkEqual(p.dueCents, 300, 'Due after the extras (cents)')
      checkEqual(p.paymentState, 'partly', 'Payment state with extras due')
      checkEqual(Date.parse(p.endIso) - Date.parse(start), 120 * 60_000, 'Party length with extra time (ms)')
      check(!includesTime(await adminOpen(ctx, day), at(s, day, 1)), `${s.starts[1]} is still offered after adding extra time`)
      const replay = await act(ctx, partyId, 'add-extra', { addOnId: s.ids.bags, count: 1, createKey: bagsKey })
      checkStatus(replay, 200, 'The same add again')
      checkEqual(replay.body.data.replay, true, 'The repeat add is a replay')
      checkEqual(replay.body.data.party.dueCents, 300, 'Due after the repeat (cents)')

      const sent = await act(ctx, partyId, 'send-link')
      checkStatus(sent, 200, 'Send payment link')
      const link = linkParts(sent.body.data.url)
      const view = await balance(ctx, link)
      checkStatus(view, 200, 'The payment page')
      checkEqual(view.body.data.dueCents, 300, 'Due on the payment page (cents)')
      checkEqual(view.body.data.extrasOnly, true, 'The page says only extras are due')
      checkEqual(view.body.data.items.length, 2, 'Lines on the payment page')
      const pay = await payLink(ctx, link, 300)
      checkStatus(pay, 200, 'Pay the extras')
      checkEqual([pay.body.data.paidCents, pay.body.data.stillDueCents], [300, 0], 'Paid, still due')
      const after = await checkPartyPaid(ctx, scope, partyId, { cents: 300, via: 'link', charges: 2, lines: [`Party — ${s.bagsLabel}`, `Party — ${s.halfLabel}`] })
      const linkCharge = after.charges[after.charges.length - 1]
      const pkgItem = (after.items as any[]).find((it) => it.kind === 'package')
      check(!linkCharge.itemIds.includes(pkgItem.id), 'The link charged the package again')
      checkEqual(linkCharge.itemIds.length, 2, 'Items paid by the link')
      const off = await act(ctx, partyId, 'remove-extra', { itemId: bags.body.data.item.id })
      checkStatus(off, [400, 409], 'Taking off a paid extra')
    },
  },
  {
    id: 34,
    title: 'Move: free, taken, same time; reminder; hold buttons',
    plan: [
      'owner books A 4:00 by card; a link booking holds 4:00 on another day B',
      'moving A onto B 4:00 → refused "Clashes with the Blocker party, …"; moving A to B 6:30 → moved, A 4:00 offered again, money untouched, calendar file SEQUENCE 1',
      'moving to the time it is on → "Nothing changed", nothing to tell the host',
      '"Host not told yet" is set; To decide lists it; "I told them" there clears it; a second move (to A 6:30) sets it, the sheet\'s I told them clears it',
      'Hold this time again / Put the end time back / Free the old time each answer "nothing changed" when all is right; freeing its own time or from a stale screen is refused',
    ],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const dayA = await takeDay(ctx)
      const dayB = await takeDay(ctx)
      const a = await bookPaidOwner(ctx, scope, at(s, dayA, 0), 'Move')
      const blocker = await bookByLink(ctx, scope, at(s, dayB, 0), 'Blocker')
      await checkIcs(ctx, a.partyId, at(s, dayA, 0), 0)

      const onto = await act(ctx, a.partyId, 'move', { startIso: at(s, dayB, 0), fromIso: at(s, dayA, 0) })
      checkStatus(onto, 409, 'Moving onto a booked party')
      check(String(onto.body?.error ?? '').startsWith(`Clashes with ${clashLabel('Blocker')},`), `The refusal doesn't name the party in the way ("Clashes with ${clashLabel('Blocker')}, …"): ${onto.body?.error}`)
      check(!!(await partyOf(ctx, blocker.partyId)), 'The blocker party is gone')

      const to = at(s, dayB, 1)
      const moved = await act(ctx, a.partyId, 'move', { startIso: to, fromIso: at(s, dayA, 0) })
      checkStatus(moved, 200, 'Move to a free time')
      check(moved.body.data.sendDetails, 'No "Email the new details" offer after a move')
      check(moved.body.data.hostToTell, 'No host to tell after a move')
      let p = await partyOf(ctx, a.partyId)
      checkEqual(p.startIso, new Date(to).toISOString(), 'Party start after the move')
      checkEqual(p.charges.length, 1, 'Charges after the move')
      checkEqual(p.refunds.length, 0, 'Refunds after the move')
      checkEqual(p.timeVersion, 1, 'timeVersion after one move')
      check(p.notTold && p.notTold.what.includes('time'), 'The "Host not told yet" reminder is not set after a move')
      check(includesTime(await adminOpen(ctx, dayA), at(s, dayA, 0)), 'The old time is not offered again')
      check(includesTime(await publicOpen(ctx, dayA), at(s, dayA, 0)), '/book does not offer the old time again')
      await checkIcs(ctx, a.partyId, to, 1)

      const same = await act(ctx, a.partyId, 'move', { startIso: to })
      checkStatus(same, 200, 'Move to the time it is on')
      checkEqual(same.body.data.replay, true, 'Same-time move is a replay')
      checkEqual(same.body.data.sendDetails, null, 'Same-time move offers to email the host')
      check(/Nothing changed/.test(same.body.data.message), `Same-time move message: ${same.body.data.message}`)

      // The repair buttons: nothing to repair, so each says so (the broken states need a failure the sandbox can't make).
      checkEqual(p.holdState, { notHeld: null, freeable: [] }, 'Hold state after a clean move')
      const hold = await act(ctx, a.partyId, 'hold-again')
      checkStatus(hold, 200, 'Hold this time again')
      checkEqual(hold.body.data.replay, true, 'Hold this time again on a held party changes nothing')
      const fit = await act(ctx, a.partyId, 'fit-hold')
      checkStatus(fit, 200, 'Put the end time back')
      checkEqual(fit.body.data.replay, true, 'Put the end time back on a right-length hold changes nothing')
      const old = await act(ctx, a.partyId, 'free-time', { startIso: at(s, dayA, 0), shownStartIso: to, shownVersion: 1 })
      checkStatus(old, 200, 'Free the old time')
      checkEqual(old.body.data.replay, true, 'The old time was already free')
      const own = await act(ctx, a.partyId, 'free-time', { startIso: to, shownStartIso: to, shownVersion: 1 })
      checkStatus(own, 409, 'Freeing the time the party is on')
      const stale = await act(ctx, a.partyId, 'free-time', { startIso: at(s, dayA, 0), shownStartIso: at(s, dayA, 0), shownVersion: 0 })
      checkStatus(stale, 409, 'Freeing from a stale screen')

      const item = (await toDecide(ctx)).find((i) => i.kind === 'party-not-told' && i.detail?.partyId === a.partyId)
      check(item, 'To decide has no "Host not told yet" for the moved party')
      checkStatus(await ownerPost(ctx, '/api/admin/to-decide.json', { id: item.id, action: 'told' }), 200, 'I told them (To decide)')
      p = await partyOf(ctx, a.partyId)
      checkEqual(p.notTold, null, 'Reminder after I told them (To decide)')
      check(p.told, 'Who told the host is not recorded')

      // Not back to A 4:00: the host was told that time in the confirmation, so moving back rightly needs no reminder.
      const again = await act(ctx, a.partyId, 'move', { startIso: at(s, dayA, 1), fromIso: to })
      checkStatus(again, 200, 'Move a second time')
      p = await partyOf(ctx, a.partyId)
      check(p.notTold, 'The reminder is not set after the second move')
      const told = await act(ctx, a.partyId, 'mark-told', { notToldAt: p.notTold.at })
      checkStatus(told, 200, 'I told them (party sheet)')
      checkEqual((await partyOf(ctx, a.partyId)).notTold, null, 'Reminder after I told them (party sheet)')
      check(includesTime(await adminOpen(ctx, dayB), to), 'B 6:30 is not offered again after moving away')
    },
  },
  {
    id: 35,
    title: 'Owner refunds: part, already, again, too much',
    plan: [
      'party paid $1; refund $0.50 from /admin → Square refund of 50¢; 50¢ left',
      'the same $0.50 entered again → "Already refunded", nothing sent; Refund again (again.of) → a second 50¢ refund, nothing left',
      'one more cent → refused; the party stays booked and its time held',
    ],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const { partyId, party } = await bookPaidPublic(ctx, scope, at(s, day, 0), 'Refunds')
      const chargeId = party.charges[0].id
      const attempt = randomUUID()
      const r1 = await ownerRefund(ctx, { partyId, chargeId, cents: 50, attempt })
      checkStatus(r1, 200, 'Refund 50¢')
      checkEqual(r1.body.data.refundable[chargeId], 50, 'Left on the charge after 50¢ (cents)')
      await checkRefundInSquare(ctx, scope, r1.body.data.refundId, 50)
      const retry = await ownerRefund(ctx, { partyId, chargeId, cents: 50, attempt })
      checkStatus(retry, 200, 'The same refund tap again')
      checkEqual(retry.body.data.refundId, r1.body.data.refundId, 'A retried tap is the same refund')
      const r2 = await ownerRefund(ctx, { partyId, chargeId, cents: 50 })
      checkStatus(r2, 200, 'The same 50¢ entered again')
      check(r2.body.data.already, 'Entering the same refund again did not say "Already refunded"')
      checkEqual(r2.body.data.refundable[chargeId], 50, 'Left after "Already refunded" (cents)')
      const r3 = await ownerRefund(ctx, { partyId, chargeId, cents: 50, again: { of: r2.body.data.already.latest.requestId, token: randomUUID() } })
      checkStatus(r3, 200, 'Refund again')
      check(r3.body.data.refundId && r3.body.data.refundId !== r1.body.data.refundId, 'Refund again did not make a new refund')
      checkEqual(r3.body.data.refundable[chargeId], 0, 'Left after the second 50¢ (cents)')
      await checkRefundInSquare(ctx, scope, r3.body.data.refundId, 50)
      const r4 = await ownerRefund(ctx, { partyId, chargeId, cents: 1 })
      checkStatus(r4, 400, 'Refunding more than is left')
      const p = await partyOf(ctx, partyId)
      checkEqual([p.status, p.refunds.length, p.refunds.reduce((t: number, f: any) => t + f.cents, 0)], ['booked', 2, 100], 'Party after refunds (status, refunds, cents)')
      check(!includesTime(await adminOpen(ctx, day), at(s, day, 0)), 'A refund let the party time go')
    },
  },
  {
    id: 36,
    title: 'Crew refund from /staff needs a reason',
    plan: ['party paid $1; a /staff refund with no reason → refused', 'with a reason → refunded, the reason and who are on the party'],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const { partyId, party } = await bookPaidPublic(ctx, scope, at(s, day, 0), 'Crew refund')
      const chargeId = party.charges[0].id
      const none = await ctx.staff.post('/api/staff/party-refund.json', { partyId, chargeId, cents: 100, attempt: randomUUID() })
      checkStatus(none, 400, 'A crew refund with no reason')
      const reason = `E2E crew refund ${ctx.runTag}`
      const ok = await ctx.staff.post('/api/staff/party-refund.json', { partyId, chargeId, cents: 100, reason, attempt: randomUUID() })
      checkStatus(ok, 200, 'A crew refund with a reason')
      await checkRefundInSquare(ctx, scope, ok.body.data.refundId, 100)
      const p = await partyOf(ctx, partyId)
      const f = p.refunds[0]
      check(f && f.reason === reason, `The refund's reason isn't recorded (${f?.reason})`)
      check(f.by?.name, 'Who refunded is not recorded')
    },
  },
  {
    id: 37,
    title: 'Cancel: nothing refunded; time freed; guest pages say so',
    plan: [
      'party paid $1 on /book; cancel from /admin → "Nothing was refunded", the time offered again, the charge still there',
      'cancel again → already cancelled; Free this time → nothing was held; the reminder says the host must hear it',
      'the guest invite page says "This party was cancelled." with no RSVP; its calendar file is gone (410); the host page says cancelled, no pay box',
      'Refund after the cancel still works (the charge stays refundable)',
    ],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const start = at(s, day, 0)
      const { partyId, party, hostToken } = await bookPaidPublic(ctx, scope, start, 'Cancel')
      const c = await act(ctx, partyId, 'cancel', { note: 'E2E cancel' })
      checkStatus(c, 200, 'Cancel')
      check(/Nothing was refunded/.test(c.body.data.message), `Cancel message: ${c.body.data.message}`)
      let p = await partyOf(ctx, partyId)
      checkEqual([p.status, p.charges.length, p.refunds.length], ['cancelled', 1, 0], 'After cancel (status, charges, refunds)')
      check(p.notTold?.what?.includes('cancelled'), 'The reminder to tell the host about the cancel is not set')
      check(includesTime(await publicOpen(ctx, day), start), '/book does not offer the cancelled party\'s time')
      if (ctx.square) {
        const pay = (await ctx.square.get(`/payments/${encodeURIComponent(party.charges[0].paymentId)}`)).payment
        checkEqual(Number(pay.refunded_money?.amount ?? 0), 0, 'Square refunded on cancel (cents)')
      } else noSquare(scope)
      const twice = await act(ctx, partyId, 'cancel', {})
      checkStatus(twice, 200, 'Cancel again')
      checkEqual(twice.body.data.replay, true, 'Cancel again is a replay')
      const free = await act(ctx, partyId, 'free-time', { startIso: start, shownStartIso: p.startIso, shownVersion: p.timeVersion })
      checkStatus(free, 200, 'Free this time')
      checkEqual(free.body.data.replay, true, 'Nothing was held after the cancel')

      const page = await ctx.pub.request('GET', `/invite?party=${encodeURIComponent(partyId)}`, { headers: { Accept: 'text/html' } })
      checkStatus(page, 200, 'The guest invite page')
      check(page.text.includes('data-testid="party-cancelled"') && page.text.includes('This party was cancelled.'), 'The invite page doesn\'t say the party was cancelled')
      check(!page.text.includes('waiver_link_click'), 'The cancelled invite page still offers the RSVP')
      checkStatus(await inviteIcs(ctx, partyId), 410, 'The cancelled party\'s calendar file')
      const roster = await ctx.pub.get(`/api/party/roster.json?party=${encodeURIComponent(partyId)}&key=${encodeURIComponent(hostToken)}`)
      checkStatus(roster, 200, 'The host page')
      checkEqual([roster.body.data.party.cancelled, roster.body.data.party.pay], [true, null], 'Host page (cancelled, pay box)')

      const r = await ownerRefund(ctx, { partyId, chargeId: party.charges[0].id, cents: 100 })
      checkStatus(r, 200, 'Refund after the cancel')
      await checkRefundInSquare(ctx, scope, r.body.data.refundId, 100)
      p = await partyOf(ctx, partyId)
      checkEqual(p.status, 'cancelled', 'Status after the refund')
    },
  },
  {
    id: 38,
    title: 'Blocked time or a class over a party is refused',
    plan: ['a party held at 4:00 (payment link)', 'block 4:30–5:00 → 409 listing the party (R18); a class at 4:45 → refused naming it; nothing saved'],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const { partyId } = await bookByLink(ctx, scope, at(s, day, 0), 'Block')
      const blk = await ctx.admin.post('/api/admin/classes/blocked.json', {
        action: 'add', startIso: chicagoToUtcIso(day, '04:30'), endIso: chicagoToUtcIso(day, '05:00'), reason: `E2E block ${ctx.runTag}`,
      })
      if (blk.status === 200) scope.cleanup.add('unblock', async () => checkStatus(await ctx.admin.post('/api/admin/classes/blocked.json', { action: 'remove', id: blk.body.data.blocked.id }), 200, 'Unblock'))
      checkStatus(blk, 409, 'Blocking time over a party')
      check(((blk.body?.clashes ?? []) as any[]).some((c) => c.id === partyId), 'The block refusal does not list the party')
      const cls = await ctx.admin.post('/api/admin/classes/classes.json', {
        action: 'create', content: testContent({ name: `E2E ${ctx.runTag} Over a party` }), status: 'draft',
        sessions: [{ startIso: chicagoToUtcIso(day, '04:45'), endIso: chicagoToUtcIso(day, '05:15'), capacity: 6 }],
      })
      if (cls.status === 200) {
        const id = cls.body.data.class.id
        scope.cleanup.add(`cancel ${id}`, async () => {
          checkStatus(await ctx.admin.post('/api/admin/classes/classes.json', { action: 'cancel', id, expectedUpdatedAt: cls.body.data.class.updatedAt }), 200, 'Cancel the class')
        })
      }
      checkStatus(cls, 409, 'A class over a party')
      check(/^Clashes with/.test(cls.body?.error ?? ''), `Class clash message: ${cls.body?.error}`)
    },
  },
  {
    id: 39,
    title: 'Settings over booked parties: they stay booked, listed',
    plan: [
      'parties held at 4:00 on two test days (payment links)',
      'Parties setup takes the first day\'s times away → saved; the reply lists that party as still booked; /book offers nothing that day; the party is unchanged; times put back',
      'a closed day "E2E closure <run>" on the second day → saved; the reply lists that party; /book offers nothing that day; the closed day removed',
    ],
    async run(ctx, scope) {
      const s = await ensureParty(ctx)
      const d1 = await takeDay(ctx)
      const d2 = await takeDay(ctx)
      const p1 = await bookByLink(ctx, scope, at(s, d1, 0), 'Setup change')
      const p2 = await bookByLink(ctx, scope, at(s, d2, 0), 'Closed day')

      const { settings } = await readPartySettings(ctx)
      const input = settingsInput(settings)
      const without = { ...input, times: { ...input.times, dates: { ...input.times.dates, [d1]: [] } } }
      const save = await saveParty(ctx, without, settings.updatedAt)
      checkStatus(save, 200, 'Take the test day\'s party times away')
      let savedAt: string = save.body.data.settings.updatedAt
      scope.cleanup.add(`put the party times back on ${d1}`, async () => {
        const cur = (await readPartySettings(ctx)).settings
        if (JSON.stringify(cur.times.dates[d1]) === JSON.stringify(s.starts)) return
        const ci = settingsInput(cur)
        checkStatus(await saveParty(ctx, { ...ci, times: { ...ci.times, dates: { ...ci.times.dates, [d1]: [...s.starts] } } }, cur.updatedAt), 200, 'Put the times back')
      })
      check(((save.body.data.booked ?? []) as any[]).some((b) => JSON.stringify(b).includes(p1.partyId)), `The save does not list the party still booked (${JSON.stringify(save.body.data.booked)})`)
      checkEqual(save.body.data.note, 'Anything already booked stays booked.', 'The save says booked parties stay')
      checkEqual(await publicOpen(ctx, d1), [], '/book times on a day with its party times taken away')
      const still = await partyOf(ctx, p1.partyId)
      checkEqual([still.status, still.startIso], ['booked', new Date(at(s, d1, 0)).toISOString()], 'The booked party after the save')
      const back = await saveParty(ctx, input, savedAt)
      checkStatus(back, 200, 'Put the times back')
      savedAt = back.body.data.settings.updatedAt
      check(includesTime(await publicOpen(ctx, d1), at(s, d1, 1)), `${s.starts[1]} is not offered again after the times came back`)

      const view = await ctx.admin.get('/api/admin/settings.json')
      checkStatus(view, 200, 'Read the studio settings')
      const st = view.body.data.settings
      const rows = { cafeWeekly: st.cafeWeekly, cafeSpecialDays: st.cafeSpecialDays }
      const closed = await ctx.admin.post('/api/admin/settings.json', {
        ...rows, closures: [...st.closures, { from: d2, to: d2, name: `E2E closure ${ctx.runTag}` }], expectedUpdatedAt: st.updatedAt,
      })
      checkStatus(closed, 200, 'Save a closed day over a party')
      const closedAt: string = closed.body.data.settings.updatedAt
      scope.cleanup.add('remove the E2E closed day', async () => {
        checkStatus(await ctx.admin.post('/api/admin/settings.json', { ...rows, closures: st.closures, expectedUpdatedAt: closedAt }), 200, 'Remove the closed day')
      })
      check(((closed.body.data.booked ?? []) as any[]).some((b) => JSON.stringify(b).includes(p2.partyId)), `The closed-day save does not list the party (${JSON.stringify(closed.body.data.booked)})`)
      checkEqual(await publicOpen(ctx, d2), [], '/book times on a closed day')
      checkEqual((await partyOf(ctx, p2.partyId)).status, 'booked', 'The party on the closed day')
    },
  },
  {
    id: 40,
    title: 'Refund made in Square shows once on the party',
    plan: [
      'sandbox token only: party paid $1 on /book; refund it in the Square sandbox directly',
      'run the reconcile twice → the party shows that one refund (made in Square), once',
    ],
    async run(ctx, scope) {
      if (!ctx.square) throw new SkipScenario('needs SQUARE_SANDBOX_ACCESS_TOKEN (it refunds in the Square sandbox directly)')
      const s = await ensureParty(ctx)
      const day = await takeDay(ctx)
      const { partyId, party } = await bookPaidPublic(ctx, scope, at(s, day, 0), 'Square refund')
      const refund = (await ctx.square.post('/refunds', {
        idempotency_key: randomUUID(), payment_id: party.charges[0].paymentId, amount_money: { amount: 100, currency: 'USD' }, reason: 'E2E refund made in Square',
      })).refund
      check(refund?.id, 'Square made no refund')
      for (let i = 0; i < 2; i++) {
        await ctx.sleep(3_000)
        await reconcile(ctx)
      }
      const p = await partyOf(ctx, partyId)
      const mine = (p.refunds as any[]).filter((f) => f.squareRefundId === refund.id)
      checkEqual(mine.length, 1, 'Times the Square refund shows on the party')
      checkEqual([mine[0].cents, mine[0].role], [100, 'square'], 'The Square refund (cents, by)')
      checkEqual(p.refunds.length, 1, 'Refunds on the party')
    },
  },
]

// ── After a run stopped part way ───────────────────────────────────────────

/** What --cleanup-only does for parties (also printed by --cleanup-only --dry-run). */
export const PARTY_CLEANUP_PLAN = [
  'cancel every booked party in the next 120 days whose host starts "E2E " (cancelling never refunds anyone), tap "I told them" on it, and free any time still held for one',
  'tap "I told them" on every "Host not told yet" in To decide whose host starts "E2E " (cancelled test parties of older runs)',
  'take packages and extras named "E2E …" and dated party days that start before 8 AM out of Parties setup',
  'tick "Keep their times blocked on the calendar" (the Square read) again if a test run turned it off and was stopped before putting it back',
]

/**
 * True when the Square read switch is off because a test run turned it off
 * (scenario 24) and was killed before turning it back on: the save that
 * turned it off was made while an "E2E …" package was in Parties setup.
 * A switch an owner turned off with no test package around is left alone.
 */
export function switchOffByTest(settings: any): boolean {
  if (settings?.readSquareBookings !== false) return false
  const offSave = ((settings.history ?? []) as any[]).find((h) => h?.before?.readSquareBookings === true)
  return !!offSave && ((offSave.before.packages ?? []) as any[]).some((p) => isTest(p?.name))
}

const LOOK_AHEAD_DAYS = 120
const WINDOW_DAYS = 40

/** Finds the party leftovers of earlier runs on the preview and clears them. Only ever touches "E2E …" parties and test days. */
export async function cleanUpPartyLeftovers(ctx: Pick<PartyCtx, 'admin'>, log: (line: string) => void, now: Date = new Date()): Promise<{ done: string[]; failed: string[] }> {
  const done: string[] = []
  const failed: string[] = []
  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn()
      done.push(label)
      log(`    done: ${label}`)
    } catch (e) {
      const msg = `${label} (${e instanceof Error ? e.message : String(e)})`
      failed.push(msg)
      log(`    FAILED: ${msg}`)
    }
  }
  const seen = new Set<string>()
  for (let off = 0; off < LOOK_AHEAD_DAYS; off += WINDOW_DAYS) {
    const from = new Date(now.getTime() + off * 86_400_000).toISOString()
    const to = new Date(now.getTime() + (off + WINDOW_DAYS) * 86_400_000).toISOString()
    const cal = await ctx.admin.get(`/api/admin/classes/calendar.json?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
    checkStatus(cal, 200, 'Read the calendar')
    for (const it of (cal.body.data?.items ?? []) as any[]) {
      if (it.kind !== 'party' || !isTest(it.hostName) || seen.has(it.id)) continue
      seen.add(it.id)
      await step(`clear party ${it.hostName} (${it.id})`, () => clearTestParty(ctx, it.id))
    }
  }

  // Cancelled test parties of older runs that still say "Host not told yet" (the calendar no longer lists them).
  for (const item of (await toDecide(ctx)) ?? []) {
    if (item.kind !== 'party-not-told' || !isTest(item.detail?.host)) continue
    await step(`I told them: ${item.detail.host} (${item.detail.partyId})`, async () => {
      checkStatus(await ctx.admin.request('POST', '/api/admin/to-decide.json', { body: { id: item.id, action: 'told' }, headers: OWNER_HEADERS }), 200, 'I told them')
    })
  }

  const { settings } = await readPartySettings(ctx)
  const next = withoutTestSetup(settingsInput(settings), switchOffByTest(settings) ? { readSquareBookings: true } : {})
  if (next) {
    const label = next.readSquareBookings !== settings.readSquareBookings
      ? 'take the E2E package, extras and test days out of Parties setup, and turn the Square read back on (a test run turned it off)'
      : 'take the E2E package, extras and test days out of Parties setup'
    await step(label, async () => {
      const r = await ctx.admin.request('POST', '/api/admin/parties/settings.json', { body: { ...next, expectedUpdatedAt: settings.updatedAt }, headers: OWNER_HEADERS })
      checkStatus(r, 200, 'Save Parties setup')
    })
  }
  return { done, failed }
}
