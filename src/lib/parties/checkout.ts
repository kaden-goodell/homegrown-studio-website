/**
 * Party checkout: one Square order and one charge per party, and no Square
 * booking. The public /book route and /admin (Task 11) share it.
 *
 *   0. a retry of this key?        the party is recorded → its stored answer;
 *                                  its time held → "still finishing" (or, if
 *                                  Square shows the order paid, record it: R15)
 *   1. settings, quote, date       prices only from the saved Parties setup
 *   2. the time is free            shared studio schedule, fails closed (R10 ends)
 *   3. the craft from the catalog  never what the browser says (S2-R20)
 *   4. hold the time               party book, 10 minutes (a link: no expiry)
 *   5. one Square order            untaxed ad hoc lines, reference_id = party id
 *   6. drift rule (R14), charge    Square's total is what is charged
 *   7. book the time, record it    money taken always means a party recorded (R6)
 *   8. email, owners, analytics
 *
 * The party id comes from the key (R35), so a retry finds the first try's
 * party: never a second charge. Every failure is one of three honest
 * answers: not charged, charged, or unknown. A declined card lets the time
 * go; no answer keeps it with no expiry and tells the owners (R15, S2-R5a).
 *
 * Server only.
 */
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { partyConfig } from '@config/party.config'
import { kitConfig } from '@config/kit.config'
import { kitThemes } from '@config/kit-content'
import { inviteContent } from '@config/invite-content'
import { STUDIO_DIRECTIONS_URL } from '@config/studio-address'
import { createLogger } from '@lib/logger'
import { attemptKey, isAttemptId, squareErrorCodes, type CheckoutErrorCode } from '@lib/checkout-attempt'
import { partyMessages, giftCardShortMessage } from '@lib/checkout-messages'
import { chargeOrder, judgeDrift, paidOnOrder, tellOwnersOfDrift, HOLD_MINUTES } from '@lib/booking-core/charge'
import { idFor } from '@lib/booking-core/ids'
import { alertOwners } from '@lib/owner-alert'
import { announceBooking } from '@lib/booking-alert'
import { reportBooking } from '@lib/posthog-server'
import { cleanAttribution } from '@lib/attribution'
import { sendPartyConfirmationEmail } from '@lib/email'
import { issueEmailFixTicket, onFileToAskAbout } from '@lib/email-fix'
import { partyInviteUrl, googleCalendarUrl, buildIcs } from '@lib/party-share'
import { formatSlotLabel, formatCalendarDate } from '@lib/studio-time'
import { lookupHouseholdEntry } from '@lib/waiver-store'
import { withUtm } from '@lib/utm'
import { partyRefundLine } from '@lib/refund-lines'
import { findPartyCraft, type CatalogCraft } from '@lib/craft-catalog'
import { getStudioDays } from '@lib/studio-settings'
import { tierFor, weekKeyFor } from '@lib/kit-dates'
import { claimWeek, confirmWeekClaim, releaseWeekClaim, listKitOrders, kitOrderToLedgerRecord } from '@lib/kit-store'
import type { LedgerRecord } from '@lib/kit-ledger'
import type { By } from '@lib/staff-auth'
import type { Payment, LineItem } from '@providers/interfaces/payment'
import {
  createPartyRecord, getPartyRecord, newHostToken, updatePartyRecord,
  type PartyCharge, type PartyItem, type PartyRecord,
} from '@lib/party-store'
import { getPartySettings } from './settings-store'
import { bookableOn, localDate } from './party-times'
import { checkStart, PARTY_TIMES_UNREADABLE } from './open-times'
import { confirmTime, extendHold, holdTime, holdsBetween, releaseTime } from './party-book'
import { quoteParty, orderLineItems, type Audience, type PartyQuote } from './pricing'
import { recordPartyPayment } from './party-payments'
import { deleteCheckout, getCheckout, saveCheckout, type PartyCheckout } from './party-checkouts'
import { partyWritesRefusal } from './test-site'
import type { PartySettings } from './types'

