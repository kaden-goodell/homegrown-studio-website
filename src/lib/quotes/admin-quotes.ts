/**
 * The owners' side of a quote (spec §3 Admin, the guard table, §5 Draft,
 * Hold, Other rules):
 *
 *   draftQuote(requestId)       make the request's quote, or return its open one
 *   saveQuote(quote, version)   an owner edit (bumps version and priceKey)
 *   sendQuote(id)               hold the date, text/email the link, status sent
 *   quoteAction(id, action)     resend / withdraw / reopen
 *
 * Every write runs inside withQuoteLock (the party lock of the party the quote
 * becomes) and re-reads the quote there; drafting runs under a per-request
 * lock so two quick taps can't make two quotes. Refusals throw QuoteError
 * with a `why` the routes turn into a status code. Messages go out after the
 * lock is let go. Server only.
 */
import { createLogger } from '@lib/logger'
import { getRequest, setRequestStatus, type EventRequest, type RequestStatus } from '@lib/event-requests'
import { withPartyLock } from '@lib/parties/party-lock'
import { localToUtcISO } from '@lib/parties/party-times'
import { ownerTimeRefusal } from '@lib/parties/open-times'
import { getPartySettings } from '@lib/parties/settings-store'
import { sendQuoText } from '@lib/quo'
import { formatDay } from '@lib/studio-time'
import { draftTiers, fillTier, targetFor } from './draft'
import { meterOf, normalPerPerson, offPct } from './money'
import { getMenu, getSettings } from './menu-store'
import { priceKey } from './price-key'
import {
  createQuote, getQuote, getQuoteForRequest, newQuoteId, newToken, partyIdForQuote, updateQuote, withQuoteLock,
} from './quote-store'
import { applyHold, releaseQuoteHold } from './holds'
import { quoteLinkText, sendQuoteLinkEmail } from './messages'
import { isExpired, type Crafters, type Quote, type QuoteSettings, type Tier } from './types'

const logger = createLogger('quotes:admin')

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

export type QuoteWhy =
  | 'not_found' | 'invalid' | 'booked' | 'stale' | 'paid' | 'over_cap' | 'time_taken' | 'no_tiers' | 'incomplete' | 'closed'
  // Guard-table refusals name the status the action can't run from.
  | 'draft' | 'sent' | 'picked' | 'paying' | 'withdrawn' | 'expired'

export class QuoteError extends Error {
  constructor(
    public why: QuoteWhy,
    public status: number,
    message: string,
    public clash?: { label: string; startIso: string },
  ) {
    super(message)
    this.name = 'QuoteError'
  }
}

const refuse = (why: QuoteWhy, status: number, message: string, clash?: QuoteError['clash']) => new QuoteError(why, status, message, clash)
const notFound = () => refuse('not_found', 404, 'That quote is not there.')

/** The status a guard checks against: sent/picked past expiry read as expired. */
const stateOf = (q: Quote, now: Date): Quote['status'] | 'expired' => (isExpired(q, now) ? 'expired' : q.status)

const guardRefusal = (state: Quote['status'] | 'expired'): QuoteError =>
  state === 'paid' || state === 'paying'
    ? refuse('paid', 409, 'This quote is paid for. It can’t change.')
    : refuse(state, 409, `This quote is ${state}.`)

const firstName = (r: EventRequest) => r.about.name.trim().split(/\s+/)[0] ?? ''

/** Hours from the request's "length" answer ("2 hours", "about 3.5 hrs"); 2 when it says none. */
export function lengthHours(length: string): number {
  const m = /(\d+(?:\.\d+)?)\s*h/i.exec(length)
  const h = m ? Number(m[1]) : 2
  return h > 0 && h <= 24 ? h : 2
}

const visibleTiers = (q: Pick<Quote, 'tiers'>) => q.tiers.filter((t) => !t.hidden)

const overCap = (q: Pick<Quote, 'tiers' | 'guests'>, s: QuoteSettings) =>
  visibleTiers(q).some((t) => meterOf(offPct(t, q.guests), s) === 'red')

/** Request status, never down from booked. */
async function moveRequest(requestId: string, to: RequestStatus, onlyFrom: RequestStatus[] | null, now: Date): Promise<void> {
  const r = await getRequest(requestId)
  if (!r || r.status === 'booked' || r.status === to) return
  if (onlyFrom && !onlyFrom.includes(r.status)) return
  await setRequestStatus(requestId, to, now)
}

const addHistory = (q: Quote, by: string, what: string, now: Date): Quote['history'] => [...q.history, { at: now.toISOString(), by, what }]

// ── Draft ───────────────────────────────────────────────────────────────────

