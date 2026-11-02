import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized, checkAdminPasscode } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { recordAudit } from '@lib/audit'
import { rateLimited, rateLimitFull } from '@lib/rate-limit'
import { buildRecordsDownload, lastWeeklyArchive, rangeRefusal, RecordsRefusal } from '@lib/records-download'

export const prerender = false

export const WRONG_PASSCODE = 'That passcode isn’t right.'

/**
 * /admin › More › Records (G8), owners only.
 *
 * GET → { data: { lastArchive } }: the day of the newest weekly archive copy.
 * POST { from, to, passcode } (or { everything: true, passcode }) → the zip,
 *   as a download. The admin passcode is asked again (these are families'
 *   personal details and children's records); wrong ones are rate-limited.
 *   Every download (and every refused passcode) is audited. Read-only.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return json(200, { data: { lastArchive: await lastWeeklyArchive() } })
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => ({}))
  const everything = body?.everything === true
  if (!everything) {
    const refused = rangeRefusal({ from: body?.from, to: body?.to })
    if (refused) return json(400, { error: refused, field: 'range' })
  }
  const by = adminActor(request)
  const ip = clientAddress ?? 'unknown'
  // Only wrong passcodes count toward the limit.
  if (rateLimitFull(`records-passcode:${ip}`, 5, 15 * 60_000)) return json(429, { error: 'Too many wrong tries. Wait a few minutes.' })
  if (!(await checkAdminPasscode(String(body?.passcode ?? '')))) {
    rateLimited(`records-passcode:${ip}`, 5, 15 * 60_000)
    await recordAudit({ by: { ...by, role: 'owner' }, action: 'records-download-refused', target: { kind: 'records', id: everything ? 'everything' : `${body.from}..${body.to}` }, details: { reason: 'wrong passcode' } })
    return json(403, { error: WRONG_PASSCODE, field: 'passcode' })
  }
  const range = everything ? null : { from: body.from as string, to: body.to as string }
  try {
    const out = await buildRecordsDownload({ range, everything, by: by.name })
    await recordAudit({
      by: { ...by, role: 'owner' },
      action: 'records-download',
      target: { kind: 'records', id: range ? `${range.from}..${range.to}` : 'everything', label: out.filename },
      details: { bytes: out.bytes.byteLength, waivers: out.counts.waivers ?? 0, checkins: out.counts.checkins ?? 0, incidents: out.counts.incidents ?? 0, audit: out.counts.audit ?? 0 },
    })
    return new Response(new Uint8Array(out.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${out.filename}"`,
        'Cache-Control': 'no-store',
        'X-Records-Filename': out.filename,
      },
    })
  } catch (e) {
    if (e instanceof RecordsRefusal) return json(413, { error: e.message, field: 'range' })
    console.error(`[admin/records] ${e instanceof Error ? e.message : e}`)
    return json(503, { error: 'The records couldn’t be gathered just now. Try again in a minute.' })
  }
}
