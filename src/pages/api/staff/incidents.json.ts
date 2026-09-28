import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { listIncidentsByEvent } from '@lib/incident-store'
import { EVENT_KIND_RE, type EventKind } from '@lib/events'

export const prerender = false

// One shared kind validator (@lib/events) — a local copy here had drifted
// to include `program`, which `getEvent` has no resolver for.
const KIND_RE = EVENT_KIND_RE

function bad(detail: string, status = 400): Response {
  return new Response(JSON.stringify({ error: detail }), { status })
}

/** Staff-only. `GET ?kind=&id=` — an event's incident reports, newest first.
 *  Powers the roster's "Incidents (n)" badge + read-only list (HOM-215). */
export const GET: APIRoute = async ({ request, url }) => {
  const staff = staffAuthorized(request)
  if (!staff) return bad('Unauthorized', 401)

  const kind = url.searchParams.get('kind') ?? ''
  const id = url.searchParams.get('id') ?? ''
  if (!KIND_RE.test(kind) || !id) return bad('Missing kind/id')

  try {
    const incidents = await listIncidentsByEvent(kind as EventKind, id)
    return new Response(JSON.stringify({ data: { incidents } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return bad("Couldn't load incidents — try again.", 503)
  }
}