const logger = createLogger('parties:checkout')
const MINUTE = 60_000
const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`

export type PartyPay =
  | { kind: 'card'; paymentToken: string; sourceKind?: 'card' | 'gift_card' }
  | { kind: 'link' }
  /** Payment bypass (local dev, namespaced previews). A mock gift-card token is still checked. */
  | { kind: 'simulated'; paymentToken?: string }

export interface BookInput {
  /** attempt id (public, admin card) or create key (admin link) → partyId = idFor('pty', key) (R35) */
  key: string
  startIso: string
  packageId?: string
  guests: number
  addOns?: Record<string, number>
  craftId: string
  host: { firstName: string; lastName: string; email: string; phone: string }
  pay: PartyPay
  audience: Audience
  linkPackageId?: string
  by: By | null
  /** Themed table (kits flag; off): priced on the server from config. */
  theme?: { themeId: string; serves: number }
  attribution?: unknown
  posthogId?: unknown
  origin: string
  requestUrl: string
}

export type BookOutcome =
  | { kind: 'booked'; rec: PartyRecord; charge: PartyCharge | null; replay: boolean; emailSent: boolean; emailCheck?: unknown; customerId?: string | null }
  | { kind: 'refused'; status: 400 | 402 | 404 | 409 | 503; code: CheckoutErrorCode; message: string; field?: string; extra?: Record<string, unknown> }
  | { kind: 'in_progress' }
  | { kind: 'unknown'; partyId: string }

/** The customer's words for a still-running attempt. */
export const IN_PROGRESS_MESSAGE = 'We’re still finishing your last try. Give it a minute, then check your email before trying again.'
/** Square's total far above our quote: nothing charged. */
export const PRICE_MISMATCH_MESSAGE = 'Pricing mismatch — your card was not charged and the date was released. Please try again or text us.'
// DRAFT copy (new, for Kaden): a craft that left the catalog; a retried key whose party was cancelled.
export const CRAFT_GONE_MESSAGE = 'That craft isn’t available any more. Nothing was charged. Pick another craft.'
export const PARTY_CANCELLED_MESSAGE = 'That party was cancelled. Nothing was charged. Start a new booking, or text us.'

// DRAFT copy (new, for Kaden): a retry whose choices changed since an earlier, unpaid try.
export const CHOICES_CHANGED_MESSAGE = 'Something changed. Nothing was charged. Please try again.'

/** The Square order lines for a quote (and themed table). */
function orderLines(q: PartyQuote, theme: ResolvedTheme | undefined): LineItem[] {
  return [
    ...orderLineItems(q.items, q.pkg.name, q.pkg.id),
    ...(theme ? [{ catalogObjectId: theme.variationId, name: `Themed Table — ${theme.displayName}`, quantity: 1, pricePerUnit: theme.priceCents }] : []),
  ]
}

/** Is a retry asking for exactly what an earlier try's checkout holds? (The customer id may differ.) */
function sameChoices(prior: PartyCheckout, now: { startMs: number; lines: LineItem[]; craftId: string; guests: number; themeId?: string }): boolean {
  return Date.parse(prior.startIso) === now.startMs
    && JSON.stringify(prior.order?.lineItems ?? null) === JSON.stringify(now.lines)
    && prior.draft?.craftId === now.craftId
    && prior.draft?.guestCount === now.guests
    && (prior.draft?.theme?.themeId ?? undefined) === now.themeId
}

export function partyIdFor(key: string): string {
  return idFor('pty', key)
}

const refuse = (
  status: 400 | 402 | 404 | 409 | 503, code: CheckoutErrorCode, message: string, field?: string, extra?: Record<string, unknown>,
): BookOutcome => ({ kind: 'refused', status, code, message, ...(field ? { field } : {}), ...(extra ? { extra } : {}) })

const endOf = (startIso: string, minutes: number) => new Date(Date.parse(startIso) + minutes * MINUTE).toISOString()
const whoOf = (h: BookInput['host']) => `${h.firstName} ${h.lastName} (${h.email}, ${h.phone})`

/** Themed table resolved against server config: prices and variation ids never come from the browser. */
interface ResolvedTheme {
  themeId: string; displayName: string; ledgerThemeId: string; serves: number; priceCents: number; variationId: string; claimRef: string; weekKey: string
}

function resolveTheme(input: BookInput, partyId: string): { ok: true; theme?: ResolvedTheme } | { ok: false; out: BookOutcome } {
  if (!input.theme) return { ok: true }
  if (!siteConfig.features.kits.enabled || !kitConfig.square.packageItemId) {
    return { ok: false, out: refuse(400, 'invalid', 'Themed tables aren’t available right now') }
  }
  const t = kitThemes.find((k) => k.id === input.theme!.themeId && k.stocked)
  if (!t) return { ok: false, out: refuse(400, 'invalid', 'That themed table isn’t available') }
  const serves = Math.floor(input.theme.serves ?? 0)
  if (tierFor(input.guests) !== serves) return { ok: false, out: refuse(400, 'invalid', 'The themed-table size doesn’t match your guest count') }
  const tier = kitConfig.tiers.find((tt) => tt.serves === serves)
  const variationId = kitConfig.square.packageVariations[t.id]?.[serves]
  if (!tier || !variationId) return { ok: false, out: refuse(400, 'invalid', 'That themed table isn’t available') }
  return {
    ok: true,
    theme: {
      themeId: t.id, displayName: t.displayName, ledgerThemeId: t.ledgerThemeId ?? t.id, serves,
      priceCents: tier.packagePriceCents, variationId,
      // From the party id, so a retry claims (and releases) the same table.
      claimRef: `party-${partyId.slice(4, 12)}`,
      weekKey: weekKeyFor(localDate(input.startIso)),
    },
  }
}

function studioToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: kitConfig.timezone })
}

/** Today's words for a guest count out of range (kept), else the quote's own sentence. */
function quoteRefusal(s: PartySettings, input: BookInput, error: string, field?: string): BookOutcome {
  if (field === 'guests') {
    const pkg = s.packages.find((p) => p.id === input.packageId) ?? s.packages.find((p) => p.who === 'everyone' && !p.archived)
    if (pkg && Number.isInteger(input.guests)) {
      if (input.guests < pkg.minGuests) return refuse(400, 'invalid', `Parties are for groups of ${pkg.minGuests} or more`, field)
      if (input.guests > pkg.maxGuests) return refuse(400, 'invalid', `Bookings are limited to ${pkg.maxGuests} guests`, field)
    }
  }
  return refuse(400, 'invalid', error, field)
}

function notOpenRefusal(s: PartySettings, offered: string): BookOutcome {
  const detail =
    offered === 'too_soon'
      ? `Parties need ${s.times.minLeadDays} days’ notice, so that date is too soon to book. Nothing was charged. Pick a later date.`
      : offered === 'closed'
        ? 'The studio is closed on that date, so it can’t be booked. Nothing was charged. Pick another date.'
        : partyMessages.not_open
  return refuse(409, 'not_open', detail)
}

/** Null when the gift card can pay; otherwise the refusal. Nothing is held yet. */
export async function giftCardRefusal(token: string, totalCents: number): Promise<BookOutcome | null> {
  let card: Awaited<ReturnType<typeof providers.giftcard.fromNonce>>
  try {
    card = await providers.giftcard.fromNonce(token)
  } catch (err) {
    logger.error('Gift card lookup failed', { error: String(err) })
    return refuse(503, 'unavailable', partyMessages.unavailable)
  }
  if (!card) return refuse(400, 'invalid', 'That doesn’t look like a gift card. Use a card instead.')
  if (card.state !== 'ACTIVE') return refuse(400, 'invalid', 'That gift card can’t be used right now. Use a card instead.')
  if (card.balanceCents < totalCents) {
    return refuse(402, 'gift_card_short', giftCardShortMessage(card.balanceCents, totalCents), undefined, { balanceCents: card.balanceCents, totalCents })
  }
  return null
}

/** The party record as it is saved once paid (items still due). */
function draftRecord(input: BookInput, partyId: string, q: PartyQuote, craft: CatalogCraft, theme: ResolvedTheme | undefined, now: Date): PartyRecord {
  const at = now.toISOString()
  const items: PartyItem[] = q.items.map((it, i) => ({ ...it, id: idFor('itm', `${partyId}:${i}`), chargeId: null, addedAt: at, by: input.by }))
  const attribution = cleanAttribution(input.attribution)
  return {
    bookingId: partyId,
    hostToken: newHostToken(),
    craftName: craft.name,
    startIso: new Date(input.startIso).toISOString(),
    durationMinutes: q.minutes,
    hostName: [input.host.firstName, input.host.lastName].filter(Boolean).join(' '),
    hostEmail: input.host.email,
    hostPhone: input.host.phone,
    guestCount: input.guests,
    title: null,
    dropOff: false, // parties are never drop-off
    ...(theme ? { theme: { themeId: theme.themeId, displayName: theme.displayName, serves: theme.serves, claimRef: theme.claimRef } } : {}),
    ...(input.pay.kind === 'simulated' ? { simulated: true as const } : {}),
    ...(attribution ? { attribution } : {}),
    createdAt: at,
    source: 'ours',
    status: 'booked',
    endIso: endOf(input.startIso, q.minutes),
    packageId: q.pkg.id,
    craftId: craft.id,
    items,
    charges: [],
    refunds: [],
    payToken: newHostToken(),
    history: [{ at, by: input.by, change: input.pay.kind === 'link' ? 'Booked, to pay by link' : 'Booked' }],
  }
}

/**
 * Paid: book the time and record the party with its charge. Never fails for
 * a paid party (R6): a time lost meanwhile is booked anyway with `overlap`;
 * a party book or record write that fails tells the owners. Returns the
 * record (null when it could not be saved) and whether this call created it
 * (only the creator sends the confirmation).
 */
export async function recordPaidParty(
  c: Pick<PartyCheckout, 'partyId' | 'startIso' | 'endIso' | 'draft' | 'quotedCents' | 'via' | 'host' | 'theme'>,
  pay: { orderId: string; paymentId: string; cents: number; receiptUrl: string | null; simulated?: boolean },
  now: Date = new Date(),
): Promise<{ rec: PartyRecord | null; charge: PartyCharge; created: boolean }> {
  const { partyId } = c
  const draft = c.draft!
  const slot = formatSlotLabel(c.startIso)
  let overlap = false
  try {
    overlap = (await confirmTime(partyId, c.startIso, c.endIso, now)).overlap
  } catch (err) {
    logger.error('PAID PARTY TIME NOT MARKED BOOKED', { partyId, error: String(err) })
    await alertOwners(
      `Party paid, but its time couldn't be marked booked in the party book: ${whoOf(c.host)}, ${slot}, party ${partyId}. The party is recorded; check its time on /admin.`,
    ).catch(() => undefined)
  }
  const chargeId = idFor('chg', pay.paymentId)
  const charge: PartyCharge = {
    id: chargeId, via: c.via, orderId: pay.orderId, paymentId: pay.paymentId, cents: pay.cents, quotedCents: c.quotedCents,
    itemIds: (draft.items ?? []).map((it) => it.id), receiptUrl: pay.receiptUrl, at: now.toISOString(), by: draft.history?.[0]?.by ?? null,
    ...(pay.simulated ? { simulated: true as const } : {}),
  }
  const rec: PartyRecord = {
    ...draft,
    items: (draft.items ?? []).map((it) => ({ ...it, chargeId })),
    charges: [charge],
    ...(overlap ? { overlap: true as const } : {}),
  }
  let saved: { kind: 'created' | 'exists'; rec: PartyRecord } | null = null
  // A save that threw may still have landed: if the retry then finds it, this call made it.
  let threw = false
  for (let i = 0; i < 2 && !saved; i++) {
    try {
      saved = await createPartyRecord(rec)
    } catch (err) {
      threw = true
      logger.error(i === 0 ? 'Party record save failed — retrying once' : 'Party record save failed after retry (party still paid)', { partyId, error: String(err) })
    }
  }
  if (!saved) {
    await alertOwners(
      `Party booked and paid, but its party page could not be set up: ${whoOf(c.host)}, ${slot}, party ${partyId}, order ${pay.orderId}. They were told to text us for the link.`,
    ).catch(() => undefined)
  }
  if (!pay.simulated) {
    let indexed = false
    for (let i = 0; i < 2 && !indexed; i++) {
      try {
        await recordPartyPayment(pay.paymentId, partyId, chargeId)
        indexed = true
      } catch (err) {
        logger.error('Party payment index write failed', { partyId, paymentId: pay.paymentId, error: String(err) })
      }
    }
    if (!indexed) {
      await alertOwners(`Party ${partyId} is paid (payment ${pay.paymentId}), but the payment couldn't be filed under it. A refund made in Square on it won't be matched; refund it from /admin.`).catch(() => undefined)
    }
  }
  if (overlap) {
    await alertOwners(
      `Party paid after its time was taken by another party: ${whoOf(c.host)}, ${slot}, party ${partyId}. Both are booked. Nothing was refunded. Sort out the times on /admin.`,
    ).catch(() => undefined)
  }
  if (c.theme) {
    try {
      const outcome = await confirmWeekClaim({ ledgerThemeId: c.theme.ledgerThemeId, weekKey: c.theme.weekKey, ref: c.theme.claimRef, serves: c.theme.serves, kind: 'party' })
      if (outcome === 'reinstated') logger.warn('Party theme claim reinstated on confirm (pending aged out)', { partyId })
    } catch (err) {
      logger.error('confirmWeekClaim failed (party still paid)', { partyId, error: String(err) })
    }
  }
  // Kept while the record is missing: a retry, the webhook or an owner can still record it from there.
  // The checkout stays until the confirmation has gone out (confirmationDone), so nothing is lost if this call stops here.
  // Worst case of `threw`: a second email in a double-rare race, never none.
  return { rec: saved?.rec ?? null, charge, created: saved?.kind === 'created' || (threw && saved?.kind === 'exists') }
}

