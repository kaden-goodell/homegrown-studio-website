/**
 * LEGACY FALLBACK — delete after 2027-01-15 (LEGACY_FALLBACK_UNTIL,
 * src/config/legacy-fallback.ts; list in docs/handbook/notes/legacy-square-fallback.md).
 * No new features here.
 *
 * While parties run on the old Square booking (/admin › More › Online
 * booking › Runs on, the default), /api/party/book.json hands the booking to
 * today's checkout (square-flow-book.ts): a Square Appointments booking plus
 * the $300 charge. The page sends what the new booking panel sends (a craft
 * id, a guest count, a package); this turns that into what today's checkout
 * reads, looking every detail up on the server (the craft's name and price
 * from the catalog, the party service from Square), never from the page.
 *
 * What the old checkout can't do is refused plainly, before anything is held
 * or charged: extras other than a themed table, and a package other than the
 * whole studio.
 *
 * Server only.
 */
import type { APIContext } from 'astro'
import { createLogger } from '@lib/logger'
import { findPartyCraft } from '@lib/craft-catalog'
import { partyConfig } from '@config/party.config'
import { siteConfig, type SquareConfig } from '@config/site.config'
import { createSquareClient } from '@providers/square/client'
import { partyTermsForStart } from '@lib/party-terms'
import { WHOLE_STUDIO_PACKAGE_ID } from '@lib/parties/pricing'
import { squareFlowBook } from './party-book-square-flow'

const logger = createLogger('party-square-flow')

export const SQUARE_FLOW_NO_EXTRAS = 'Extras can’t be added online right now. Book without them and text us at (256) 464-1710 to add them. Nothing was charged.'
export const SQUARE_FLOW_NO_PACKAGE = 'That party package can’t be booked online right now. Text us at (256) 464-1710 and we’ll set it up. Nothing was charged.'
export const SQUARE_FLOW_CRAFT_GONE = 'That craft isn’t available anymore. Pick another one. Nothing was charged.'
export const SQUARE_FLOW_PRICE_CHANGED = 'The price changed since this page opened, so nothing was charged or booked. Close this and start again to see the new total.'

function refuse(status: number, code: string, detail: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error: 'Unable to complete party booking', code, detail, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/** The party service (whole studio) in Square: its variation id and version. */
export async function loadPartyService(): Promise<{ id: string; version: number } | null> {
  const client = createSquareClient((siteConfig.providers?.catalog?.config ?? {}) as SquareConfig)
  const resp: any = await client.catalog.object.get({ objectId: partyConfig.square.catalogItemId })
  const item = resp?.object ?? resp
  const v = item?.itemData?.variations?.[0]
  if (!v?.id) return null
  return { id: String(v.id), version: Number(v.version ?? 0) }
}

/** Test seam. */
export const deps = { findPartyCraft, loadPartyService, squareFlowBook }

export async function bookPartyOnSquare(ctx: Pick<APIContext, 'request' | 'clientAddress'>, body: any): Promise<Response> {
  const addOns = body?.addOns && typeof body.addOns === 'object' ? Object.values(body.addOns as Record<string, unknown>) : []
  if (addOns.some((n) => Number(n) > 0)) return refuse(400, 'invalid', SQUARE_FLOW_NO_EXTRAS)
  if (typeof body?.packageId === 'string' && body.packageId && body.packageId !== WHOLE_STUDIO_PACKAGE_ID) {
    return refuse(400, 'invalid', SQUARE_FLOW_NO_PACKAGE)
  }
  const craftId = typeof body?.craftId === 'string' ? body.craftId : typeof body?.craft?.id === 'string' ? body.craft.id : ''
  const startTime = String(body?.startTime ?? '')
  // The old checkout checks the rest (time, card, name, phone) in its own words.
  if (craftId && startTime && !Number.isNaN(Date.parse(startTime))) {
    // The total on the Pay button must be what the old checkout charges (no themed table: the studio fee or the craft credit).
    const expected = Number(body?.expectedTotalCents)
    if (!body?.theme && Number.isFinite(expected) && expected > 0 && expected !== partyTermsForStart(startTime).chargeNowCents) {
      logger.error('Party total on the page differs from today’s checkout — refusing', { expected, charge: partyTermsForStart(startTime).chargeNowCents })
      return refuse(409, 'unavailable', SQUARE_FLOW_PRICE_CHANGED, { why: 'price_changed' })
    }
  }
  let craft = null
  if (craftId) {
    craft = await deps.findPartyCraft(craftId, Date.now(), { fresh: true })
    if (!craft || craft.hidden) return refuse(404, 'invalid', SQUARE_FLOW_CRAFT_GONE)
  }
  const service = await deps.loadPartyService()
  if (!service) {
    logger.error('Party service variation not found in Square')
    return refuse(503, 'unavailable', 'Party booking isn’t working right now, and nothing was charged. Text us at (256) 464-1710 and we’ll book it for you.')
  }
  const guests = Math.floor(Number(body?.guests ?? body?.people ?? 0))
  const oldBody = {
    ...body,
    serviceVariationId: service.id,
    serviceVariationVersion: service.version,
    ...(craft
      ? {
          craft: {
            id: craft.id,
            name: craft.name,
            perHeadCents: craft.perHeadCents,
            perHeadMaxCents: craft.perHeadMaxCents,
            description: craft.description ?? '',
            imageUrl: craft.imageUrl ?? '',
          },
        }
      : {}),
    people: guests,
  }
  const headers = new Headers(ctx.request.headers)
  headers.set('content-type', 'application/json')
  headers.delete('content-length')
  const request = new Request(ctx.request.url, { method: 'POST', headers, body: JSON.stringify(oldBody) })
  return deps.squareFlowBook({ request, clientAddress: ctx.clientAddress } as any) as Promise<Response>
}
