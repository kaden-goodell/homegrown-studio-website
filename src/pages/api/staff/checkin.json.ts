import type { APIRoute } from 'astro'
import { randomInt, createHash } from 'node:crypto'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import { getEvent, eventKey, resolveEventDay, isLastEventDay, type EventKind } from '@lib/events'
import { getWaiverRecord, normalizeAuthorizedPickup } from '@lib/waiver-store'
import { getRsvp } from '@lib/rsvp-store'
import { mutateCheckin, toPublicCheckin, childStillHere, type CheckinState } from '@lib/checkin-store'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:staff:checkin')

export const prerender = false

const hashCode = (code: string) => createHash('sha256').update('pickup:' + code).digest('hex')
const newCode = () => String(randomInt(1000, 10000))

const KIND_RE = /^(party|workshop|program)$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

const isChild = (id: string) => id.startsWith('child:')
const asIds = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []

/**
 * Staff-only per-person check-in/pickup for a household at an event.
 * POST { kind, id, recordId, action, day?, ...} — `party` is accepted as a
 * legacy alias for `{ kind: 'party', id: party }`.
 *   action: 'checkin' | 'undo-checkin' | 'pickup' | 'undo-pickup' | 'reissue-code' | 'set-pickup'
 *   checkin:      { personIds: string[] }   — mark these people present (on `day`)
 *   undo-checkin: { personIds?: string[] }  — clear presence on `day` (all if omitted)
 *   pickup:       { personIds: string[], code, pickedUpBy? } — code required if a child is leaving a drop-off
 *   undo-pickup:  { personIds?: string[] }  — reverse a pickup on `day` (all if omitted)
 *   set-pickup:   { confirmedPickup: {name, phone}[] }
 *   reissue-code: {}  — rotate the pickup code (only for drop-off events; works even if no code was issued yet)
 *   `day` (YYYY-MM-DD): which day's attendance this action applies to.
 *   Defaults to today if today is one of the event's days, else the event's
 *   first day (HOM-213). The pickup code itself is event-scoped, not per-day.
 */
