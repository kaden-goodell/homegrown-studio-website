/**
 * The "mark these people present" step, shared by `checkin.json` (the roster's
 * ✓ Here / Check in button) and `rsvp.json` (the door's "+ Add family").
 * One code path, so a drop-off family added at the door gets exactly the same
 * pickup-code issuance + SMS as one checked in from the roster.
 *
 * Two halves because the SMS is a real side effect and must never run inside
 * the optimistic-concurrency retry loop of `mutateCheckin`:
 *   applyPresent()      — pure state change, runs INSIDE the mutation callback
 *   sendPickupCode()    — texts the code + logs 'code-sent', runs AFTER commit
 *   markPresent()       — both, for callers with nothing else to fold in
 */
import { randomInt, createHash } from 'node:crypto'
import { getRsvp } from '@lib/rsvp-store'
import { normalizeAuthorizedPickup, type WaiverRecord } from '@lib/waiver-store'
import { mutateCheckin, getCheckin, type CheckinState } from '@lib/checkin-store'
import { sendQuoText, pickupCodeText } from '@lib/quo'
import { eventKey, type EventKind, type StudioEvent } from '@lib/events'
import type { By } from '@lib/staff-auth'
import { createLogger } from '@lib/logger'

const logger = createLogger('checkin-actions')

export const hashCode = (code: string) => createHash('sha256').update('pickup:' + code).digest('hex')
export const newCode = () => String(randomInt(1000, 10000))

const isChild = (id: string) => id.startsWith('child:')

/** First name only — the pickup-code text names kids by first name. */
function firstName(full: string): string {
  const t = full.trim()
  return t.split(/\s+/)[0] || t
}

/** Kid first names for an SMS — every minor on the waiver by default, or just
 *  the ones in `ids` when releasing a specific subset. */
export function kidNames(waiverRecord: WaiverRecord | null, ids?: string[]): string[] {
  if (!waiverRecord) return []
  const minors = waiverRecord.minors
  const targets = ids ? ids.filter(isChild) : minors.map((_, i) => `child:${i}`)
  return targets
    .map((id) => minors[Number(id.slice('child:'.length))]?.name)
    .filter((n): n is string => !!n)
    .map(firstName)
}

export interface PresentCtx {
  event: StudioEvent
  kind: EventKind
  id: string
  recordId: string
  waiverRecord: WaiverRecord | null
  personIds: string[]
  day: string
  by: By
  /** Party rosters read "who's crafting" from here — set when a door add-in also creates the RSVP. */
  expected?: string[]
}

/**
 * Mark people present on `day`. Whoever staff picked is who's here — the RSVP
 * only pre-selected. For a drop-off event with a child in the set, also seeds
 * the authorized-pickup list (one-shot, gated on `pickupSeeded`) and issues the
 * ONE family code if there isn't one yet. Returns the plaintext code (shown
 * once, never stored) or null.
 */
export async function applyPresent(state: CheckinState, c: PresentCtx): Promise<{ oneTimeCode: string | null }> {
  const nowIso = new Date().toISOString()
  const dayState = (state.days[c.day] ??= { presence: {} })
  if (c.expected) state.expected = c.expected
  for (const pid of c.personIds) {
    const existing = dayState.presence[pid]
    // Re-checking someone who already left reopens their presence.
    dayState.presence[pid] = { inAt: existing && !existing.outAt ? existing.inAt : nowIso, outAt: null }
  }
  state.events.push({ at: nowIso, action: 'checkin', personIds: c.personIds, day: c.day, by: c.by })

  let oneTimeCode: string | null = null
  if (c.event.dropOff && c.personIds.some(isChild)) {
    // The RSVP's `pickup` override (set on the returning-household RSVP
    // screen when the on-file signature had no pickup rows) wins over the
    // signature's own fields. Event-scoped, not per-day. ONE-SHOT: staff who
    // delete an unsafe collector leave an empty list behind, and re-seeding
    // it from the waiver would put that person straight back.
    if (!state.pickupSeeded) {
      if (state.confirmedPickup.length === 0) {
        const rsvp = await getRsvp(c.kind, c.id, c.recordId)
        if (rsvp?.pickup) {
          state.confirmedPickup = normalizeAuthorizedPickup(rsvp.pickup.authorizedPickup)
          state.notAuthorized = rsvp.pickup.notAuthorized || ''
        } else {
          state.confirmedPickup = c.waiverRecord ? normalizeAuthorizedPickup(c.waiverRecord.authorizedPickup) : []
          state.notAuthorized = c.waiverRecord?.notAuthorized || ''
        }
      }
      state.pickupSeeded = true
    }
    if (!state.pickupCodeHash) {
      oneTimeCode = newCode()
      state.pickupCodeHash = hashCode(oneTimeCode)
      // 'code-sent' is logged AFTER the SMS is attempted — see sendPickupCode.
    }
  }
  return { oneTimeCode }
}

