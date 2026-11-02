/**
 * The staff console's "Needs attention" scan (spec G). Read-only: it reports
 * and says what a person does about it, in Square. Nothing here may cancel,
 * move or release a booking.
 *
 * Throws when classes or bookings can't be read: an empty list must only ever
 * mean "checked, and nothing is wrong". A source that can't be asked at all
 * (no listBookings, no listAllWorkshops) counts as can't be read.
 *
 * Oversold only fires when Square reports a NEGATIVE available_capacity: an
 * exactly-full class looks the same as an oversold one, so the roster's
 * seats-sold figure remains the human check.
 *
 * Capacity is Square's figure when it gives one, else the class's own setting
 * (Square's buyer API sends none for real classes). A class with questions and
 * no capacity anywhere gets a capacity-unknown line rather than silence.
 */
import { providers } from '@config/providers'
import { studioOpenOn, type Closure } from '@config/closures'
import { getClosures } from '@lib/studio-settings'
import { getEventMeta, type EventMeta } from '@lib/event-meta'
import { listSeatChoicesByEvent } from '@lib/seat-choices'
import { partyBusy } from '@lib/classes/studio-schedule'
import { createLogger } from '@lib/logger'
import { formatCalendarDay, formatTime, formatTimeSpan, studioDate, studioDayUtcRange } from '@lib/studio-time'
import { classSpanOf, classesOverlap, partyBlocksClass, partyName, type ClassSpan, type PartySpan } from '@lib/conflicts'
import type { Workshop } from '@providers/interfaces/workshop'
import { getClass, listClasses } from '@lib/classes/class-store'
import { cardsStillOn, waitlistItems, waitlistStop } from '@lib/classes/waitlist-items'
import { waitlistOrNull } from '@lib/classes/waitlist-store'
import { listWaitingReaderSales } from '@lib/classes/reader-store'
import { readerNeedsDeciding } from '@lib/classes/reader-flow'
import { listPromos } from '@lib/promos/promo-store'
import { couldBeFree, promoState } from '@lib/promos/rules'
import { getLedger, seatsTaken } from '@lib/classes/seat-ledger'
import { listPosNeedsDays, listRefundFlags, listUnmatchedPos, openPaidNotSeated, type RefundFlag } from '@lib/classes/square-events'
import { onStaffConsole } from '@lib/classes/staff-view'
import { listCounterMatchChecks, listDoorUnpaid } from '@lib/classes/door-unpaid'
import { decidedIds, minimumItemId } from '@lib/classes/decided'
import type { ScheduledClass } from '@lib/classes/types'
import { notOnRegister, posPricesStale, registerSetupStale } from '@lib/classes/pos-plan'
import { registerInForce } from '@lib/classes/register-setup'
import { earlyBirdRunning } from '@lib/classes/early-bird'
import { formatMoney } from '@lib/money'
import { getPartyRecord } from '@lib/party-store'
import { partyLabel } from '@lib/parties/refunds'
import { PARTY_SCOPE } from '@lib/booking-core/refund-runner'

const logger = createLogger('warnings')

export type WarningCode =
  | 'class-over-party' | 'class-over-class' | 'oversold' | 'party-on-closed-day' | 'picks-missing' | 'capacity-unknown' | 'recorded-over-sold'
  // our own classes (Task 14): read-only for the crew; owners decide on /admin
  | 'below-minimum' | 'pos-unmatched' | 'pos-needs-days' | 'refund-flag' | 'door-unpaid' | 'counter-match-check' | 'classes-unreadable'
  // R42: Square shows one of our online bookings paid, but its seats were let go
  | 'paid-not-seated'
  // Stage 4 (I2): the register's price for a class isn't its current price (the early-bird ended or started, the POS didn't follow)
  | 'pos-price-stale'
  // Fix round 3: a class that should be on the register isn't (setup not done, or a save's register write failed)
  | 'not-on-register'
  // Fix round 4: a class on the register still has an older tax or category than More › Register setup
  | 'register-old-setup'
  // Stage 4 waitlist: a saved-card charge Square never answered (seat held), or a card that didn't go through / a price that rose
  | 'waitlist-unknown' | 'waitlist-declined'
  // Task 12: the waitlist stopped with a free seat it could take; a saved card Square hasn't confirmed off file
  | 'waitlist-stopped' | 'waitlist-card-on'
  // Task 12: a "Charge on the reader" payment that never came back (or didn't match); the seat is held
  | 'reader-waiting'
  // Task 12: no class tax picked in More › Register setup, so classes can't go on the register
  | 'register-setup-missing'
  // Task 12: an active promo code that books for free with no use limit
  | 'promo-free-unlimited'