export const POST: APIRoute = async ({ request }) => {
  const staff = staffAuthorized(request)
  if (!staff) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const by = byOf(staff)
  const body = await request.json().catch(() => null)
  const legacyParty = typeof body?.party === 'string' ? body.party.trim() : ''
  const kind = legacyParty ? 'party' : (typeof body?.kind === 'string' ? body.kind : '')
  const id = legacyParty || (typeof body?.id === 'string' ? body.id.trim() : '')
  const recordId = typeof body?.recordId === 'string' ? body.recordId : ''
  const action = typeof body?.action === 'string' ? body.action : ''
  if (!KIND_RE.test(kind) || !id || !recordId) {
    return new Response(JSON.stringify({ error: 'Missing event/record' }), { status: 400 })
  }

  // Read the event once before the mutation callback — it doesn't change
  // within a request and avoids async calls inside the retry loop.
  let studioEvent = null
  try {
    studioEvent = await getEvent(kind as EventKind, id)
  } catch (err) {
    logger.error('Event lookup failed', { error: String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t reach storage — check wifi and try again.' }), { status: 503 })
  }
  const dropOff = !!studioEvent?.dropOff

  const requestedDay = typeof body?.day === 'string' && DAY_RE.test(body.day) ? body.day : null
  const day = resolveEventDay(studioEvent, requestedDay)

  if (action !== 'checkin' && action !== 'undo-checkin' && action !== 'pickup' &&
      action !== 'undo-pickup' && action !== 'reissue-code' && action !== 'set-pickup') {
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 })
  }

  const evKey = eventKey(kind as EventKind, id)

  // Plaintext code is shown to the caller exactly once (never persisted).
  // denyReason is set inside the callback to signal validation failures that
  // still need the event to commit (e.g. pickup-denied).
  let oneTimeCode: string | null = null
  let denyReason: string | null = null

  let finalState: CheckinState

  try {
    finalState = await mutateCheckin(evKey, recordId, async (state) => {
      // Reset closure variables at the top of each callback invocation so
      // retries don't leak stale values from a previous (failed) attempt.
      oneTimeCode = null
      denyReason = null

      const nowIso = new Date().toISOString()
      const dayState = (state.days[day] ??= { presence: {} })

      switch (action) {
        case 'checkin': {
          // Mark the selected people present. Whoever staff picked is who's here —
          // the RSVP only pre-selected; a late-arriving sibling can be added now.
          const ids = asIds(body?.personIds)
          if (ids.length === 0) {
            denyReason = 'No one selected to check in.'
            return
          }
          for (const id of ids) {
            const existing = dayState.presence[id]
            // Re-checking someone who already left reopens their presence.
            dayState.presence[id] = { inAt: existing && !existing.outAt ? existing.inAt : nowIso, outAt: null }
          }
          if (dropOff && ids.some(isChild)) {
            // Seed authorized-pickup people (+ any "may NOT collect" note),
            // and issue the ONE family code if we haven't already — store
            // only its hash, show the plaintext once. The RSVP's `pickup`
            // override (set on the returning-household RSVP screen when the
            // on-file signature had no pickup rows, HOM-212) wins over the
            // signature's own fields when present. Event-scoped, not per-day.
            if (state.confirmedPickup.length === 0) {
              const rsvp = await getRsvp(kind as EventKind, id, recordId)
              if (rsvp?.pickup) {
                state.confirmedPickup = normalizeAuthorizedPickup(rsvp.pickup.authorizedPickup)
                state.notAuthorized = rsvp.pickup.notAuthorized || ''
              } else {
                const w = await getWaiverRecord(recordId)
                state.confirmedPickup = w ? normalizeAuthorizedPickup(w.authorizedPickup) : []
                state.notAuthorized = w?.notAuthorized || ''
              }
            }
            if (!state.pickupCodeHash) {
              oneTimeCode = newCode()
              state.pickupCodeHash = hashCode(oneTimeCode)
            }
          }
          state.events.push({ at: nowIso, action: 'checkin', personIds: ids, day, by })
          break
        }

        case 'reissue-code': {
          // Guard: pickup codes only apply to drop-off events.
          if (!dropOff) {
            denyReason = 'Pickup codes only apply to drop-off events.'
            state.events.push({ at: nowIso, action: 'reissue-code', personIds: [], note: 'denied: not a drop-off event', day, by })
            return
          }
          // Works whether or not a code already exists — fixes the dead-end when
          // drop-off was toggled ON after kids were already checked in with no code.
          // Toggling drop-off OFF leaves any pickupCodeHash in place — harmless,
          // the pickup gate is dropOff-scoped.
          const isRotation = !!state.pickupCodeHash
          oneTimeCode = newCode()
          state.pickupCodeHash = hashCode(oneTimeCode)
          state.events.push({ at: nowIso, action: 'reissue-code', personIds: [], note: isRotation ? 'rotated' : 'first issue', day, by })
          break
        }

        case 'undo-checkin': {
          const ids = asIds(body?.personIds)
          const prevPresence = JSON.stringify(dayState.presence)
          if (ids.length === 0) dayState.presence = {}
          else for (const id of ids) delete dayState.presence[id]
          // No one left on-site FOR THIS DAY, and this is the event's last
          // day → retire the code and pickup note. Otherwise keep it — a
          // multi-day camp still needs it tomorrow.
          if (Object.keys(dayState.presence).length === 0 && isLastEventDay(studioEvent, day)) {
            state.pickupCodeHash = null
            state.pickedUpBy = null
          }
          const clearedIds = ids.length === 0 ? Object.keys(JSON.parse(prevPresence)) : ids
          state.events.push({ at: nowIso, action: 'undo-checkin', personIds: clearedIds, note: `cleared: ${prevPresence}`, day, by })
          break
        }

        case 'set-pickup':
          state.confirmedPickup = normalizeAuthorizedPickup(body?.confirmedPickup)
          state.events.push({ at: nowIso, action: 'set-pickup', personIds: [], day, by })
          break

        case 'pickup': {
          const ids = asIds(body?.personIds).filter((id) => dayState.presence[id] && !dayState.presence[id].outAt)
          if (ids.length === 0) {
            denyReason = 'No one here to check out.'
            return
          }
          // The code is the authorization gate for releasing a CHILD from a drop-off
          // event — whoever holds it was given it by the parent. "Collected by" is an
          // optional record, not a gate. Adults (or non-drop-off) need no code.
          if (dropOff && ids.some(isChild)) {
            const code = typeof body?.code === 'string' ? body.code.trim() : ''
            if (!state.pickupCodeHash) {
              denyReason = 'No pickup code was ever issued for this family — use "Issue pickup code" first.'
              state.events.push({ at: nowIso, action: 'pickup-denied', personIds: ids, note: 'no code issued', day, by })
              return
            }
            if (hashCode(code) !== state.pickupCodeHash) {
              denyReason = 'Pickup code doesn’t match. Verify with the parent.'
              state.events.push({ at: nowIso, action: 'pickup-denied', personIds: ids, note: 'code mismatch', day, by })
              return
            }
          }
          for (const id of ids) dayState.presence[id] = { ...dayState.presence[id], outAt: nowIso }
          const pickedUpBy = typeof body?.pickedUpBy === 'string' && body.pickedUpBy.trim()
            ? body.pickedUpBy.trim()
            : undefined
          if (pickedUpBy) state.pickedUpBy = pickedUpBy
          // Once every child on THIS day has been collected, and this is the
          // event's last day, the family code is spent. A multi-day camp
          // keeps it live overnight for tomorrow's drop-off.
          if (dropOff && !childStillHere(state, day) && isLastEventDay(studioEvent, day)) state.pickupCodeHash = null
          state.events.push({ at: nowIso, action: 'pickup', personIds: ids, ...(pickedUpBy ? { pickedUpBy } : {}), day, by })
          break
        }

        case 'undo-pickup': {
          const ids = asIds(body?.personIds)
          const targets = ids.length ? ids : Object.keys(dayState.presence)
          for (const id of targets) {
            if (dayState.presence[id]) dayState.presence[id] = { ...dayState.presence[id], outAt: null }
          }
          // A child is back on-site but the code was spent → re-issue so pickup works.
          if (dropOff && childStillHere(state, day) && !state.pickupCodeHash) {
            oneTimeCode = newCode()
            state.pickupCodeHash = hashCode(oneTimeCode)
          }
          state.events.push({ at: nowIso, action: 'undo-pickup', personIds: targets, day, by })
          break
        }
      }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Concurrent update')) {
      return new Response(
        JSON.stringify({ error: 'Another device just updated this family — refresh and try again.' }),
        { status: 409 },
      )
    }
    // Transient storage error
    return new Response(
      JSON.stringify({ error: 'Couldn’t reach storage — check wifi and try again.' }),
      { status: 503 },
    )
  }

  if (denyReason) {
    return new Response(JSON.stringify({ error: denyReason }), { status: 400 })
  }

  return new Response(
    JSON.stringify({ data: { checkin: toPublicCheckin(finalState!), day, ...(oneTimeCode ? { oneTimeCode } : {}) } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
