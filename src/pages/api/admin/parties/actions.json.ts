import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { isAttemptId } from '@lib/checkout-attempt'
import { recordAudit } from '@lib/audit'
import {
  addPartyExtra, adminPartyView, cancelParty, editPartyDetails, json, LEGACY_PARTY, moveParty, partyReply,
  PartyActionError, paymentGoingThrough, paymentWaitMessage, removePartyExtra, sendPartyDetails, sendPartyLink,
} from '@lib/parties/admin-actions'
import { freePartyTime, holdPartyAgain } from '@lib/parties/hold-actions'
import { ownerTakeCardMessage, ownerTakeCardUnknown } from '@lib/parties/owner-messages'
import { payBalance } from '@lib/parties/pay-balance'
import { partyWhenLabel } from '@lib/parties/payment-link'
import { partyLabel } from '@lib/parties/refunds'
import { whatIsDue } from '@lib/parties/payment-link'
import { formatMoney } from '@lib/money'
import { getPartyRecord, isOurs } from '@lib/party-store'

export const prerender = false

/**
 * POST `{ id, action, … }`, owners only. The rules are in
 * src/lib/parties/admin-actions.ts.
 *
 *   move          { startIso, fromIso? }               → { party, hostToTell, from, to, sendDetails }
 *                 (already on that time = the same answer, `replay`: safe to tap twice)
 *   cancel        { note? }                            → { party, hostToTell, message } (nothing refunded)
 *   add-extra     { addOnId, count, forGuests?, createKey } → { party, item }
 *   remove-extra  { itemId }                           → { party, item }
 *   send-link     {}                                   → { party, url, email, text }
 *   edit-details  { hostName?, hostPhone?, hostEmail?, guests?, craftId? } → { party, sendDetails? }
 *   send-details  { createKey }                        → { party, sent } (owner-tapped "Email Stefanie the
 *                 new details": the confirmation again with the current time and a new calendar
 *                 file; one email per createKey; never automatic, S2-R7)
 *   hold-again    {}                                   → { party, message } ("Hold this time again": the
 *                 party's current time back in the party book, checked; never a move; nothing sent)
 *   free-time     { startIso }                         → { party, message } ("Free this time" on a cancelled
 *                 party, "Free the old time" on a booked one; never the time a booked party is on)
 *   take-card     { attemptId, paymentToken, expectedCents } → { party, paidCents, receiptUrl }
 *                 (what is due, by card in /admin: the same one-payment-at-a-time
 *                 claim as the payment link, so the two never both charge)
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json(400, { error: 'Nothing to do.' })
  const by = adminActor(request)
  switch (body.action) {
    case 'move': return partyReply(() => moveParty(body, by, request))
    case 'cancel': return partyReply(() => cancelParty(body, by, request))
    case 'add-extra': return partyReply(() => addPartyExtra(body, by, request))
    case 'remove-extra': return partyReply(() => removePartyExtra(body, by, request))
    case 'send-link': return partyReply(() => sendPartyLink(body, by, request))
    case 'edit-details': return partyReply(() => editPartyDetails(body, by, request))
    case 'send-details': return partyReply(() => sendPartyDetails(body, by, request))
    case 'take-card': return partyReply(() => takeCard(body, by, request))
    case 'hold-again': return partyReply(() => holdPartyAgain(body, by, request))
    case 'free-time': return partyReply(() => freePartyTime(body, by, request))
    default: return json(400, { error: 'Pick what to do.' })
  }
}

async function takeCard(body: any, by: ReturnType<typeof adminActor>, request: Request) {
  if (!isAttemptId(body.attemptId)) throw new PartyActionError(400, 'Reload the page and try again.')
  const expectedCents = body.expectedCents
  if (typeof expectedCents !== 'number' || !Number.isInteger(expectedCents) || expectedCents <= 0) throw new PartyActionError(400, 'Nothing to charge.')
  const id = typeof body.id === 'string' ? body.id : ''
  const before = id ? await getPartyRecord(id) : null
  if (before && !isOurs(before)) throw new PartyActionError(409, LEGACY_PARTY)
  const simulated = paymentBypassEnabled(request)
  if (!simulated && (typeof body.paymentToken !== 'string' || !body.paymentToken || body.paymentToken.length > 4000)) {
    throw new PartyActionError(400, 'Enter the card first.')
  }
  const out = await payBalance({
    partyId: id, key: '', attemptId: body.attemptId, expectedCents, owner: by, requestUrl: request.url,
    // Cards only (S2-R3).
    pay: simulated ? { kind: 'simulated' } : { kind: 'card', paymentToken: body.paymentToken, sourceKind: 'card' },
  })
  const hostFirst = before?.hostName ?? ''
  if (out.kind === 'refused') {
    // What is actually holding it up, from the party itself (charging now, or Square never answered).
    let busy: string | null = null
    if (out.code === 'in_progress') {
      const cur = await getPartyRecord(id).catch(() => null)
      if (cur && paymentGoingThrough(cur, new Date())) busy = paymentWaitMessage(cur, new Date())
    }
    throw new PartyActionError(out.status, ownerTakeCardMessage(out.code, out.message, busy), { code: out.code, ...out.extra })
  }
  if (out.kind === 'unknown') {
    const cur = await getPartyRecord(id).catch(() => null)
    const until = cur?.paying?.until ? partyWhenLabel(cur.paying.until) : null
    throw new PartyActionError(502, ownerTakeCardUnknown(cur?.hostName ?? hostFirst, expectedCents, until), { code: 'unknown_outcome' })
  }
  if (!out.already && !out.replay && out.charge) {
    await recordAudit({
      by: { ...by, role: 'owner' }, action: 'party-card', target: { kind: 'party', id: out.rec.bookingId, label: partyLabel(out.rec) },
      details: { cents: out.charge.cents, chargeId: out.charge.id },
    })
  }
  const first = out.rec.hostName.split(' ')[0] || 'the host'
  const paidFor = whatIsDue(out.rec, (out.rec.items ?? []).filter((it) => out.charge?.itemIds.includes(it.id)))
  // Said only when this call sent it (or tried): never claimed on a replay or when it failed.
  const emailed = out.emailed
  const emailLine = !emailed
    ? ''
    : emailed.sent
      ? ` ${first} got ${emailed.kind === 'confirmation' ? 'the booking confirmation' : 'a receipt'} by email.`
      : ` The email to ${first} didn’t go out. Check the email address on the party${emailed.kind === 'confirmation' ? `, then use Email ${first} the details` : ''}.`
  const message = out.already
    ? 'Nothing is due on this party. It was already paid.'
    : out.replay
      ? `That card was already charged ${formatMoney(out.charge?.cents ?? 0)} for ${paidFor}. Nothing more was charged.`
      : `Charged ${formatMoney(out.charge?.cents ?? 0)} for ${paidFor}.${emailLine} Crafts are paid at the studio after the party.`
  return {
    message,
    party: adminPartyView(out.rec), paidCents: out.already ? 0 : out.charge?.cents ?? 0, receiptUrl: out.charge?.receiptUrl ?? null,
    ...(out.already ? { alreadyPaid: true } : {}), ...(out.replay ? { replay: true } : {}),
  }
}