export interface Warning {
  code: WarningCode
  eventKind: 'workshop' | 'party'
  /** Class schedule id or party booking id: what the panel opens. '' = nothing to open (a counter sale that matched no class). */
  eventId: string
  /** ISO start of the event the line is about. */
  when: string
  title: string
  /** "Pumpkin Pails 1–3 PM is within an hour of the Rivera party 1:00 PM." */
  detail: string
  /** What a person does about it: "Move one in Square." */
  action: string
  /** Stable id of an undated item (a counter sale, a refund flag…), so the daily email can tell new from old. */
  itemId?: string
}

/** Items that aren't tied to a day: they stay until an owner decides. */
export const UNDATED_CODES: ReadonlySet<WarningCode> = new Set<WarningCode>([
  'pos-unmatched', 'pos-needs-days', 'refund-flag', 'door-unpaid', 'counter-match-check', 'paid-not-seated', 'waitlist-unknown', 'waitlist-declined',
  'waitlist-card-on', 'reader-waiting', 'register-setup-missing', 'promo-free-unlimited',
])

/** Days ahead the panel and the daily email look. */
export const WARNING_WINDOW_DAYS = 60

/** "Sun Oct 18 · <detail> <action>" — the one line format, on the panel and in the email. */
export function warningLine(w: Warning): string {
  // These already name their day (and the class), so the line doesn't repeat it.
  if (w.code === 'door-unpaid' || w.code === 'counter-match-check') return `${w.detail.replace(/\.$/, '')}. ${w.action}`
  return `${formatCalendarDay(studioDate(w.when))} · ${w.detail} ${w.action}`
}

interface ScannedClass {
  span: ClassSpan
  workshop: Workshop
  meta: EventMeta | null
}

/** Seats the class holds: Square's figure, else the class's own setting. */
const capacityOf = (c: ScannedClass): number | null => c.workshop.totalCapacity ?? c.meta?.capacity ?? null