/** Text the freshly-issued code and log the true outcome. Never throws —
 *  a Quo outage still lets check-in succeed, just with `smsFailed`. */
export async function sendPickupCode(
  c: Pick<PresentCtx, 'event' | 'recordId' | 'waiverRecord' | 'day' | 'by' | 'kind' | 'id'>,
  code: string,
): Promise<{ smsFailed: boolean }> {
  let failed = false
  try {
    await sendQuoText({
      to: c.waiverRecord?.adult.phone ?? '',
      content: pickupCodeText(c.event.title ?? 'Hometown Studio', code, kidNames(c.waiverRecord)),
    })
  } catch (err) {
    logger.error('Pickup-code text failed', { error: err instanceof Error ? err.message : String(err) })
    failed = true
  }
  // Logged after the attempt, with the true outcome. A second small append is
  // safe: mutateCheckin re-reads fresh state and only ever commits once.
  try {
    await mutateCheckin(eventKey(c.kind, c.id), c.recordId, (s) => {
      s.events.push({
        at: new Date().toISOString(),
        action: 'code-sent',
        personIds: [],
        day: c.day,
        by: c.by,
        ...(failed ? { note: 'send failed' } : {}),
      })
    })
  } catch (err) {
    logger.error('Failed to log code-sent event', { error: err instanceof Error ? err.message : String(err) })
  }
  return { smsFailed: failed }
}

/** Mark present + text the code, as one call. Throws on storage errors
 *  (including 'Concurrent update') so the caller maps them to a status. */
export async function markPresent(
  c: PresentCtx,
): Promise<{ state: CheckinState; oneTimeCode: string | null; smsFailed: boolean }> {
  let code = null as string | null
  const state = await mutateCheckin(eventKey(c.kind, c.id), c.recordId, async (s) => {
    code = null // a retried attempt must not inherit a stale code
    code = (await applyPresent(s, c)).oneTimeCode
  })
  let smsFailed = false
  if (code) smsFailed = (await sendPickupCode(c, code)).smsFailed
  return { state, oneTimeCode: code, smsFailed }
}

/**
 * A household re-signed (or was re-added) under a new waiver id for the same
 * event: carry the earlier check-in state (presence, pickup code) over to the
 * new id so the family doesn't vanish from "here". Party-only — that's where
 * check-in state is keyed by the bare event id. Never throws.
 */
export async function migrateCheckinOnReplace(kind: EventKind, id: string, oldId: string | null, newId: string): Promise<void> {
  if (!oldId || kind !== 'party') return
  try {
    const old = await getCheckin(id, oldId)
    const hadAnyPresence = Object.values(old.days).some((d) => Object.keys(d.presence).length > 0)
    if (hadAnyPresence || old.pickupCodeHash) {
      await mutateCheckin(id, newId, (s) => { Object.assign(s, old) })
    }
  } catch (err) {
    logger.error('Checkin migration failed on re-RSVP', { error: err instanceof Error ? err.message : String(err) })
  }
}