export async function draftQuote(
  requestId: string,
  opts: { by: string; now?: Date; force?: boolean; targetCents?: number },
): Promise<Quote> {
  const now = opts.now ?? new Date()
  return withPartyLock(`quote-req-${requestId}`, async () => {
    const r = await getRequest(requestId)
    if (!r) throw refuse('not_found', 404, 'That request is not there.')
    const existing = await getQuoteForRequest(requestId)
    if (existing && existing.status !== 'withdrawn' && !isExpired(existing, now)) return existing
    if (r.status === 'booked' && !opts.force) throw refuse('booked', 409, 'This request is already booked.')
    if (opts.targetCents !== undefined && !(Number.isInteger(opts.targetCents) && opts.targetCents > 0)) {
      throw refuse('invalid', 400, 'The target price has to be more than $0.')
    }

    const [settings, menu] = await Promise.all([getSettings(), getMenu()])
    const guests = Math.max(1, Math.floor(r.event.guests || 1))
    const crafters: Crafters = r.event.crafters || 'both'
    const month = Number(r.event.date.slice(5, 7)) || 1
    const theme = [r.craft.theme, r.craft.vision].filter(Boolean).join(' ')
    const input = { menu: menu.items, guests, crafters, month, theme }
    // No budget: the normal per person of the best-matching item (what Our pick would start with).
    const target = opts.targetCents
      ?? targetFor(r.budget, guests)
      ?? (() => {
        const [best] = fillTier(Number.MAX_SAFE_INTEGER, { ...input, targetCents: 0 }, { capPct: 0 })
        return best ? Math.round(normalPerPerson({ lines: [best] }, guests) / 100) * 100 : 0
      })()

    const startIso = r.event.date && r.event.startTime ? localToUtcISO(r.event.date, r.event.startTime) : null
    const endIso = startIso ? new Date(Date.parse(startIso) + lengthHours(r.event.length) * HOUR_MS).toISOString() : null
    const id = newQuoteId()
    const base: Omit<Quote, 'priceKey'> = {
      id, requestId, partyId: partyIdForQuote(id), token: newToken(), version: 1,
      status: 'draft',
      place: r.where.place === 'yours' ? 'away' : 'studio',
      address: r.where.address,
      startIso, endIso, guests, crafters,
      targetCents: target,
      note: '',
      depositPct: settings.depositPct,
      expiresAt: new Date(now.getTime() + settings.expiryDays * DAY_MS).toISOString(),
      tiers: target > 0 ? draftTiers({ ...input, targetCents: target }, settings) : [],
      held: false,
      views: 0,
      history: [{ at: now.toISOString(), by: opts.by, what: existing ? `drafted (replaces ${existing.id})` : 'drafted' }],
    }
    return createQuote({ ...base, priceKey: priceKey(base) })
  })
}

// ── Save ────────────────────────────────────────────────────────────────────

const isIso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const isCents = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0

/** The fields an owner may change, checked; anything else on the incoming quote is ignored. */
function ownerFields(q: Quote): Pick<Quote, 'place' | 'address' | 'startIso' | 'endIso' | 'guests' | 'crafters' | 'targetCents' | 'note' | 'depositPct' | 'expiresAt' | 'tiers'> {
  const bad = (m: string) => refuse('invalid', 400, m)
  if (q.place !== 'studio' && q.place !== 'away') throw bad('Pick where the event is.')
  if (!Number.isInteger(q.guests) || q.guests < 1) throw bad('Guests has to be at least 1.')
  if (q.crafters !== 'kids' && q.crafters !== 'adults' && q.crafters !== 'both') throw bad('Pick who is crafting.')
  if (!isCents(q.targetCents)) throw bad('The target price has to be $0 or more.')
  if (!Number.isInteger(q.depositPct) || q.depositPct < 1 || q.depositPct > 100) throw bad('The deposit has to be 1 to 100%.')
  if (!isIso(q.expiresAt)) throw bad('Pick a reply-by date.')
  const startIso = q.startIso === null ? null : isIso(q.startIso) ? new Date(q.startIso).toISOString() : undefined
  const endIso = q.endIso === null ? null : isIso(q.endIso) ? new Date(q.endIso).toISOString() : undefined
  if (startIso === undefined || endIso === undefined) throw bad('Pick a start and end time.')
  if ((startIso === null) !== (endIso === null) || (startIso && endIso && Date.parse(endIso) <= Date.parse(startIso))) {
    throw bad('The event has to end after it starts.')
  }
  if (!Array.isArray(q.tiers)) throw bad('The packages are missing.')
  const ids = new Set<string>()
  for (const t of q.tiers as Tier[]) {
    if (!t || typeof t.id !== 'string' || !t.id || ids.has(t.id)) throw bad('A package is missing its id.')
    ids.add(t.id)
    if (typeof t.name !== 'string' || !t.name.trim()) throw bad('Every package needs a name.')
    if (!isCents(t.priceCents)) throw bad(`${t.name}: the price has to be $0 or more.`)
    if (!Array.isArray(t.lines) || t.lines.some((l) => !l || typeof l.label !== 'string' || !isCents(l.cents) || (l.per !== 'person' && l.per !== 'event'))) {
      throw bad(`${t.name}: a line is missing its name or price.`)
    }
  }
  return {
    place: q.place, address: typeof q.address === 'string' ? q.address.trim() : '',
    startIso, endIso, guests: q.guests, crafters: q.crafters, targetCents: q.targetCents,
    note: typeof q.note === 'string' ? q.note : '', depositPct: q.depositPct,
    expiresAt: new Date(q.expiresAt).toISOString(), tiers: q.tiers,
  }
}