interface Scan {
  classes: ScannedClass[]
  parties: PartySpan[]
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

async function scan(from: string, to: string): Promise<Scan> {
  const startIso = studioDayUtcRange(from).startIso
  const endIso = studioDayUtcRange(to).endIso
  const lo = Date.parse(startIso)
  const hi = Date.parse(endIso)
  const w = providers.workshop
  if (typeof w.listAllWorkshops !== 'function') throw new Error('Classes cannot be read — warnings scan refused')
  // Parties: our party book's held and booked ones and Square-booked ones (party service only); throws when unreadable.
  const [workshops, partyList] = await Promise.all([w.listAllWorkshops(), partyBusy(startIso, endIso)])
  const inWindow = workshops.filter((x) => {
    const t = Date.parse(x.startAt)
    return t >= lo && t <= hi
  })
  // A settings read that fails throws: it fails the scan, never quietly skips.
  const classes = (
    await Promise.all(
      inWindow.map(async (workshop) => {
        const span = classSpanOf(workshop)
        return { span, workshop, meta: await getEventMeta('workshop', span.id) }
      }),
    )
  ).sort((a, b) => a.span.startIso.localeCompare(b.span.startIso))
  const parties: PartySpan[] = partyList.map((p) => ({
    id: p.id, startIso: p.startIso, endIso: p.endIso, ...(p.hostName ? { hostName: p.hostName } : {}),
  }))
  return { classes, parties }
}

function classOverParty(s: Scan): Warning[] {
  return s.classes.flatMap(({ span }) =>
    partyBlocksClass(span.startIso, span.endIso, s.parties).map((p): Warning => ({
      code: 'class-over-party',
      eventKind: 'workshop',
      eventId: span.id,
      when: span.startIso,
      title: span.name,
      detail: `${span.name} ${formatTimeSpan(span.startIso, span.endIso)} is within an hour of ${partyName(p)} ${formatTime(p.startIso)}.`,
      action: 'Move one in Square.',
    })),
  )
}

function classOverClass(s: Scan): Warning[] {
  const out: Warning[] = []
  for (let i = 0; i < s.classes.length; i++) {
    for (let j = i + 1; j < s.classes.length; j++) {
      const a = s.classes[i].span
      const b = s.classes[j].span
      if (!classesOverlap(a, b)) continue
      out.push({
        code: 'class-over-class',
        eventKind: 'workshop',
        eventId: a.id,
        when: a.startIso,
        title: a.name,
        detail: `${a.name} ${formatTimeSpan(a.startIso, a.endIso)} is within an hour of ${b.name} ${formatTimeSpan(b.startIso, b.endIso)}.`,
        action: 'Move one in Square.',
      })
    }
  }
  return out
}

function oversold(s: Scan): Warning[] {
  return s.classes.flatMap((c): Warning[] => {
    const { span, workshop } = c
    // Only fires if Square reports a NEGATIVE available_capacity; an exactly-full
    // class is indistinguishable from an oversold one. The roster's seats-sold
    // figure is the human check.
    const total = capacityOf(c)
    if (total === null) return []
    const sold = total - workshop.availableCapacity
    if (sold <= total) return []
    return [{
      code: 'oversold',
      eventKind: 'workshop',
      eventId: span.id,
      when: span.startIso,
      title: span.name,
      detail: `${span.name}: ${sold} seats sold, ${total} capacity.`,
      action: 'Sort it out in Square.',
    }]
  })
}

function partyOnClosedDay(s: Scan, closed: Closure[]): Warning[] {
  return s.parties
    .filter((p) => !studioOpenOn(studioDate(p.startIso), closed))
    .map((p): Warning => ({
      code: 'party-on-closed-day',
      eventKind: 'party',
      eventId: p.id,
      when: p.startIso,
      title: capitalize(partyName(p)),
      detail: `${capitalize(partyName(p))} ${formatTime(p.startIso)} is booked on a closed day.`,
      action: 'Move it in Square or open the day.',
    }))
}

/**
 * Seats sold against seats on record, both ways:
 * - picks-missing: sold minus recorded — someone booked outside our site.
 *   Only for a class that asks questions; with no capacity to count against,
 *   says so instead of going quiet.
 * - recorded-over-sold: recorded minus sold — a seat was recorded here (a
 *   comp, say) but never added in Square, so Square can still sell it.
 */
async function seatCounts(s: Scan): Promise<Warning[]> {
  const checked = await Promise.all(
    s.classes.map(async (c): Promise<Warning[]> => {
      const { span, workshop } = c
      const options = c.meta?.options ?? []
      const capacity = capacityOf(c)
      if (capacity === null) {
        if (options.length === 0) return []
        return [{
          code: 'capacity-unknown',
          eventKind: 'workshop',
          eventId: span.id,
          when: span.startIso,
          title: span.name,
          detail: `Can’t count seats sold for ${span.name}. Set its capacity (gear → Capacity) so seats booked on Square’s own page get flagged.`,
          action: 'Set the capacity.',
        }]
      }
      const sold = capacity - workshop.availableCapacity
      const records = await listSeatChoicesByEvent('workshop', span.id)
      if (options.length === 0 && records.length === 0) return []
      const recorded = records.reduce((n, r) => n + r.seats, 0)
      const out: Warning[] = []
      const missing = sold - recorded
      if (options.length > 0 && missing > 0) {
        out.push({
          code: 'picks-missing',
          eventKind: 'workshop',
          eventId: span.id,
          when: span.startIso,
          title: span.name,
          detail: `${span.name}: ${missing} seat${missing === 1 ? ' has' : 's have'} no ${options[0].label.toLowerCase()}.`,
          action: 'Call the customer.',
        })
      }
      // A simulated (preview) record never reached Square, so it can't be
      // "recorded but not added in Square" — count only real ones here.
      const extra = records.filter((r) => r.simulated !== true).reduce((n, r) => n + r.seats, 0) - sold
      if (extra > 0) {
        out.push({
          code: 'recorded-over-sold',
          eventKind: 'workshop',
          eventId: span.id,
          when: span.startIso,
          title: span.name,
          detail: `${span.name} · ${extra} recorded seat${extra === 1 ? '' : 's'} more than Square shows —`,
          action: 'someone was recorded here but not added in Square.',
        })
      }
      return out
    }),
  )
  return checked.flat()
}

/** Where the crew send anything about our own classes that needs a decision. */
export const OWNERS_DECIDE = 'An owner decides on /admin.'

/**
 * Our own classes, from the seat ledger and what Square told us (Task 14):
 * - oversold: a session with more seats than it holds ("41 of 40"), e.g. a
 *   paid seat whose hold ran out, a counter sale, or one more squeezed in
 * - below-minimum: fewer booked than the class needs to run, before its decide-by
 * - pos-unmatched / pos-needs-days: counter sales nobody has sorted out yet
 * - refund-flag: refunds made in Square, or ours still waiting on Square
 * - door-unpaid: a "pay at the counter" seat never rung up once its session ended (R32)
 * - paid-not-seated: Square shows one of our online bookings paid, but its seats were let go (R42)
 * The last five aren't tied to the window: they stay until someone decides.
 * Read-only: nothing here frees, moves or refunds anything.
 */
async function ownClassWarnings(from: string, to: string, now: Date): Promise<Warning[]> {
  const startIso = studioDayUtcRange(from).startIso
  const endIso = studioDayUtcRange(to).endIso
  const [classes, unmatched, needsDays, flags, unpaid, matches, decided, paidNoSeat] = await Promise.all([
    listClasses({ fromIso: startIso, toIso: endIso }),
    listUnmatchedPos(),
    listPosNeedsDays(),
    listRefundFlags(),
    listDoorUnpaid(now),
    listCounterMatchChecks(now),
    // What owners already decided in /admin › To decide (e.g. "Keep it running") stops showing here.
    decidedIds(),
    openPaidNotSeated(),
  ])
  const shown = classes.filter(onStaffConsole)
  const register = await registerInForce().catch(() => null)
  const byId = new Map<string, ScheduledClass>(shown.map((c) => [c.id, c]))
  const out: Warning[] = []
  for (const cls of shown) {
    const ledger = await getLedger(cls.id)
    const name = cls.content.name
    const sessions = [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))
    for (const s of sessions) {
      if (s.startIso > endIso || s.endIso < startIso) continue
      const sold = seatsTaken(ledger, s.id, now)
      if (sold > s.capacity) {
        out.push({
          code: 'oversold', eventKind: 'workshop', eventId: cls.id, when: s.startIso, title: name,
          detail: `${name} ${formatTime(s.startIso)}: ${sold} of ${s.capacity} booked.`, action: OWNERS_DECIDE,
        })
      }
    }
    // I2: the hourly job couldn't put the POS price right (or a save's POS write failed). Shown until it's fixed.
    if (posPricesStale(cls, now)) {
      const firstLeft = sessions.find((s) => Date.parse(s.endIso) > now.getTime()) ?? sessions[0]
      out.push({
        code: 'pos-price-stale', eventKind: 'workshop', eventId: cls.id, when: firstLeft?.startIso ?? now.toISOString(), title: name,
        detail: earlyBirdRunning(cls.content, now)
          ? `The register doesn’t have the early-bird price for ${name} yet.`
          : `The register still rings the early-bird price for ${name}. The early-bird has ended.`,
        action: 'An owner opens the class in /admin and taps Fix the register price now.',
      })
    }
    // Fix round 3: it can't be booked online or rung up until it's on the register.
    if (notOnRegister(cls, now)) {
      const firstLeft = sessions.find((s) => Date.parse(s.endIso) > now.getTime()) ?? sessions[0]
      out.push({
        code: 'not-on-register', eventKind: 'workshop', eventId: cls.id, when: firstLeft?.startIso ?? now.toISOString(), title: name,
        detail: `${name} isn’t on the register yet, so it can’t be booked online.`,
        action: 'An owner opens the class in /admin and taps Put it on the register.',
      })
    } else if (registerSetupStale(cls, register, now)) {
      const firstLeft = sessions.find((s) => Date.parse(s.endIso) > now.getTime()) ?? sessions[0]
      out.push({
        code: 'register-old-setup', eventKind: 'workshop', eventId: cls.id, when: firstLeft?.startIso ?? now.toISOString(), title: name,
        detail: `The register still has the old tax or category for ${name}.`,
        action: 'An owner taps Update them all in /admin › More › Register setup (or Update the register on the class).',
      })
    }
    // Stage 4: the waitlist's unclear charges and cards that didn't go through, until an owner decides in To decide.
    for (const w of await waitlistItems(cls, decided, now)) {
      out.push({
        code: w.kind, eventKind: 'workshop', eventId: cls.id, when: w.at, title: name, itemId: w.id, detail: w.warning, action: OWNERS_DECIDE,
      })
    }
    // Task 12: the waitlist stopped with a seat it could take (the class sheet's button fixes it), and saved cards not yet off file.
    const list = await waitlistOrNull(cls.id)
    if (list?.entries.length) {
      const stop = waitlistStop(cls, list, ledger, now)
      if (stop) {
        const firstLeft = sessions.find((s) => Date.parse(s.endIso) > now.getTime()) ?? sessions[0]
        out.push({
          code: 'waitlist-stopped', eventKind: 'workshop', eventId: cls.id, when: firstLeft?.startIso ?? now.toISOString(), title: name,
          detail: `${name}: ${stop.words}`,
          action: `An owner opens the class in /admin and taps ${stop.button} on its waitlist.`,
        })
      }
      for (const e of cardsStillOn(list, now)) {
        out.push({
          code: 'waitlist-card-on', eventKind: 'workshop', eventId: cls.id, when: e.attempts[e.attempts.length - 1]?.at ?? e.createdAt, title: name,
          itemId: `wl-card-${e.id}`,
          detail: `${name}: ${`${e.customer.givenName} ${e.customer.familyName}`.trim()} is off the waitlist, but Square hasn’t confirmed their saved card (ending ${e.square.last4}) came off file yet. Nothing will be charged.`,
          action: 'An owner opens the class in /admin and taps Take the card off now on its waitlist.',
        })
      }
    }
    const min = cls.content.rules.minimumToRun
    const first = sessions[0]
    if (min && first && Date.parse(first.startIso) > now.getTime() && first.startIso <= endIso && !decided.has(minimumItemId(cls.id))) {
      const booked = seatsTaken(ledger, first.id, now)
      if (booked < min.count) {
        out.push({
          code: 'below-minimum', eventKind: 'workshop', eventId: cls.id, when: first.startIso, title: name,
          detail: `${name} has ${booked} of the ${min.count} it needs to run, decide by ${formatCalendarDay(studioDate(min.decideByIso))} ${formatTime(min.decideByIso)}.`,
          action: OWNERS_DECIDE,
        })
      }
    }
  }
  for (const u of unmatched) {
    out.push({
      code: 'pos-unmatched', eventKind: 'workshop', eventId: '', when: u.at, title: u.name, itemId: `unmatched-${u.orderId}-${u.lineUid}`,
      detail: `A counter sale of ${u.name}${u.qty > 1 ? ` ×${u.qty}` : ''} didn’t match a class.`, action: OWNERS_DECIDE,
    })
  }
  const nameOf = async (classId: string) => byId.get(classId)?.content.name ?? (await getClass(classId))?.content.name ?? 'A class'
  for (const d of needsDays) {
    const name = await nameOf(d.classId)
    out.push({
      code: 'pos-needs-days', eventKind: 'workshop', eventId: d.classId, when: d.at, title: name, itemId: d.id,
      detail: `A counter sale of ${name} needs its day picked.`, action: OWNERS_DECIDE,
    })
  }
  for (const u of unpaid) {
    out.push({
      code: 'door-unpaid', eventKind: 'workshop', eventId: u.classId, when: u.sessionStartIso, title: u.className, itemId: u.id,
      detail: `${u.name || 'A door seat'} · ${u.className} · ${formatCalendarDay(u.day)} · not paid at the counter yet`, action: OWNERS_DECIDE,
    })
  }
  for (const m of matches) {
    out.push({
      code: 'counter-match-check', eventKind: 'workshop', eventId: m.classId, when: m.at, title: m.className, itemId: m.id,
      detail: `Counter sale of ${m.className} on ${formatCalendarDay(m.day)} was matched to ${m.name}. Check it was them.`, action: OWNERS_DECIDE,
    })
  }
  for (const p of paidNoSeat) {
    const name = await nameOf(p.classId)
    out.push({
      code: 'paid-not-seated', eventKind: 'workshop', eventId: p.classId, when: p.at, title: name, itemId: p.id,
      detail: p.why === 'no-seats'
        ? `${name}: ${formatMoney(p.chargedCents)} was paid online, but the seats were let go before the booking finished. Nothing was refunded.`
        : `${name}: a second ${formatMoney(p.chargedCents)} payment on a booking that was already paid. Nothing was refunded.`,
      action: OWNERS_DECIDE,
    })
  }
  // Task 12: reader sales the Square app never answered (15 minutes on) or whose order didn't match. The seat is held.
  for (const sale of await listWaitingReaderSales().catch(() => [])) {
    if (!readerNeedsDeciding(sale, now)) continue
    const who = `${sale.customer.givenName} ${sale.customer.familyName}`.trim() || 'A door sale'
    const when = `${formatCalendarDay(studioDate(sale.firstStartIso))} ${formatTime(sale.firstStartIso)}`
    out.push({
      code: 'reader-waiting', eventKind: 'workshop', eventId: sale.classId, when: sale.startedAt, title: sale.className, itemId: `reader-${sale.bookingId}`,
      detail: sale.problem
        ? `${sale.className} ${when}: Square shows a payment for ${who}’s reader sale that doesn’t match the ${formatMoney(sale.amountCents)} asked. The seat is held, not paid.`
        : `${sale.className} ${when}: ${who}’s ${formatMoney(sale.amountCents)} reader payment never came back from the Square app. The seat is held.`,
      action: OWNERS_DECIDE,
    })
  }
  for (const f of flags) {
    if (f.classId === PARTY_SCOPE) {
      // A refund on a party: named and opened as that party (bookingId = the party id), never "A class".
      const rec = await getPartyRecord(f.bookingId).catch(() => null)
      const name = capitalize(rec ? partyLabel(rec) : 'a party')
      out.push({ code: 'refund-flag', eventKind: 'party', eventId: f.bookingId, when: f.at, title: name, itemId: f.id, detail: refundFlagDetail(f, name), action: OWNERS_DECIDE })
      continue
    }
    const name = await nameOf(f.classId)
    out.push({ code: 'refund-flag', eventKind: 'workshop', eventId: f.classId, when: f.at, title: name, itemId: f.id, detail: refundFlagDetail(f, name), action: OWNERS_DECIDE })
  }
  out.push(...(await setupWarnings(shown, register, now)))
  return out
}