/**
 * The creator of a paid party has sent (or tried to send) its confirmation:
 * noted on the record (replays answer with it), and only now is the checkout
 * cleared. Kept when the record couldn't be saved, so it can still be recorded.
 */
export async function confirmationDone(partyId: string, rec: PartyRecord | null, sent: boolean, simulated = false): Promise<void> {
  if (!rec) return
  await updatePartyRecord(partyId, (r) => ({ ...r, confirmation: { at: new Date().toISOString(), sent } }), sent ? 'Confirmation emailed' : 'Confirmation email did not send', null)
    .catch((err) => logger.error('Party confirmation not noted', { partyId, error: String(err) }))
  if (!simulated) await deleteCheckout(partyId).catch((err) => logger.error('Party checkout not cleared', { partyId, error: String(err) }))
}

/** "Participation agreement on file …" for the email, when a valid one exists. Never fails the email. */
async function agreementLineFor(email: string): Promise<string | undefined> {
  try {
    const entry = await lookupHouseholdEntry(email)
    if (!entry || new Date(entry.validUntil).getTime() <= Date.now()) return undefined
    return `Participation agreement on file — signed ${formatCalendarDate(entry.signedAt)}, valid through ${formatCalendarDate(entry.validUntil)}.`
  } catch (err) {
    logger.error('Household lookup failed (confirmation email unaffected)', { error: String(err) })
    return undefined
  }
}