export async function saveQuote(
  quote: Quote,
  version: number,
  opts: { by: string; now?: Date; overCapOk?: boolean },
): Promise<Quote> {
  const now = opts.now ?? new Date()
  const first = await getQuote(quote?.id)
  if (!first) throw notFound()
  const fields = ownerFields(quote)
  return withQuoteLock(first, async () => {
    const cur = await getQuote(first.id)
    if (!cur) throw notFound()
    if (cur.status === 'paid' || cur.status === 'paying' || cur.status === 'withdrawn') throw guardRefusal(cur.status)
    if (cur.version !== version) throw refuse('stale', 409, 'Someone else changed this quote. Reload it and try again.')

    let next: Quote = { ...cur, ...fields }
    // Hiding or removing the picked package clears the pick.
    if (next.pickedTierId && !visibleTiers(next).some((t) => t.id === next.pickedTierId)) {
      next = { ...next, pickedTierId: undefined, status: next.status === 'picked' ? 'sent' : next.status }
    }
    if (Date.parse(next.expiresAt) > Date.parse(cur.expiresAt)) next = { ...next, expiryTold: undefined }

    const open = next.status === 'sent' || next.status === 'picked'
    if (open && !opts.overCapOk && overCap(next, await getSettings())) {
      throw refuse('over_cap', 409, 'A package is past the discount cap.')
    }
    // A held quote's hold follows its changes; one sent without a hold stays without (Resend holds it).
    if (open && cur.held) {
      const h = await applyHold(cur, next, now)
      if (h.clash) throw refuse('time_taken', 409, 'That time is taken.', h.clash)
      next = { ...next, held: h.held }
    }

    next = {
      ...next,
      version: cur.version + 1,
      updatedAt: now.toISOString(),
      history: addHistory(cur, opts.by, 'saved', now),
    }
    next.priceKey = priceKey(next)
    return updateQuote(cur.id, () => next)
  })
}

// ── Send ────────────────────────────────────────────────────────────────────

export interface SendResult { quote: Quote; texted: boolean; emailed: boolean }

