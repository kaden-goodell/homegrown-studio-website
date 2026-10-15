import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { checkApplication, saveApplication, emailOwners, emailArtist } from '@lib/artist-applications'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:teach:apply')

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * An outside artist asks to teach (/teach). Saved first, then the owners get
 * every answer with the photos attached and the artist gets a short "got it".
 * A hidden field ("company") is left blank by people and filled by bots.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`teach-apply:${clientAddress}`, 5, 60 * 60_000)) {
    return json(429, { error: 'That’s a lot of tries in a row. Give it a few minutes, then try again.' })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json(400, { error: 'We couldn’t read that. Please try again.' })
  // A bot filled the field people never see: answer as if it worked, keep nothing.
  if (typeof body.company === 'string' && body.company.trim()) return json(200, { data: { ok: true } })

  const checked = checkApplication(body)
  if (!checked.ok) return json(400, { error: checked.error, field: checked.field })

  let app
  try {
    app = await saveApplication(checked.value, checked.photos)
  } catch (err) {
    logger.error('Artist application not saved', { error: err instanceof Error ? err.message : String(err) })
    return json(502, { error: 'We couldn’t send that just now. Please try again in a minute.' })
  }
  const adminUrl = `${new URL(request.url).origin}/admin`
  const [owners, artist] = await Promise.all([emailOwners(app, checked.photos, adminUrl), emailArtist(app)])
  logger.info('Artist application received', { id: app.id, ownersEmailed: owners, artistEmailed: artist })
  return json(200, { data: { ok: true } })
}