/**
 * The host's confirmation email for a paid party. Craft from the catalog
 * (S2-R20), the booking reference is the party id, the calendar end includes
 * extra time. `rec` null: the party page couldn't be set up, and the email
 * says so instead of linking anywhere.
 */
export async function sendPartyBookedEmail(input: {
  partyId: string; rec: PartyRecord | null; draft: PartyRecord; firstName: string; email: string; origin: string
  chargedCents: number; receiptUrl: string | null; craft?: CatalogCraft | null; themeName?: string; onFile?: string | null; minGuests?: number
}): Promise<boolean> {
  const { partyId, draft, origin } = input
  let craft = input.craft ?? null
  if (!craft && draft.craftId) craft = await findPartyCraft(draft.craftId).catch(() => null)
  const craftName = craft?.name ?? draft.craftName
  const slotLabel = formatSlotLabel(draft.startIso)
  const hostPageUrl = input.rec?.hostToken
    ? withUtm(`${origin}/party/${encodeURIComponent(partyId)}?key=${encodeURIComponent(input.rec.hostToken)}`, { source: 'email', medium: 'email', campaign: 'party_confirmation' })
    : null
  const inviteUrl = partyInviteUrl({ bookingId: partyId, craftName, slotLabel, startIso: draft.startIso }, origin)
  // Token-free on purpose: hosts invite guests from this very calendar event.
  const calEvent = {
    title: `${craftName} — Party at Hometown Studio`,
    startIso: draft.startIso,
    endIso: draft.endIso ?? endOf(draft.startIso, draft.durationMinutes ?? partyConfig.durationMinutes),
    details: `Your private party at Hometown Studio.\n\nInvitation link for guests: ${inviteUrl}`,
    location: inviteContent.where,
  }
  try {
    const { sent } = await sendPartyConfirmationEmail({
      to: input.email,
      hostName: input.firstName,
      craftName,
      craftDescription: String(craft?.description ?? '').slice(0, 2000),
      craftImageUrl: craftImage(craft?.imageUrl, origin),
      ...(craft ? { perHeadCents: craft.perHeadCents, perHeadMaxCents: craft.perHeadMaxCents } : {}),
      slotLabel: input.themeName ? `${slotLabel} — with ${input.themeName}` : slotLabel,
      hostPageUrl,
      inviteUrl,
      totalChargedCents: input.chargedCents,
      receiptUrl: input.receiptUrl,
      googleCalendarUrl: googleCalendarUrl(calEvent),
      icsContent: buildIcs(calEvent),
      bookingRef: partyId,
      bookingId: partyId,
      ...(input.onFile ? { alsoTo: input.onFile } : {}),
      agreementLine: await agreementLineFor(input.email),
      arriveEarlyMinutes: partyConfig.hostArrivalMinutesEarly,
      minGuests: input.minGuests ?? partyConfig.minGuests,
      refundLine: partyRefundLine(draft.startIso, new Date(), input.chargedCents > 0 ? input.chargedCents : undefined),
      directionsUrl: STUDIO_DIRECTIONS_URL,
    })
    return sent
  } catch (err) {
    logger.error('Party confirmation email failed (party still booked)', { partyId, error: String(err) })
    return false
  }
}

/** Absolute http(s) only; a site-relative path resolves against the site. */
function craftImage(raw: string | null | undefined, origin: string): string {
  const s = String(raw ?? '')
  return /^https?:\/\//.test(s) ? s : s.startsWith('/') ? `${origin}${s}` : ''
}

