import type { APIRoute } from 'astro'
import { randomInt, createHash } from 'node:crypto'
import { staffAuthorized } from '@lib/staff-auth'
import { getEvent } from '@lib/events'
import { getWaiverRecord } from '@lib/waiver-store'
import { mutateCheckin, toPublicCheckin, type CheckinState } from '@lib/checkin-store'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:staff:checkin')

export const prerender = false

/** "Grandma Rivera, Uncle Joe and Aunt Sue" → ["Grandma Rivera","Uncle Joe","Aunt Sue"] */
function parsePickup(raw: string): string[] {
  return raw
    .split(/,|\band\b|\n|&|;/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

const hashCode = (code: string) => createHash('sha256').update('pickup:' + code).digest('hex')
const newCode = () => String(randomInt(1000, 10000))

const isChild = (id: string) => id.startsWith('child:')
const asIds = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []

/** Any child still on-site (checked in, not yet picked up)? */
function childStillHere(state: CheckinState): boolean {
  return Object.entries(state.presence).some(([id, p]) => isChild(id) && !p.outAt)
}

/**
 * Staff-only per-person check-in/pickup for a household at a party.
 * POST { party, recordId, action, ...}
 *   action: 'checkin' | 'undo-checkin' | 'pickup' | 'undo-pickup' | 'reissue-code' | 'set-pickup'
 *   checkin:      { personIds: string[] }   — mark these people present
 *   undo-checkin: { personIds?: string[] }  — clear presence (all if omitted)
 *   pickup:       { personIds: string[], code, pickedUpBy? } — code required if a child is leaving a drop-off
 *   undo-pickup:  { personIds?: string[] }  — reverse a pickup (all if omitted)
 *   set-pickup:   { confirmedPickup: string[] }
 *   reissue-code: {}  — rotate the pickup code (only for drop-off events; works even if no code was issued yet)
 */
export const POST: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const body = await request.json().catch(() => null)
  const party = typeof body?.party === 'string' ? body.party : ''
  const recordId = typeof body?.recordId === 'string' ? body.recordId : ''
  const action = typeof body?.action === 'string' ? body.action : ''
  if (!party || !recordId) return new Response(JSON.stringify({ error: 'Missing party/record' }), { status: 400 })

  // Read dropOff flag once before the mutation callback — it doesn't change
  // within a request and avoids async calls inside the retry loop.
  let studioEvent = null
  try {
    studioEvent = await getEvent('party', party)
  } catch (err) {
    logger.error('Event lookup failed', { error: String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t reach storage — check wifi and try again.' }), { status: 503 })
  }
  const dropOff = !!studioEvent?.dropOff

  if (action !== 'checkin' && action !== 'undo-checkin' && action !== 'pickup' &&
      action !== 'undo-pickup' && action !== 'reissue-code' && action !== 'set-pickup') {
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 })
  }

  // Plaintext code is shown to the caller exactly once (never persisted).
  // denyReason is set inside the callback to signal validation failures that
  // still need the event to commit (e.g. pickup-denied).
  let oneTimeCode: string | null = null
  let denyReason: string | null = null

  let finalState: CheckinState

  try {
    finalState = await mutateCheckin(party, recordId, async (state) => {
      // Reset closure variables at the top of each callback invocation so
      // retries don't leak stale values from a previous (failed) attempt.
      oneTimeCode = null
      denyReason = null

      const nowIso = new Date().toISOString()

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
            const existing = state.presence[id]
            // Re-checking someone who already left reopens their presence.
            state.presence[id] = { inAt: existing && !existing.outAt ? existing.inAt : nowIso, outAt: null }
          }
          if (dropOff && ids.some(isChild)) {
            // Seed authorized-pickup names, and issue the ONE family code if we
            // haven't already — store only its hash, show the plaintext once.
            if (state.confirmedPickup.length === 0) {
              const w = await getWaiverRecord(recordId)
              state.confirmedPickup = w ? parsePickup(w.authorizedPickup || '') : []
            }
            if (!state.pickupCodeHash) {
              oneTimeCode = newCode()
              state.pickupCodeHash = hashCode(oneTimeCode)
            }
          }
          state.events.push({ at: nowIso, action: 'checkin', personIds: ids })
          break
        }

        case 'reissue-code': {
          // Guard: pickup codes only apply to drop-off events.
          if (!dropOff) {
            denyReason = 'Pickup codes only apply to drop-off events.'
            state.events.push({ at: nowIso, action: 'reissue-code', personIds: [], note: 'denied: not a drop-off event' })
            return
          }
          // Works whether or not a code already exists — fixes the dead-end when
          // drop-off was toggled ON after kids were already checked in with no code.
          // Toggling drop-off OFF leaves any pickupCodeHash in place — harmless,
          // the pickup gate is dropOff-scoped.
          const isRotation = !!state.pickupCodeHash
          oneTimeCode = newCode()
          state.pickupCodeHash = hashCode(oneTimeCode)
          state.events.push({ at: nowIso, action: 'reissue-code', personIds: [], note: isRotation ? 'rotated' : 'first issue' })
          break
        }

        case 'undo-checkin': {
          const ids = asIds(body?.personIds)
          const prevPresence = JSON.stringify(state.presence)
          if (ids.length === 0) state.presence = {}
          else for (const id of ids) delete state.presence[id]
          // No one left on-site → retire the code and pickup note.
          if (Object.keys(state.presence).length === 0) {
            state.pickupCodeHash = null
            state.pickedUpBy = null
          }
          const clearedIds = ids.length === 0 ? Object.keys(JSON.parse(prevPresence)) : ids
          state.events.push({ at: nowIso, action: 'undo-checkin', personIds: clearedIds, note: `cleared: ${prevPresence}` })
          break
        }

        case 'set-pickup':
          state.confirmedPickup = asIds(body?.confirmedPickup)
          state.events.push({ at: nowIso, action: 'set-pickup', personIds: [] })
          break

        case 'pickup': {
          const ids = asIds(body?.personIds).filter((id) => state.presence[id] && !state.presence[id].outAt)
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
              state.events.push({ at: nowIso, action: 'pickup-denied', personIds: ids, note: 'no code issued' })
              return
            }
            if (hashCode(code) !== state.pickupCodeHash) {
              denyReason = 'Pickup code doesn’t match. Verify with the parent.'
              state.events.push({ at: nowIso, action: 'pickup-denied', personIds: ids, note: 'code mismatch' })
              return
            }
          }
          for (const id of ids) state.presence[id] = { ...state.presence[id], outAt: nowIso }
          const pickedUpBy = typeof body?.pickedUpBy === 'string' && body.pickedUpBy.trim()
            ? body.pickedUpBy.trim()
            : undefined
          if (pickedUpBy) state.pickedUpBy = pickedUpBy
          // Once every child has been collected, the family code is spent.
          if (dropOff && !childStillHere(state)) state.pickupCodeHash = null
          state.events.push({ at: nowIso, action: 'pickup', personIds: ids, ...(pickedUpBy ? { pickedUpBy } : {}) })
          break
        }

        case 'undo-pickup': {
          const ids = asIds(body?.personIds)
          const targets = ids.length ? ids : Object.keys(state.presence)
          for (const id of targets) {
            if (state.presence[id]) state.presence[id] = { ...state.presence[id], outAt: null }
          }
          // A child is back on-site but the code was spent → re-issue so pickup works.
          if (dropOff && childStillHere(state) && !state.pickupCodeHash) {
            oneTimeCode = newCode()
            state.pickupCodeHash = hashCode(oneTimeCode)
          }
          state.events.push({ at: nowIso, action: 'undo-pickup', personIds: targets })
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
    JSON.stringify({ data: { checkin: toPublicCheckin(finalState!), ...(oneTimeCode ? { oneTimeCode } : {}) } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