/**
 * Task 12, studio-wide setup lines (no class to open):
 * - register-setup-missing: no class tax is picked, so no class can go on the
 *   register (only while there are classes that need it)
 * - promo-free-unlimited: a code that's on, books for free (100% off) and has
 *   no use limit: anyone who hears it books free
 */
async function setupWarnings(shown: ScheduledClass[], register: Awaited<ReturnType<typeof registerInForce>> | null, now: Date): Promise<Warning[]> {
  const out: Warning[] = []
  const needsRegister = shown.some((c) => notOnRegister(c, now))
  if (register && !register.classTaxId && needsRegister) {
    out.push({
      code: 'register-setup-missing', eventKind: 'workshop', eventId: '', when: now.toISOString(), title: 'Register setup', itemId: 'register-setup-missing',
      detail: 'No class tax is picked yet, so classes can’t go on the register or be booked online.',
      action: 'An owner opens More › Register setup, picks the 9% tax (or taps Make the 9% class tax) and taps Save.',
    })
  }
  const codes = await listPromos(now).catch(() => [])
  for (const p of codes) {
    if (promoState(p, now) !== 'on' || p.maxUses !== null || couldBeFree(p.off) !== 'free') continue
    out.push({
      code: 'promo-free-unlimited', eventKind: 'workshop', eventId: '', when: p.updatedAt, title: `Code ${p.code}`, itemId: `promo-free-${p.code}`,
      detail: `Code ${p.code} books for free and has no use limit, so anyone who hears it can book free.`,
      action: 'An owner opens More › Promotions › the code and taps Edit to set a use limit, or Turn off.',
    })
  }
  return out
}

