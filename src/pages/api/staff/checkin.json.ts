import type { APIRoute } from 'astro'
import { randomInt, createHash } from 'node:crypto'
import { staffAuthorized } from '@lib/staff-auth'
import { getPartyRecord } from '@lib/party-store'
import { getWaiverRecord } from '@lib/waiver-store'
import { getCheckin, setCheckin, toPublicCheckin, type CheckinState } from '@lib/checkin-store'

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

  const partyRecord = await getPartyRecord(party)
  const dropOff = !!partyRecord?.dropOff
  const state: CheckinState = await getCheckin(party, recordId)
  const nowIso = new Date().toISOString()

  // Plaintext code is returned to the caller exactly once (never persisted).
  let oneTimeCode: string | null = null

  switch (action) {
    case 'checkin': {
      // Mark the selected people present. Whoever staff picked is who's here —
      // the RSVP only pre-selected; a late-arriving sibling can be added now.
      const ids = asIds(body?.personIds)
      if (ids.length === 0) return new Response(JSON.stringify({ error: 'No one selected to check in.' }), { status: 400 })
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
      break
    }
    case 'reissue-code': {
      // Rotate the code — new plaintext, shown once (the old one stops working).
      oneTimeCode = newCode()
      state.pickupCodeHash = hashCode(oneTimeCode)
      break
    }
    case 'undo-checkin': {
      const ids = asIds(body?.personIds)
      if (ids.length === 0) state.presence = {}
      else for (const id of ids) delete state.presence[id]
      // No one left on-site → retire the code and pickup note.
      if (Object.keys(state.presence).length === 0) {
        state.pickupCodeHash = null
        state.pickedUpBy = null
      }
      break
    }
    case 'set-pickup':
      state.confirmedPickup = asIds(body?.confirmedPickup)
      break
    case 'pickup': {
      const ids = asIds(body?.personIds).filter((id) => state.presence[id] && !state.presence[id].outAt)
      if (ids.length === 0) return new Response(JSON.stringify({ error: 'No one here to check out.' }), { status: 400 })
      // The code is the authorization gate for releasing a CHILD from a drop-off
      // event — whoever holds it was given it by the parent. "Collected by" is an
      // optional record, not a gate. Adults (or non-drop-off) need no code.
      if (dropOff && ids.some(isChild)) {
        const code = typeof body?.code === 'string' ? body.code.trim() : ''
        if (!state.pickupCodeHash || hashCode(code) !== state.pickupCodeHash) {
          return new Response(JSON.stringify({ error: 'Pickup code doesn’t match. Verify with the parent.' }), { status: 400 })
        }
      }
      for (const id of ids) state.presence[id] = { ...state.presence[id], outAt: nowIso }
      if (typeof body?.pickedUpBy === 'string' && body.pickedUpBy.trim()) state.pickedUpBy = body.pickedUpBy.trim()
      // Once every child has been collected, the family code is spent.
      if (dropOff && !childStillHere(state)) state.pickupCodeHash = null
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
      break
    }
    default:
      return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 })
  }

  await setCheckin(party, recordId, state)
  return new Response(
    JSON.stringify({ data: { checkin: toPublicCheckin(state), ...(oneTimeCode ? { oneTimeCode } : {}) } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
