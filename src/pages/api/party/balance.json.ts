import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { partyForLink, LINK_NOT_FOUND_MESSAGE } from '@lib/parties/pay-balance'
import { dueCents, paymentState } from '@lib/parties/money'
import { getPartySettings } from '@lib/parties/settings-store'
import { partyWhenLabel } from '@lib/parties/payment-link'

/**
 * GET /api/party/balance.json?id=<party>&k=<payment key>: what the payment
 * link page shows. A wrong key answers exactly like a missing party (404).
 * The host page key never opens it (S2-R6). Read only; the bookings gate
 * doesn't apply (S2-R16).
 */
export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`party-balance:${clientAddress}`, 30, 60_000)) return json({ error: 'Too many tries — give it a minute.' }, 429)
  const url = new URL(request.url)
  const id = url.searchParams.get('id') ?? ''
  const k = url.searchParams.get('k') ?? ''
  let rec: Awaited<ReturnType<typeof partyForLink>>
  try {
    rec = await partyForLink(id, k)
  } catch {
    return json({ error: 'Couldn’t load this payment. Please try again.' }, 503)
  }
  if (!rec) return json({ error: LINK_NOT_FOUND_MESSAGE }, 404)

  let packageName = ''
  try {
    packageName = (await getPartySettings()).packages.find((p) => p.id === rec!.packageId)?.name ?? ''
  } catch { /* the package item's label is shown instead */ }
  const items = (rec.items ?? []).filter((it) => it.chargeId === null)
  const last = rec.charges?.length ? rec.charges[rec.charges.length - 1] : null
  return json({
    data: {
      when: partyWhenLabel(rec.startIso),
      hostFirstName: rec.hostName.split(' ')[0] ?? '',
      packageName: packageName || rec.items?.find((it) => it.kind === 'package')?.label || 'Party',
      items: rec.status === 'cancelled' ? [] : items.map((it) => ({ id: it.id, label: it.label, qty: it.qty, cents: it.cents })),
      dueCents: dueCents(rec),
      state: paymentState(rec),
      receiptUrl: last?.receiptUrl ?? null,
    },
  }, 200)
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