/** Book a party. See the file header. */
export async function bookParty(input: BookInput, now: Date = new Date()): Promise<BookOutcome> {
  const partyId = partyIdFor(input.key)
  // Square's idempotency keys: the attempt id (as /book always did), or the party id for an owner's longer create key.
  const sqKey = isAttemptId(input.key) ? input.key : partyId
  const startMs = Date.parse(input.startIso)
  if (!Number.isFinite(startMs)) return refuse(400, 'invalid', 'Missing party time information')
  const startIso = new Date(startMs).toISOString()
  const card = input.pay.kind === 'card' ? input.pay : null
  const via: PartyCharge['via'] = input.audience === 'admin' ? 'admin-card' : 'online'

  // ── 0. A retry of this key? ────────────────────────────────────────────────
  let existing: PartyRecord | null
  let settings: PartySettings
  try {
    existing = await getPartyRecord(partyId)
  } catch (err) {
    logger.error('Party record unreadable before booking — refusing', { partyId, error: String(err) })
    return refuse(503, 'unavailable', partyMessages.unavailable)
  }
  if (existing?.status === 'cancelled') return refuse(409, 'not_open', PARTY_CANCELLED_MESSAGE)
  if (existing) {
    logger.info('Retried party checkout was already booked — returning the stored result', { partyId })
    return { kind: 'booked', rec: existing, charge: existing.charges?.[0] ?? null, replay: true, emailSent: existing.confirmation?.sent === true }
  }

  // Nothing is written on a test site that shares the live stores (R41).
  const testSite = partyWritesRefusal(new Request(input.requestUrl))
  if (testSite) return refuse(503, 'unavailable', testSite)

  // ── 1. Settings, quote, date ───────────────────────────────────────────────
  let days: Awaited<ReturnType<typeof getStudioDays>>
  try {
    ;[settings, days] = await Promise.all([getPartySettings({ strict: true }), getStudioDays({ strict: true, fresh: true })])
  } catch (err) {
    logger.error('Party settings or studio days unreadable — refusing', { partyId, error: String(err) })
    return refuse(503, 'unavailable', partyMessages.unavailable)
  }
  const priced = quoteParty(settings, { packageId: input.packageId, guests: input.guests, addOns: input.addOns }, input.audience, input.linkPackageId)
  if (!priced.ok) return quoteRefusal(settings, input, priced.error, priced.field)
  const q = priced.value
  if (input.audience !== 'admin') {
    const offered = bookableOn(settings.times, localDate(startIso), now, days)
    if (offered !== 'ok') return notOpenRefusal(settings, offered)
  }
  let endIso = endOf(startIso, q.minutes)
  const resolved = resolveTheme(input, partyId)
  if (!resolved.ok) return resolved.out
  const theme = resolved.theme
  let quotedCents = q.totalCents + (theme?.priceCents ?? 0)

  // Is this party's time already held by an earlier try of this key?
  let mine: Awaited<ReturnType<typeof holdsBetween>>[number] | undefined
  try {
    mine = (await holdsBetween(startIso, new Date(startMs + MINUTE).toISOString(), now))
      .find((h) => h.partyId === partyId && Date.parse(h.startIso) === startMs)
  } catch (err) {
    logger.error('Party book unreadable before booking — refusing', { partyId, error: String(err) })
    return refuse(503, 'unavailable', PARTY_TIMES_UNREADABLE)
  }
  if (mine && input.pay.kind !== 'link') {
    // The first try is still running, or ended with no answer. If Square shows
    // it paid, record it now; otherwise ask them to wait. Never a second charge.
    if (card) {
      const recovered = await recoverPaid(partyId, input, now)
      if (recovered && recovered !== 'unpaid') return recovered
    }
    return { kind: 'in_progress' }
  }

  // An earlier try of this key left its checkout (its hold has gone: it crashed
  // mid-charge, or its answer was lost). Ask Square about that order first, and
  // never replace its order request: the same key with a different request is
  // refused by Square, and that try could never be checked again.
  let reuse: PartyCheckout | null = null
  if (card) {
    let prior: PartyCheckout | null
    try {
      prior = await getCheckout(partyId)
    } catch (err) {
      logger.error('Party checkout unreadable before booking — refusing', { partyId, error: String(err) })
      return refuse(503, 'unavailable', partyMessages.unavailable)
    }
    // Let go earlier because its choices changed: this attempt id is spent (a new body under
    // its order key would be refused by Square). The page starts a new attempt.
    if (prior?.state === 'retired') return refuse(503, 'unavailable', CHOICES_CHANGED_MESSAGE)
    if (prior) {
      const recovered = await recoverPaid(partyId, input, now, prior)
      if (recovered && recovered !== 'unpaid') return recovered
      // Square couldn't be asked: never guess, wait (a person sees it in To decide).
      if (recovered !== 'unpaid') return { kind: 'in_progress' }
      if (!prior.order || !prior.draft || !sameChoices(prior, { startMs, lines: orderLines(q, theme), craftId: input.craftId, guests: input.guests, themeId: theme?.themeId })) {
        // Unpaid in Square, and the customer changed their choices (time, package, extras,
        // craft, guests, table): that order is never charged. Let it go; they start again.
        // Still live (its own request may be charging right now), or its outcome already
        // unclear: never let it go from here; wait (To decide has it).
        if (prior.state === 'unclear') return { kind: 'in_progress' }
        try {
          const priorMs = Date.parse(prior.startIso)
          const live = (await holdsBetween(prior.startIso, new Date(priorMs + MINUTE).toISOString(), now))
            .some((h) => h.partyId === partyId && Date.parse(h.startIso) === priorMs)
          if (live) return { kind: 'in_progress' }
        } catch (err) {
          logger.error('Party book unreadable before letting an earlier try go — refusing', { partyId, error: String(err) })
          return refuse(503, 'unavailable', PARTY_TIMES_UNREADABLE)
        }
        logger.warn('Retried party checkout changed its choices — earlier unpaid try let go', { partyId })
        try {
          await releaseTime(partyId, prior.startIso)
          await saveCheckout({ ...prior, state: 'retired', updatedAt: new Date().toISOString() })
        } catch (err) {
          logger.error('Earlier party try not let go — refusing', { partyId, error: String(err) })
          return refuse(503, 'unavailable', partyMessages.unavailable)
        }
        return refuse(503, 'unavailable', CHOICES_CHANGED_MESSAGE)
      }
      // Unpaid in Square, same choices: carry on with that very order request (same key → the same order).
      reuse = prior
      endIso = prior.endIso
      quotedCents = prior.quotedCents
    }
  }
  const minutes = reuse ? Math.round((Date.parse(reuse.endIso) - startMs) / MINUTE) : q.minutes

  // ── 2. The time is free (fails closed) ─────────────────────────────────────
  let open: Awaited<ReturnType<typeof checkStart>>
  try {
    open = await checkStart(startIso, minutes, { admin: input.audience === 'admin', ignorePartyId: partyId }, now)
  } catch (err) {
    logger.error('Party times unreadable before booking — refusing', { partyId, error: String(err) })
    return refuse(503, 'unavailable', PARTY_TIMES_UNREADABLE)
  }
  if (!open.ok) {
    // Taken. If an earlier try of this key was charged and its hold ran out (R6), it stands.
    if (card) {
      const recovered = await recoverPaid(partyId, input, now)
      if (recovered && recovered !== 'unpaid') return recovered
    }
    return refuse(409, 'slot_taken', input.audience === 'admin' ? open.message : partyMessages.slot_taken)
  }

  // ── 3. The craft, from the catalog ─────────────────────────────────────────
  let craft: CatalogCraft | null
  try {
    craft = await findPartyCraft(input.craftId)
  } catch (err) {
    logger.error('Craft catalog unreadable before booking — refusing', { partyId, error: String(err) })
    return refuse(503, 'unavailable', partyMessages.unavailable)
  }
  if (!craft) return refuse(404, 'invalid', CRAFT_GONE_MESSAGE, 'craftId')

  // A gift card must cover the whole charge: checked before anything is held.
  if (card?.sourceKind === 'gift_card') {
    const refusal = await giftCardRefusal(card.paymentToken, quotedCents)
    if (refusal) return refusal
  }
  if (input.pay.kind === 'simulated' && input.audience !== 'admin') {
    // Simulated payments: only a mock gift-card token is checked, so the short path can be tried on previews.
    const token = input.pay.paymentToken
    if (typeof token === 'string' && token.startsWith('mock-gift')) {
      const refusal = await giftCardRefusal(token, quotedCents)
      if (refusal) return refusal
    }
  }

  // The customer (not fatal: the order can go without one).
  let customerId: string | null = null
  let onFile: string | null = null
  let matchedBy = 'unknown'
  if (card) {
    try {
      const found = await providers.customer.findOrCreate({
        email: input.host.email, givenName: input.host.firstName, familyName: input.host.lastName, phone: input.host.phone,
      })
      customerId = found.id
      onFile = onFileToAskAbout(input.host.email, found as { email?: string; matchedBy?: string })
      matchedBy = (found as { matchedBy?: string }).matchedBy ?? 'unknown'
    } catch (err) {
      logger.error('Customer lookup failed — continuing', { partyId, error: String(err) })
    }
  }

  // ── 4. Hold the time ───────────────────────────────────────────────────────
  try {
    const held = await holdTime(
      { partyId, startIso, endIso, ttlMinutes: input.pay.kind === 'link' ? null : HOLD_MINUTES },
      open.busy, now,
    )
    if (!held.ok) return refuse(409, 'slot_taken', input.audience === 'admin' ? held.message : partyMessages.slot_taken)
    // A replay with no hold of ours seen a moment ago: another request with this key is running right now.
    if (held.replay && input.pay.kind !== 'link') return { kind: 'in_progress' }
  } catch (err) {
    logger.error('Party hold failed — refusing', { partyId, error: String(err) })
    return refuse(503, 'unavailable', partyMessages.unavailable)
  }
  const letGo = async (why: string) => {
    try {
      await releaseTime(partyId, startIso)
    } catch (err) {
      logger.error('PARTY HOLD NOT RELEASED (it runs out by itself)', { partyId, why, error: String(err) })
    }
    await releaseClaim()
  }

  // Themed table: reserved before charging (LR-1), released on any failure.
  let claimed = false
  const releaseClaim = async () => {
    if (!theme || !claimed) return
    claimed = false
    await releaseWeekClaim(theme.ledgerThemeId, theme.weekKey, theme.claimRef).catch((err) => logger.error('releaseWeekClaim failed', { error: String(err) }))
  }
  if (theme) {
    try {
      const overdueOrders: LedgerRecord[] = (await listKitOrders()).map(kitOrderToLedgerRecord).filter((r): r is LedgerRecord => r !== null)
      const outcome = await claimWeek({
        ledgerThemeId: theme.ledgerThemeId, weekKey: theme.weekKey, serves: theme.serves, kind: 'party', ref: theme.claimRef, today: studioToday(), overdueOrders,
      })
      if (outcome === 'full') {
        await letGo('theme full')
        return refuse(409, 'slot_taken', 'That themed table is fully booked that week — pick another date or book without the table.')
      }
      claimed = true
    } catch (err) {
      logger.error('claimWeek failed', { error: String(err) })
      await letGo('theme claim failed')
      return refuse(503, 'unavailable', "We couldn't reserve the themed table. Your card was not charged — please try again.")
    }
  }

  const draft = reuse?.draft ?? draftRecord(input, partyId, q, craft, theme, now)
  const checkoutTheme = theme
    ? { ledgerThemeId: theme.ledgerThemeId, weekKey: theme.weekKey, claimRef: theme.claimRef, serves: theme.serves, displayName: theme.displayName }
    : undefined

  // ── Pay by link: recorded with everything due; the link is sent separately (Task 9). ──
  if (input.pay.kind === 'link') {
    try {
      const saved = await createPartyRecord(draft)
      return { kind: 'booked', rec: saved.rec, charge: null, replay: saved.kind === 'exists', emailSent: false }
    } catch (err) {
      logger.error('Party record (pay by link) not saved — letting the time go', { partyId, error: String(err) })
      await letGo('record failed')
      return refuse(503, 'unavailable', partyMessages.unavailable)
    }
  }

  // ── Simulated payments (local dev and namespaced previews): no Square. ────
  if (input.pay.kind === 'simulated') {
    logger.warn('Payment bypassed (simulated party booking)', { partyId })
    const paid = await recordPaidParty(
      { partyId, startIso, endIso, draft, quotedCents, via, host: input.host, theme: checkoutTheme },
      { orderId: `sim-${partyId}`, paymentId: `sim-${partyId}`, cents: quotedCents, receiptUrl: null, simulated: true },
      now,
    )
    return finish({ partyId, input, draft, rec: paid.rec, created: paid.created, charge: paid.charge, craft, theme, onFile: null, customerId: 'dev-customer', matchedBy, simulated: true, minGuests: q.pkg.minGuests })
  }

  // ── 5. One Square order ────────────────────────────────────────────────────
  const lineItems = orderLines(q, theme)
  const orderRequest = reuse?.order ?? {
    idempotencyKey: attemptKey(sqKey, 'order'),
    locationId: siteConfig.providers.booking.config.locationId,
    customerId,
    lineItems,
    referenceId: partyId,
  }
  const checkout: PartyCheckout = reuse
    ? { ...reuse, state: 'charging', updatedAt: now.toISOString() }
    : {
        partyId, state: 'charging', startIso, endIso, draft, order: orderRequest, orderId: null, quotedCents, squareCents: null,
        host: input.host, origin: input.origin, via, ...(checkoutTheme ? { theme: checkoutTheme } : {}), onFile,
        at: now.toISOString(), updatedAt: now.toISOString(),
      }
  // Kept before anything reaches Square: whatever happens next, the party can be recorded from it.
  try {
    await saveCheckout(checkout)
  } catch (err) {
    logger.error('Party checkout not saved — refusing before any charge', { partyId, error: String(err) })
    await letGo('checkout not saved')
    return refuse(503, 'unavailable', partyMessages.unavailable)
  }
  const forget = () => deleteCheckout(partyId).catch((err) => logger.error('Party checkout not cleared', { partyId, error: String(err) }))

  let order: { id: string; totalAmount: number }
  try {
    order = await providers.payment.createOrder(orderRequest)
  } catch (err) {
    if (squareErrorCodes(err).includes('IDEMPOTENCY_KEY_REUSED')) {
      // An earlier try of this key made a different order. It may be paid.
      return unknownOutcome(checkout, null, err)
    }
    logger.error('Party order failed — releasing the time', { partyId, error: err instanceof Error ? err.message : String(err) })
    await letGo('order failed')
    await forget()
    return refuse(503, 'unavailable', "We couldn't start the payment, so we released the date. Your card was not charged — please try again.")
  }
  checkout.orderId = order.id
  checkout.squareCents = order.totalAmount

  // ── 6. Drift (R14), then charge ────────────────────────────────────────────
  const verdict = judgeDrift(quotedCents, order.totalAmount)
  if (verdict.kind === 'refuse') {
    logger.error('Party order total far above the quote — refusing', { partyId, orderId: order.id, quote: quotedCents, square: order.totalAmount })
    await letGo('price mismatch')
    await forget()
    await alertOwners(
      `Party booking refused, price mismatch: party ${partyId}. Quote ${dollars(quotedCents)}, Square ${dollars(order.totalAmount)}. Check the party's prices in Parties setup. Nothing was charged.`,
    ).catch(() => undefined)
    return refuse(503, 'unavailable', PRICE_MISMATCH_MESSAGE)
  }
  if (verdict.kind === 'charge-and-tell') {
    logger.warn('Party order total differs from the quote — charging Square’s total', { partyId, quote: quotedCents, square: order.totalAmount })
    await tellOwnersOfDrift('Party price differed', `party ${partyId}`, quotedCents, order.totalAmount, '')
  }
  await saveCheckout({ ...checkout, updatedAt: new Date().toISOString() }).catch((err) => logger.error('Party checkout order id not saved', { partyId, error: String(err) }))

  const result = await chargeOrder({ orderId: order.id, amountCents: order.totalAmount, paymentToken: card!.paymentToken, email: input.host.email, attemptId: sqKey })
  if (result.kind === 'declined') {
    logger.error('Party payment refused — releasing the time', { partyId, reason: result.reason, codes: result.codes, paymentId: result.paymentId })
    await letGo('card declined')
    await forget()
    return refuse(402, 'card_declined', partyMessages.card_declined)
  }
  if (result.kind === 'unknown') return unknownOutcome(checkout, order, result.error)
  if (result.recovered) logger.info('Charge answer was unclear but the order is paid — recording', { partyId, orderId: order.id })

  // ── 7. Paid. Nothing below may turn this into a failure. ───────────────────
  claimed = false
  const payment = result.payment
  const paid = await recordPaidParty(
    { partyId, startIso, endIso, draft, quotedCents, via, host: input.host, theme: checkoutTheme },
    { orderId: order.id, paymentId: payment.id, cents: payment.amount || order.totalAmount, receiptUrl: payment.receiptUrl ?? null },
    now,
  )
  return finish({ partyId, input, draft, rec: paid.rec, created: paid.created, charge: paid.charge, craft, theme, onFile, customerId, matchedBy, simulated: false, minGuests: q.pkg.minGuests })

  // ── helpers (closures over this request) ───────────────────────────────────

  /** The charge may have gone through: keep the time with no expiry, tell the owners, say we're not sure. */
  async function unknownOutcome(c: PartyCheckout, o: { id: string; totalAmount: number } | null, err: unknown): Promise<BookOutcome> {
    logger.error('PARTY PAYMENT OUTCOME UNKNOWN — time kept, needs a person', {
      partyId, orderId: o?.id ?? null, codes: squareErrorCodes(err), error: err instanceof Error ? err.message : String(err),
    })
    let kept: { held: boolean; clash?: string } = { held: false }
    try {
      kept = await extendHold(partyId, c.startIso, null, c.endIso)
    } catch (e) {
      logger.error('Could not keep the hold on an unclear party payment', { partyId, error: String(e) })
      kept = { held: false, clash: 'the party book could not be written' }
    }
    claimed = false // the themed table stays with the time
    await saveCheckout({ ...c, state: 'unclear', updatedAt: new Date().toISOString() })
      .catch((e) => logger.error('Unclear party checkout not saved', { partyId, error: String(e) }))
    await alertOwners(
      `Party payment unclear: ${whoOf(c.host)}, ${formatSlotLabel(c.startIso)}. Check Square for a${o ? ` ${dollars(o.totalAmount)}` : ''} payment${o ? ` on order ${o.id}` : ''}. Party ${partyId}. ${kept.held ? 'The time is held for them until you sort it out (not confirmed).' : `The time was NOT kept${kept.clash ? `: ${kept.clash}` : ''}.`} Open /admin › To decide.`,
    ).catch(() => undefined)
    return { kind: 'unknown', partyId }
  }
}