function refundFlagDetail(f: RefundFlag, name: string): string {
  const money = formatMoney(f.refundCents ?? f.cents)
  switch (f.kind) {
    case 'plain-refund': return `${name}: ${money} was refunded in Square. Should a seat be freed?`
    case 'refund-failed': return `${name}: Square couldn’t finish a ${money} refund.`
    case 'refund-unconfirmed': return `${name}: a ${money} refund is still waiting on Square.`
    case 'refund-unfinished': return `${name}: a ${money} refund checked in Square was never finished.`
    default: return `${name}: a refund needs a look.`
  }
}

export async function listWarnings({ from, to }: { from: string; to: string }, opts: { now?: Date } = {}): Promise<Warning[]> {
  const now = opts.now ?? new Date()
  // Our classes can't be read: say so in one line rather than hiding the Square and party warnings (never an all clear).
  const ownOrError = ownClassWarnings(from, to, now).catch((e): Warning[] => {
    logger.error('Class warnings scan failed', { error: e instanceof Error ? e.message : String(e) })
    return [{
      code: 'classes-unreadable', eventKind: 'workshop', eventId: '', when: now.toISOString(), title: 'Classes',
      detail: 'Our classes couldn’t be checked for problems.', action: 'Refresh to try again.',
    }]
  })
  // The owners' closed days (config until they first save on /admin).
  const [s, own, closed] = await Promise.all([scan(from, to), ownOrError, getClosures()])
  return [...classOverParty(s), ...classOverClass(s), ...oversold(s), ...partyOnClosedDay(s, closed), ...(await seatCounts(s)), ...own].sort((a, b) =>
    a.when.localeCompare(b.when),
  )
}
