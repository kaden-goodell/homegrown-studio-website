import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { askToChangeParty, ChangeRequestError } from '@lib/parties/change-request'
import { partyWritesRefusal } from '@lib/parties/test-site'

export const prerender = false

const NO_STORE = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const answer = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: NO_STORE })

/**
 * The host asks to move or cancel their party (host page, final review I4).
 * POST { bookingId, key, want: 'move' | 'cancel' | 'other', note }
 * Saves the request on the party, texts the owners, shows in To decide. Nothing
 * else changes: the owners decide by the party policy.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`party-change:${clientAddress}`, 6, 60_000)) {
    return answer({ error: 'That’s a lot of tries in a row. Give it a minute, then try again.' }, 429)
  }
  const testSite = partyWritesRefusal(request)
  if (testSite) return answer({ error: testSite }, 503)
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return answer({ error: 'Something was missing. Check the form and try again.' }, 400)
  try {
    const { request: req } = await askToChangeParty({ bookingId: body.bookingId, key: body.key, want: body.want, note: body.note })
    return answer({ data: { at: req.at, want: req.want } }, 200)
  } catch (err) {
    if (err instanceof ChangeRequestError) return answer({ error: err.message }, err.status)
    console.error('[api:party:change-request] failed', err instanceof Error ? err.message : String(err))
    return answer({ error: 'We couldn’t send that just now. Try again in a minute, or text us.' }, 503)
  }
}
