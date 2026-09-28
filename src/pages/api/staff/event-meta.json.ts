import type { APIRoute } from 'astro'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import { getEvent, type EventKind } from '@lib/events'
import { setEventMeta, type EventMetaPatch } from '@lib/event-meta'

export const prerender = false

const KIND_RE = /^(party|workshop|program)$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 14

function bad(detail: string, status = 400): Response {
  return new Response(JSON.stringify({ error: detail }), { status })
}

function parseKindId(kindRaw: unknown, idRaw: unknown): { kind: EventKind; id: string } | null {
  const kind = typeof kindRaw === 'string' ? kindRaw : ''
  const id = typeof idRaw === 'string' ? idRaw.trim() : ''
  if (!KIND_RE.test(kind) || !id) return null
  return { kind: kind as EventKind, id }
}

/** `days`: absent from the body → untouched; `null` → revert to the default
 *  (derive from the source event's startIso); an array → up to 14 YYYY-MM-DD
 *  strings, sorted + deduped. Anything else is rejected. */
function parseDaysPatch(body: any): { ok: true; value?: string[] | null } | { ok: false } {
  if (!('days' in body)) return { ok: true }
  if (body.days === null) return { ok: true, value: null }
  if (
    Array.isArray(body.days) &&
    body.days.length > 0 &&
    body.days.length <= MAX_DAYS &&
    body.days.every((d: unknown) => typeof d === 'string' && DAY_RE.test(d))
  ) {
    return { ok: true, value: [...new Set(body.days as string[])].sort() }
  }
  return { ok: false }
}

/**
 * Staff-only. `POST { kind, id, dropOff?, days? }` patches the event-meta
 * overlay (drop-off + multi-day settings) and returns the merged event.
 * `GET ?kind=&id=` reads the current merged event without changing anything —
 * used by the settings sheet to show "Last changed by …" on open.
 */
export const POST: APIRoute = async ({ request }) => {
  const staff = staffAuthorized(request)
  if (!staff) return bad('Unauthorized', 401)

  const body = await request.json().catch(() => null)
  if (!body) return bad('Invalid request body')

  const parsed = parseKindId(body.kind, body.id)
  if (!parsed) return bad('Missing or invalid kind/id')
  const { kind, id } = parsed

  const daysPatch = parseDaysPatch(body)
  if (!daysPatch.ok) return bad(`Days must be up to ${MAX_DAYS} dates (YYYY-MM-DD), or null.`)

  const patch: EventMetaPatch = {}
  if (typeof body.dropOff === 'boolean') patch.dropOff = body.dropOff
  if ('value' in daysPatch) patch.days = daysPatch.value

  if (patch.dropOff === undefined && patch.days === undefined) {
    return bad('Nothing to update.')
  }

  try {
    await setEventMeta(kind, id, patch, byOf(staff))
    const event = await getEvent(kind, id)
    if (!event) return bad("We couldn't find that event.", 404)
    return new Response(JSON.stringify({ data: event }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return bad("Couldn't reach storage — try again.", 503)
  }
}

export const GET: APIRoute = async ({ request, url }) => {
  const staff = staffAuthorized(request)
  if (!staff) return bad('Unauthorized', 401)

  const parsed = parseKindId(url.searchParams.get('kind'), url.searchParams.get('id'))
  if (!parsed) return bad('Missing or invalid kind/id')

  try {
    const event = await getEvent(parsed.kind, parsed.id)
    if (!event) return bad("We couldn't find that event.", 404)
    return new Response(JSON.stringify({ data: event }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return bad("Couldn't reach storage — try again.", 503)
  }
}
