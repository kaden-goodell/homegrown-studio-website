import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { getPartyRecord } from '@lib/party-store'
import { partyConfig } from '@config/party.config'
import { inviteContent } from '@config/invite-content'
import { buildIcs, addMinutesIso, partyInviteUrl } from '@lib/party-share'
import { formatSlotLabel } from '@lib/studio-time'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:party:invite-ics')

/**
 * Guest-facing calendar file for a party — linked from the host's pre-written
 * invitation email (mailto can't attach files) and the invite page's
 * Apple/Outlook button. Token-free by design: it carries only what the public
 * invite page already shows (title/craft, time, address, invite link).
 *
 * GET /api/party/invite.ics?party={bookingId}
 */
export const GET: APIRoute = async ({ url, clientAddress }) => {
  if (rateLimited(`invite-ics:${clientAddress}`, 30, 60_000)) {
    return new Response('Too many requests — give it a minute.', { status: 429 })
  }
  const partyId = url.searchParams.get('party')?.trim() ?? ''
  if (!partyId) return new Response('Missing party', { status: 400 })

  let party
  try {
    party = await getPartyRecord(partyId)
  } catch (err) {
    logger.error('Party lookup failed', { partyId, error: String(err) })
    return new Response('Couldn’t load the party — try again.', { status: 503 })
  }
  if (!party) return new Response('Not found', { status: 404 })

  const origin = url.origin
  const slotLabel = formatSlotLabel(party.startIso)
  const inviteUrl = partyInviteUrl(
    { bookingId: partyId, craftName: party.craftName, slotLabel, startIso: party.startIso, title: party.title ?? undefined },
    origin,
  )
  const ics = buildIcs({
    title: `${party.title ?? `${party.craftName} Party`} — Homegrown Studio`,
    startIso: party.startIso,
    endIso: addMinutesIso(party.startIso, party.durationMinutes ?? partyConfig.durationMinutes),
    details: `We’re making ${party.craftName} at Homegrown Studio.\n\nInvitation & RSVP: ${inviteUrl}`,
    location: inviteContent.where,
  })

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="homegrown-party.ics"',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
