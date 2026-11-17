import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { isOurs, listParties, partyEndIso } from '@lib/party-store'
import { dueCents } from '@lib/parties/money'
import { listWaiversByParty } from '@lib/waiver-store'
import { partyTermsForStart } from '@lib/party-terms'
import { isQuoteParty } from '@lib/parties/quote-party'

export const prerender = false

/**
 * Staff-only: list parties with an RSVP count, newest first. A cancelled
 * party is left out (its record stays for refunds on /admin); a party of
 * ours with something still to pay says so ("Waiting on payment").
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await staffAuthorized(request))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const parties = (await listParties()).filter((p) => p.status !== 'cancelled')
  const withCounts = await Promise.all(
    parties.map(async (p) => {
      const waivers = await listWaiversByParty(p.bookingId)
      const people = waivers.reduce((n, w) => n + 1 + w.minors.length, 0)
      // A private event (born from a quote) is never a weeknight party, whatever day it falls on: its money is a deposit, crafts included.
      const quote = isQuoteParty(p)
      const paidCents = (p.items ?? []).filter((it) => it.chargeId !== null).reduce((t, it) => t + it.cents, 0)
      return {
        bookingId: p.bookingId,
        craftName: p.craftName,
        startIso: p.startIso,
        endIso: partyEndIso(p) ?? null,
        waitingOnPayment: isOurs(p) && dueCents(p) > 0,
        title: p.title,
        hostName: p.hostName,
        hostPhone: p.hostPhone ?? null,
        guestCount: p.guestCount,
        themeName: p.theme?.displayName ?? null,
        // Weeknight parties paid a craft credit online, not a studio fee.
        kind: quote ? 'weekend' : p.kind ?? partyTermsForStart(p.startIso).kind,
        paidOnlineCents: quote ? paidCents : p.paidOnlineCents ?? partyTermsForStart(p.startIso).chargeNowCents,
        origin: quote ? 'quote' : null,
        quoteLines: quote ? p.quote?.lines ?? [] : null,
        place: quote ? p.place ?? 'studio' : null,
        address: quote ? p.address ?? null : null,
        rsvpHouseholds: waivers.length,
        rsvpPeople: people,
      }
    }),
  )
  return new Response(JSON.stringify({ data: { parties: withCounts } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
