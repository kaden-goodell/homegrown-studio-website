import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { isAttemptId } from '@lib/checkout-attempt'
import { UNKNOWN_OUTCOME_MESSAGE } from '@lib/checkout-messages'
import { recordAudit } from '@lib/audit'
import {
  addPartyExtra, adminPartyView, cancelParty, editPartyDetails, json, LEGACY_PARTY, moveParty, partyReply,
  PartyActionError, removePartyExtra, sendPartyLink,
} from '@lib/parties/admin-actions'
import { payBalance } from '@lib/parties/pay-balance'
import { partyLabel } from '@lib/parties/refunds'
import { getPartyRecord, isOurs } from '@lib/party-store'

export const prerender = false

/**
 * POST `{ id, action, … }`, owners only. The rules are in
 * src/lib/parties/admin-actions.ts.
 *
 *   move          { startIso }                         → { party, hostToTell, from, to }
 *   cancel        { note? }                            → { party, hostToTell, message } (nothing refunded)
 *   add-extra     { addOnId, count, forGuests?, createKey } → { party, item }
 *   remove-extra  { itemId }                           → { party, item }
 *   send-link     {}                                   → { party, url, email, text }
 *   edit-details  { hostName?, hostPhone?, hostEmail?, guests?, craftId? } → { party }
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
    case 'take-card': return partyReply(() => takeCard(body, by, request))
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
  if (out.kind === 'refused') {
    const message = out.code === 'not_found' ? 'That party does not exist.' : out.message
    throw new PartyActionError(out.status, message, { code: out.code, ...out.extra })
  }
  if (out.kind === 'unknown') throw new PartyActionError(502, UNKNOWN_OUTCOME_MESSAGE, { code: 'unknown_outcome' })
  if (!out.already && !out.replay && out.charge) {
    await recordAudit({
      by: { ...by, role: 'owner' }, action: 'party-card', target: { kind: 'party', id: out.rec.bookingId, label: partyLabel(out.rec) },
      details: { cents: out.charge.cents, chargeId: out.charge.id },
    })
  }
  return {
    party: adminPartyView(out.rec), paidCents: out.already ? 0 : out.charge?.cents ?? 0, receiptUrl: out.charge?.receiptUrl ?? null,
    ...(out.already ? { alreadyPaid: true } : {}), ...(out.replay ? { replay: true } : {}),
  }
}
