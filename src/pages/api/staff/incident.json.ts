import type { APIRoute } from 'astro'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import { createIncident, type IncidentRecord } from '@lib/incident-store'
import { mutateCheckin } from '@lib/checkin-store'
import { eventKey, type EventKind } from '@lib/events'
import { sendIncidentEmail } from '@lib/email'
import { siteConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:incident')

const KIND_RE = /^(party|workshop|program)$/
const HOW_RE = /^(phone|in-person|text|not-yet)$/
const MIN_WHAT = 10

function bad(detail: string, status = 400): Response {
  return new Response(JSON.stringify({ error: detail }), { status })
}

type Who = IncidentRecord['who']

function parseWho(raw: unknown): Who | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  const out: Who = []
  for (const w of raw) {
    if (!w || typeof w !== 'object') return null
    const name = typeof (w as any).name === 'string' ? (w as any).name.trim() : ''
    if (!name) return null
    const entry: Who[number] = { name }
    if (typeof (w as any).waiverId === 'string' && (w as any).waiverId) entry.waiverId = (w as any).waiverId
    if (typeof (w as any).personId === 'string' && (w as any).personId) entry.personId = (w as any).personId
    out.push(entry)
  }
  return out
}

/** `undefined` on the wire = no event set yet ⇒ treated as `null` (open
 *  studio). Any other shape that fails to parse is a 400, not a silent drop. */
function parseEvent(raw: unknown): { ok: true; value: IncidentRecord['event'] } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'object') return { ok: false }
  const kind = (raw as any).kind
  const id = (raw as any).id
  const title = (raw as any).title
  const day = (raw as any).day
  if (!KIND_RE.test(kind) || typeof id !== 'string' || !id || typeof title !== 'string' || !title || typeof day !== 'string' || !day) {
    return { ok: false }
  }
  return { ok: true, value: { kind: kind as EventKind, id, title, day } }
}

function parseParentNotified(raw: any, fallbackBy: string): IncidentRecord['parentNotified'] {
  const how = HOW_RE.test(raw?.how) ? raw.how : 'not-yet'
  const at = how === 'not-yet'
    ? null
    : typeof raw?.at === 'string' && raw.at
      ? raw.at
      : new Date().toISOString()
  const by = typeof raw?.by === 'string' && raw.by ? raw.by : fallbackBy
  return { at, by, how }
}

/**
 * Staff-only. `POST { at?, event, who, what, firstAid?, witnesses?,
 * parentNotified?, followUp? }` saves an incident report (HOM-215):
 * - `what` must be at least 10 characters (trimmed).
 * - When `event` is set and any `who[]` entry carries a `waiverId`, appends
 *   an `{ action: 'incident' }` `CheckinEvent` to that household's custody
 *   log (grouped — one append per distinct waiverId, not per person).
 * - Emails `siteConfig.ownerEmails` immediately. Both the custody-log append
 *   and the email are non-fatal: a failure is logged, and the email failure
 *   is surfaced as `emailed: false` in the (still-200) response — the
 *   incident itself is always saved once validation passes.
 */
export const POST: APIRoute = async ({ request }) => {
  const staff = staffAuthorized(request)
  if (!staff) return bad('Unauthorized', 401)

  const body = await request.json().catch(() => null)
  if (!body) return bad('Invalid request body')

  const what = typeof body.what === 'string' ? body.what.trim() : ''
  if (what.length < MIN_WHAT) return bad(`Describe what happened (at least ${MIN_WHAT} characters).`)

  const who = parseWho(body.who)
  if (who === null) return bad('Invalid "who" list.')

  const eventParsed = parseEvent(body.event)
  if (!eventParsed.ok) return bad('Invalid event.')
  const event = eventParsed.value

  const at = typeof body.at === 'string' && body.at ? body.at : new Date().toISOString()
  const firstAid = typeof body.firstAid === 'string' ? body.firstAid : ''
  const witnesses = typeof body.witnesses === 'string' ? body.witnesses : ''
  const followUp = typeof body.followUp === 'string' ? body.followUp : ''
  const parentNotified = parseParentNotified(body.parentNotified, staff.name)

  let record: IncidentRecord
  try {
    record = await createIncident({ at, by: byOf(staff), event, who, what, firstAid, witnesses, parentNotified, followUp })
  } catch (err) {
    logger.error('Incident save failed', { error: err instanceof Error ? err.message : String(err) })
    return bad("Couldn't save — try again.", 503)
  }

  // Cross-log into each distinct household's custody record — grouped so a
  // household with two named kids gets one append (both personIds), not two.
  if (event) {
    const byWaiver = new Map<string, string[]>()
    for (const w of who) {
      if (!w.waiverId) continue
      const list = byWaiver.get(w.waiverId) ?? []
      if (w.personId) list.push(w.personId)
      byWaiver.set(w.waiverId, list)
    }
    for (const [waiverId, personIds] of byWaiver) {
      try {
        await mutateCheckin(eventKey(event.kind, event.id), waiverId, (state) => {
          state.events.push({ at: record.reportedAt, action: 'incident', personIds, by: byOf(staff), day: event.day, incidentId: record.id })
        })
      } catch (err) {
        // Non-fatal — the incident report itself is already saved.
        logger.error('Incident custody-log append failed', { waiverId, incidentId: record.id, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  const whoLabel = who.map((w) => w.name)
  const eventLabel = event ? event.title : 'Open Studio'
  let emailed = false
  try {
    const r = await sendIncidentEmail({
      to: siteConfig.ownerEmails,
      who: whoLabel,
      eventLabel,
      at: record.at,
      reportedAt: record.reportedAt,
      by: byOf(staff),
      what: record.what,
      firstAid: record.firstAid,
      witnesses: record.witnesses,
      parentNotified: record.parentNotified,
      followUp: record.followUp,
    })
    emailed = r.sent
  } catch (err) {
    logger.error('Incident email failed', { incidentId: record.id, error: err instanceof Error ? err.message : String(err) })
    emailed = false
  }

  return new Response(JSON.stringify({ data: { incident: record, emailed } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
