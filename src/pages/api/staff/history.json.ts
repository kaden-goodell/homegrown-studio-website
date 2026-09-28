import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { eventKey, type EventKind } from '@lib/events'
import { getCheckin } from '@lib/checkin-store'

export const prerender = false

const KIND_RE = /^(party|workshop|program)$/

function bad(detail: string, status = 400): Response {
  return new Response(JSON.stringify({ error: detail }), { status })
}

/**
 * Staff-only. `GET ?kind=&id=&recordId=` — the full custody event log for
 * one household at one event (HOM-217). This is the ONLY endpoint that
 * returns `events`; `toPublicCheckin` (used by `roster.json`/`checkin.json`)
 * deliberately strips them. Backs the console's read-only "History" sheet.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const staff = staffAuthorized(request)
  if (!staff) return bad('Unauthorized', 401)

  const kind = url.searchParams.get('kind') ?? ''
  const id = url.searchParams.get('id') ?? ''
  const recordId = url.searchParams.get('recordId') ?? ''
  if (!KIND_RE.test(kind) || !id || !recordId) return bad('Missing kind/id/recordId')

  try {
    const state = await getCheckin(eventKey(kind as EventKind, id), recordId)
    return new Response(JSON.stringify({ data: { events: state.events } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return bad("Couldn't load history — try again.", 503)
  }
}