/**
 * R15: did an earlier try of this party pay? Re-creates its order with the
 * same request (Square gives back the same order) and asks whether it is
 * paid. Paid → the party is recorded (overlap if its time was lost) and the
 * booked answer returned. 'unpaid' when Square shows the order unpaid; null
 * when there is nothing to recover from, or Square can't be asked.
 */
async function recoverPaid(partyId: string, input: BookInput, now: Date, known?: PartyCheckout): Promise<BookOutcome | 'unpaid' | null> {
  let c: PartyCheckout | null
  try {
    c = known ?? (await getCheckout(partyId))
  } catch (err) {
    logger.error('Party checkout unreadable on a retry', { partyId, error: String(err) })
    return null
  }
  if (!c?.order || !c.draft) return null
  const req = c.order
  const earlier = await paidOnOrder(async () => {
    const o = await providers.payment.createOrder(req)
    return { orderId: o.id, totalCents: o.totalAmount }
  })
  if (earlier.kind === 'unknown') {
    logger.error('Could not ask Square whether an earlier party try paid', { partyId, error: String(earlier.error) })
    return null
  }
  if (earlier.kind === 'unpaid') return 'unpaid'
  logger.warn('An earlier try of this party was paid — recording it', { partyId, orderId: earlier.order.orderId })
  const pay = earlier.payment
  const paid = await recordPaidParty(c, {
    orderId: earlier.order.orderId, paymentId: pay.id, cents: pay.amount || earlier.order.totalCents, receiptUrl: pay.receiptUrl ?? null,
  }, now)
  const craft = await findPartyCraft(c.draft.craftId ?? '').catch(() => null)
  const emailSent = paid.created
    ? await sendPartyBookedEmail({
        partyId, rec: paid.rec, draft: c.draft, firstName: c.host.firstName, email: c.host.email, origin: c.origin,
        chargedCents: paid.charge.cents, receiptUrl: paid.charge.receiptUrl, craft, onFile: c.onFile ?? null, themeName: c.theme?.displayName,
      })
    : paid.rec?.confirmation?.sent === true
  if (paid.created) await confirmationDone(partyId, paid.rec, emailSent)
  if (paid.created) {
    await reportRecoveredBooking(c, paid.charge.cents)
    await announceBooking({
      kind: 'party', who: `${c.host.firstName} ${c.host.lastName}`, what: `${c.draft.craftName} party, about ${c.draft.guestCount} guests`,
      when: formatSlotLabel(c.startIso), paidCents: paid.charge.cents, email: c.host.email, ...(c.host.phone ? { phone: c.host.phone } : {}),
    })
  }
  return { kind: 'booked', rec: paid.rec ?? { ...c.draft, charges: [paid.charge] }, charge: paid.charge, replay: false, emailSent }
}

