/**
 * What the customer's quote page sees (view.json) and the package pick
 * (pick.json). Spec §3 (Public) and the status × action guard table.
 *
 * Never sends costs, history, owner names, the target, the version or any
 * other key. Draft, withdrawn, expired and unknown links all get the same
 * `{ state: 'closed' }`, so a link can't tell which. A paid quote's receipt
 * is read live from the party record (a later payment or cancel shows).
 *
 * Server only.
 */
import { createLogger } from '@lib/logger'
import { getRequest } from '@lib/event-requests'
import { getPartyRecord } from '@lib/party-store'
import { dueCents, paidCents } from '@lib/parties/money'
import { payLinkUrl } from '@lib/parties/payment-link'
import { normalPerPerson, offPct, totalCents, depositCents } from './money'
import { getQuoteByToken, updateQuote, withQuoteLock } from './quote-store'
import { isExpired, type Per, type Quote, type TierKey } from './types'

const logger = createLogger('quotes:public-view')

export interface PublicLine { label: string; photoUrl: string | null; per: Per; cents: number }

export interface PublicTier {
  id: string
  key: TierKey
  name: string
  photoUrl: string | null
  lines: PublicLine[]
  normalPerPersonCents: number
  priceCents: number
  totalCents: number
  depositCents: number
  offPct: number
}

export interface PublicEvent {
  startIso: string | null
  endIso: string | null
  guests: number
  place: 'studio' | 'away'
  /** Only when the event is away from the studio. */
  address?: string
}

export type PublicView =
  | {
      state: 'open'
      firstName: string
      event: PublicEvent
      note: string
      expiresAt: string
      /** Only when the quote changed after it was sent ("Updated <date>"). */
      updatedAt?: string
      depositPct: number
      tiers: PublicTier[]
      /** The customer's last pick, when it is still a visible package. */
      pickedTierId?: string
    }
  | { state: 'paying' }
  | { state: 'paid'; date: string; tierName: string; paidCents: number; dueCents: number; payUrl?: string; hostUrl: string }
  | { state: 'cancelled' }
  | { state: 'closed' }

const CLOSED: PublicView = { state: 'closed' }

/** The guard table's "view" column. */
function viewState(q: Quote, now: Date): 'open' | 'paying' | 'paid' | 'closed' {
  if (q.status === 'sent' || q.status === 'picked') return isExpired(q, now) ? 'closed' : 'open'
  if (q.status === 'paying') return 'paying'
  if (q.status === 'paid') return 'paid'
  return 'closed'
}

/** Pick is allowed from sent or picked, before expiry. */
const canPick = (q: Quote, now: Date) => (q.status === 'sent' || q.status === 'picked') && !isExpired(q, now)

async function firstNameOf(requestId: string): Promise<string> {
  try {
    const r = await getRequest(requestId)
    return r?.about.name.trim().split(/\s+/)[0] ?? ''
  } catch {
    return ''
  }
}

function openView(q: Quote, firstName: string): PublicView {
  const tiers: PublicTier[] = q.tiers
    .filter((t) => !t.hidden)
    .map((t) => {
      const total = totalCents(t.priceCents, q.guests)
      return {
        id: t.id,
        key: t.key,
        name: t.name,
        photoUrl: t.photoUrl,
        lines: t.lines.map((l) => ({ label: l.label, photoUrl: l.photoUrl, per: l.per, cents: l.cents })),
        normalPerPersonCents: normalPerPerson(t, q.guests),
        priceCents: t.priceCents,
        totalCents: total,
        depositCents: depositCents(total, q.depositPct),
        offPct: offPct(t, q.guests),
      }
    })
  const event: PublicEvent = { startIso: q.startIso, endIso: q.endIso, guests: q.guests, place: q.place }
  if (q.place === 'away') event.address = q.address
  const view: PublicView = { state: 'open', firstName, event, note: q.note, expiresAt: q.expiresAt, depositPct: q.depositPct, tiers }
  if (q.updatedAt && q.sentAt && Date.parse(q.updatedAt) > Date.parse(q.sentAt)) view.updatedAt = q.updatedAt
  if (q.pickedTierId && tiers.some((t) => t.id === q.pickedTierId)) view.pickedTierId = q.pickedTierId
  return view
}

async function paidView(q: Quote, origin: string): Promise<PublicView> {
  const rec = await getPartyRecord(q.partyId)
  if (!rec) {
    // Paid but the party isn't readable (yet): the page's "checking" state, never "no longer available".
    logger.warn('Paid quote has no party record', { quoteId: q.id, partyId: q.partyId })
    return { state: 'paying' }
  }
  if (rec.status === 'cancelled') return { state: 'cancelled' }
  const base = origin.replace(/\/$/, '')
  const due = dueCents(rec)
  const view: PublicView = {
    state: 'paid',
    date: rec.startIso,
    tierName: q.tiers.find((t) => t.id === q.pickedTierId)?.name ?? rec.craftName,
    paidCents: paidCents(rec),
    dueCents: due,
    hostUrl: `${base}/party/${encodeURIComponent(rec.bookingId)}?key=${encodeURIComponent(rec.hostToken)}`,
  }
  if (due > 0 && rec.payToken) view.payUrl = payLinkUrl(base, rec)
  return view
}

/** Counts a view: best effort, no version bump, no lock (a plain compare-and-set). */
async function countView(q: Quote, now: Date): Promise<void> {
  try {
    await updateQuote(q.id, (cur) => ({ ...cur, views: (cur.views ?? 0) + 1, lastViewedAt: now.toISOString() }))
  } catch (err) {
    logger.warn('Quote view not counted', { quoteId: q.id, error: err instanceof Error ? err.message : String(err) })
  }
}

export async function publicView(token: string, opts: { isOwner: boolean; origin: string; now?: Date }): Promise<PublicView> {
  const now = opts.now ?? new Date()
  const q = await getQuoteByToken(token)
  if (!q) return CLOSED
  // Owners can preview a draft before sending it; customers can't see one.
  const state = opts.isOwner && q.status === 'draft' ? 'open' : viewState(q, now)
  if (state === 'closed') return CLOSED
  if (!opts.isOwner) await countView(q, now)
  if (state === 'paying') return { state: 'paying' }
  if (state === 'paid') return paidView(q, opts.origin)
  return openView(q, await firstNameOf(q.requestId))
}

export type PickResult = { ok: true } | { ok: false; why: 'closed' | 'tier_unavailable' }

export async function pickTier(token: string, tierId: string, now: Date = new Date()): Promise<PickResult> {
  const q0 = await getQuoteByToken(token)
  if (!q0) return { ok: false, why: 'closed' }
  return withQuoteLock(q0, async () => {
    let result: PickResult = { ok: true }
    await updateQuote(q0.id, (cur) => {
      if (cur.token !== token || !canPick(cur, now)) {
        result = { ok: false, why: 'closed' }
        return null
      }
      if (!cur.tiers.some((t) => t.id === tierId && !t.hidden)) {
        result = { ok: false, why: 'tier_unavailable' }
        return null
      }
      result = { ok: true }
      if (cur.status === 'picked' && cur.pickedTierId === tierId) return null
      return { ...cur, status: 'picked', pickedTierId: tierId }
    })
    return result
  })
}