/** Text and/or email the customer the link. Failures are logged, never thrown (the quote is already sent). */
async function tellCustomer(q: Quote, want: { text: boolean; email: boolean }, origin: string): Promise<{ texted: boolean; emailed: boolean }> {
  const r = await getRequest(q.requestId)
  if (!r) return { texted: false, emailed: false }
  const url = `${origin.replace(/\/$/, '')}/quote/${q.token}`
  const givenName = firstName(r)
  let texted = false, emailed = false
  if (want.text && r.about.phone) {
    try {
      await sendQuoText({ to: r.about.phone, content: quoteLinkText(givenName, url) })
      texted = true
    } catch (e) {
      logger.error('Quote link text failed', { quoteId: q.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  if (want.email && r.about.email) {
    try {
      emailed = (await sendQuoteLinkEmail({ to: r.about.email, givenName, url, expiresLabel: formatDay(q.expiresAt) })).sent
    } catch (e) {
      logger.error('Quote link email failed', { quoteId: q.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { texted, emailed }
}

export async function sendQuote(
  id: string,
  opts: { text: boolean; email: boolean; overCapOk?: boolean; noHold?: boolean; by: string; origin: string; now?: Date },
): Promise<SendResult> {
  const now = opts.now ?? new Date()
  const first = await getQuote(id)
  if (!first) throw notFound()
  const quote = await withQuoteLock(first, async () => {
    const cur = await getQuote(id)
    if (!cur) throw notFound()
    const state = stateOf(cur, now)
    if (state !== 'draft' && state !== 'sent' && state !== 'picked') throw guardRefusal(state)
    if (!visibleTiers(cur).length) throw refuse('no_tiers', 400, 'Add a package before sending.')
    if (!cur.startIso || !cur.endIso || cur.guests < 1 || (cur.place === 'away' && !cur.address.trim())) {
      throw refuse('incomplete', 400, cur.startIso ? 'Add the address before sending.' : 'Add a start time before sending.')
    }
    if (cur.place === 'studio') {
      const why = ownerTimeRefusal(await getPartySettings(), cur.startIso)
      if (why) throw refuse('closed', 409, why)
    }
    if (!opts.overCapOk && overCap(cur, await getSettings())) throw refuse('over_cap', 409, 'A package is past the discount cap.')

    let next: Quote = {
      ...cur,
      status: cur.status === 'draft' ? 'sent' : cur.status,
      sentAt: cur.sentAt ?? now.toISOString(),
      sentBy: opts.by,
      history: addHistory(cur, opts.by, cur.status === 'draft' ? (opts.noHold ? 'sent without a hold' : 'sent') : 'resent', now),
    }
    if (opts.noHold) {
      if (cur.held) await releaseQuoteHold(cur)
      next = { ...next, held: false }
    } else {
      const h = await applyHold(cur, next, now)
      if (h.clash) throw refuse('time_taken', 409, 'That time is taken.', h.clash)
      next = { ...next, held: h.held }
    }
    return updateQuote(cur.id, () => next)
  })
  await moveRequest(quote.requestId, 'quoted', null, now)
  return { quote, ...(await tellCustomer(quote, opts, opts.origin)) }
}

// ── Resend / withdraw / reopen ──────────────────────────────────────────────

export type QuoteActionName = 'resend' | 'withdraw' | 'reopen'

export async function quoteAction(
  id: string,
  action: QuoteActionName,
  opts: { by: string; origin: string; now?: Date; expiresAt?: string; text?: boolean; email?: boolean },
): Promise<Quote> {
  const now = opts.now ?? new Date()
  const first = await getQuote(id)
  if (!first) throw notFound()

  if (action === 'resend') {
    const quote = await withQuoteLock(first, async () => {
      const cur = await getQuote(id)
      if (!cur) throw notFound()
      const state = stateOf(cur, now)
      if (state !== 'sent' && state !== 'picked') throw guardRefusal(state)
      return updateQuote(cur.id, (q) => ({ ...q, history: addHistory(q, opts.by, 'resent', now) }))
    })
    await tellCustomer(quote, { text: opts.text ?? true, email: opts.email ?? true }, opts.origin)
    return quote
  }

  if (action === 'withdraw') {
    const quote = await withQuoteLock(first, async () => {
      const cur = await getQuote(id)
      if (!cur) throw notFound()
      if (cur.status === 'paid' || cur.status === 'paying' || cur.status === 'withdrawn') throw guardRefusal(cur.status)
      if (cur.held) await releaseQuoteHold(cur)
      return updateQuote(cur.id, (q) => ({ ...q, status: 'withdrawn', held: false, history: addHistory(q, opts.by, 'withdrawn', now) }))
    })
    await moveRequest(quote.requestId, 'new', ['quoted'], now)
    return quote
  }

  if (action === 'reopen') {
    if (opts.expiresAt !== undefined && !(isIso(opts.expiresAt) && Date.parse(opts.expiresAt) > now.getTime())) {
      throw refuse('invalid', 400, 'Pick a reply-by date after today.')
    }
    const quote = await withQuoteLock(first, async () => {
      const cur = await getQuote(id)
      if (!cur) throw notFound()
      const state = stateOf(cur, now)
      if (state !== 'withdrawn' && state !== 'expired') throw guardRefusal(state)
      const settings = await getSettings()
      const expiresAt = opts.expiresAt ? new Date(opts.expiresAt).toISOString() : new Date(now.getTime() + settings.expiryDays * DAY_MS).toISOString()
      // A quote withdrawn before it was ever sent goes back to a draft.
      let next: Quote = {
        ...cur,
        status: cur.sentAt ? 'sent' : 'draft',
        pickedTierId: undefined,
        expiresAt,
        expiryTold: undefined,
        history: addHistory(cur, opts.by, 'reopened', now),
      }
      if (next.status === 'sent') {
        // What was held before has gone (withdrawn) or stopped counting (expired): hold afresh.
        const h = await applyHold({ ...cur, held: cur.held && cur.status !== 'withdrawn' }, next, now)
        if (h.clash) throw refuse('time_taken', 409, 'That time is taken.', h.clash)
        next = { ...next, held: h.held }
      }
      return updateQuote(cur.id, () => next)
    })
    if (quote.status === 'sent') await moveRequest(quote.requestId, 'quoted', null, now)
    return quote
  }

  throw refuse('invalid', 400, 'Unknown action.')
}