/**
 * Analytics for a party recorded after the fact (a retry or Square's payment
 * event found it paid). Called only by whoever created the record, so once.
 */
export async function reportRecoveredBooking(c: Pick<PartyCheckout, 'partyId' | 'draft' | 'host' | 'origin' | 'via'>, cents: number): Promise<void> {
  if (!c.draft || c.via === 'admin-card') return
  await reportBooking({
    requestUrl: `${c.origin}/api/party/book.json`,
    kind: 'party',
    bookingId: c.partyId,
    amountCents: cents,
    email: c.host.email,
    firstName: c.host.firstName,
    lastName: c.host.lastName,
    items: [{ item_id: c.draft.craftId ?? '', item_name: c.draft.craftName, item_category: 'party_craft', price: 0, quantity: c.draft.guestCount }],
    attribution: c.draft.attribution ?? null,
    extra: { guests: c.draft.guestCount, craft: c.draft.craftName, party_date: c.draft.startIso.slice(0, 10), recovered: true, package: c.draft.packageId ?? '' },
  }).catch(() => undefined)
}

/** Paid (or simulated): email, owners' text, analytics, the email-fix ticket. Never fails the booking. */
async function finish(f: {
  partyId: string; input: BookInput; draft: PartyRecord; rec: PartyRecord | null; created: boolean; charge: PartyCharge; craft: CatalogCraft
  theme?: ResolvedTheme; onFile: string | null; customerId: string | null; matchedBy: string; simulated: boolean; minGuests: number
}): Promise<BookOutcome> {
  const { partyId, input, draft, charge, craft } = f
  // Someone else (a concurrent retry, Square's payment event) recorded it first and told everyone: the stored answer.
  if (f.rec && !f.created) return { kind: 'booked', rec: f.rec, charge: f.rec.charges?.[0] ?? charge, replay: true, emailSent: f.rec.confirmation?.sent === true, customerId: f.customerId }
  const emailSent = await sendPartyBookedEmail({
    partyId, rec: f.rec, draft, firstName: input.host.firstName, email: input.host.email, origin: input.origin,
    chargedCents: charge.cents, receiptUrl: charge.receiptUrl, craft, themeName: f.theme?.displayName, onFile: f.onFile, minGuests: f.minGuests,
  })
  await confirmationDone(partyId, f.rec, emailSent, f.simulated)
  const slotLabel = formatSlotLabel(draft.startIso)
  if (!f.simulated && input.audience !== 'admin') {
    await announceBooking({
      kind: 'party',
      who: `${input.host.firstName} ${input.host.lastName}`,
      what: `${craft.name} party, about ${input.guests} guests`,
      when: slotLabel,
      paidCents: charge.cents,
      email: input.host.email,
      ...(input.host.phone ? { phone: input.host.phone } : {}),
      ...(f.theme ? { extra: `With ${f.theme.displayName}` } : {}),
    })
  }
  if (input.audience !== 'admin') {
    await reportBooking({
      requestUrl: input.requestUrl,
      kind: 'party',
      bookingId: partyId,
      amountCents: charge.cents,
      email: input.host.email,
      firstName: input.host.firstName,
      lastName: input.host.lastName,
      items: [{ item_id: craft.id, item_name: craft.name, item_category: 'party_craft', price: craft.perHeadCents / 100, quantity: input.guests }],
      attribution: cleanAttribution(input.attribution),
      posthogId: input.posthogId,
      simulated: f.simulated,
      extra: {
        guests: input.guests,
        craft: craft.name,
        party_date: draft.startIso.slice(0, 10),
        days_ahead: Math.round((Date.parse(draft.startIso) - Date.now()) / 86_400_000),
        expected_craft_revenue: (craft.perHeadCents * input.guests) / 100,
        paid_with: input.pay.kind === 'card' ? input.pay.sourceKind ?? 'card' : 'simulated',
        package: draft.packageId ?? '',
        ...(f.theme ? { themed_table: f.theme.displayName } : {}),
      },
    })
  }
  const emailCheck = {
    token: issueEmailFixTicket({ kind: 'party', bookingId: partyId, customerId: f.customerId ?? '', typed: input.host.email, onFile: f.onFile, matchedBy: f.matchedBy as any }),
    sentTo: input.host.email,
    onFile: f.onFile,
  }
  return {
    kind: 'booked',
    rec: f.rec ?? { ...draft, hostToken: '', charges: [charge] },
    charge,
    replay: false,
    emailSent,
    emailCheck,
    customerId: f.customerId,
  }
}
