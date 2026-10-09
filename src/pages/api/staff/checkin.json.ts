import type { APIRoute } from 'astro'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import { getEvent, eventKey, resolveEventDay, isLastEventDay, EVENT_KIND_RE, type EventKind } from '@lib/events'
import { getWaiverRecord, normalizeAuthorizedPickup, type AuthorizedPickup, type WaiverRecord } from '@lib/waiver-store'
import { applyPresent, sendPickupCode, kidNames, hashCode, newCode } from '@lib/checkin-actions'
import { mutateCheckin, toPublicCheckin, childStillHere, type CheckinState } from '@lib/checkin-store'
import { sendQuoText, pickedUpText } from '@lib/quo'
import { formatTime } from '@lib/studio-time'
import { createLogger } from '@lib/logger'
import { recordAudit } from '@lib/audit'
import { paymentBypassEnabled } from '@lib/dev-flags'

const logger = createLogger('api:staff:checkin')

export const prerender = false

const KIND_RE = EVENT_KIND_RE
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const OVERRIDE_REASON_RE = /^(called-parent|parent-present|other)$/

const isChild = (id: string) => id.startsWith('child:')
const asIds = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []

// Exact copy — surfaced verbatim in the staff console (HOM-214 §7) and
// asserted verbatim in tests, so these live as named constants rather than
// inline strings sprinkled through the switch below.
const NOT_ON_LIST_MSG = "Not on the list — tick 'I checked their photo ID' or use Override."
const NOT_AUTHORIZED_MSG = 'That name is on the may-NOT-collect list. Do not release. Call the parent.'
const LOCKED_MSG = 'Locked after 5 wrong codes — use Override.'
const CODE_MISMATCH_MSG = 'Pickup code doesn’t match. Verify with the parent.'
// Names the button the console actually shows in this state — with no code on
// file, `PickupPanel` renders "Issue pickup code", never "Re-send code".
const NO_CODE_MSG = 'No pickup code has been issued for this family — use "Issue pickup code" first.'
const NOT_DROP_OFF_MSG = "This event isn't drop-off — there's nothing to check out."
const NO_EVENT_MSG = 'Couldn’t confirm this event — refresh the roster and try again.'

/** Case-insensitive, trimmed, EXACT match against a confirmed-pickup chip or
 *  the signer's own name — the "known collector" gate (HOM-214). */
function isKnownCollector(name: string, confirmedPickup: AuthorizedPickup[], signerName: string): boolean {
  const n = name.trim().toLowerCase()
  if (!n) return false
  if (signerName && n === signerName.trim().toLowerCase()) return true
  return confirmedPickup.some((p) => p.name.trim().toLowerCase() === n)
}

/** Lowercase, collapse all whitespace (spaces/tabs/newlines, including
 *  doubled-up runs) to one space, and drop punctuation that doesn't change
 *  who's being named ("R. Smith" vs "R Smith", "O'Brien" vs "OBrien") —
 *  shared normalization for the may-NOT-collect fuzzy match (fix round 1,
 *  Critical 1: a doubled space or stray tab was defeating the match). */
function normalizeForMatch(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[.,'’-]/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * Whole-word fuzzy match on the normalized names — the may-NOT-collect gate
 * (HOM-214). Matches when the normalized strings are equal outright, or when
 * every WORD of the shorter name is also a whole word in the longer one.
 * Deliberately word-boundary rather than plain substring (fix round 1
 * addendum, finding 8): a raw substring check let 'patrick smith'.includes
 * ('rick') refuse a legitimate "Rick" forever. Word tokens fix that
 * ("rick" is not a whole word in "patrick smith") while still catching the
 * cases that matter: "rick smith" vs "Rick  Smith" (whitespace only), "R
 * Smith" vs "R. Smith" (punctuation only), and a surname-only entry like
 * "Smith" against a full "Rick Smith" — staff who only wrote down the last
 * name still meant to block that whole family, so a bare surname keeps
 * refusing on purpose.
 */
function fuzzyMatchesNotAuthorized(name: string, notAuthorized: string): boolean {
  const n = normalizeForMatch(name)
  const na = normalizeForMatch(notAuthorized)
  if (!n || !na) return false
  if (n === na) return true
  const nWords = n.split(' ')
  const naWords = na.split(' ')
  const [shorter, longer] = nWords.length <= naWords.length ? [nWords, naWords] : [naWords, nWords]
  return shorter.every((w) => longer.includes(w))
}

/**
 * Staff-only per-person check-in/pickup for a household at an event.
 * POST { kind, id, recordId, action, day?, ...} — `party` is accepted as a
 * legacy alias for `{ kind: 'party', id: party }`.
 *   action: 'checkin' | 'undo-checkin' | 'pickup' | 'pickup-override' | 'undo-pickup' | 'reissue-code' | 'set-pickup'
 *   checkin:      { personIds: string[] }   — mark these people present (on `day`)
 *   undo-checkin: { personIds?: string[] }  — clear presence on `day` (all if omitted)
 *   pickup:       { personIds: string[], code, collectedBy, idChecked? } —
 *     code + a known/ID-checked collectedBy required if a child is leaving a
 *     drop-off event (HOM-214).
 *   pickup-override: { personIds, collectedBy, reason: 'called-parent' | 'parent-present' | 'other', reasonText?, idChecked? } —
 *     releases without a code (drop-off only); clears any lockout (HOM-214).
 *   undo-pickup:  { personIds?: string[] }  — reverse a pickup on `day` (all if omitted)
 *   set-pickup:   { confirmedPickup: {name, phone}[] }
 *   reissue-code: { reason: string }  — rotate the pickup code (drop-off events only,
 *     works even if no code was issued yet); `reason` is required and logged (HOM-214).
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

  // Read the event + waiver once before the mutation callback — neither
  // changes within a request, and it avoids async lookups inside the
  // optimistic-concurrency retry loop. The waiver gives us the signer's name
  // (for the "known collector" match) and phone (for every SMS in this file).
  let studioEvent = null
  let waiverRecord: WaiverRecord | null = null
  try {
    studioEvent = await getEvent(kind as EventKind, id)
    waiverRecord = await getWaiverRecord(recordId)
  } catch (err) {
    logger.error('Event/waiver lookup failed', { error: String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t reach storage — check wifi and try again.' }), { status: 503 })
  }
  // A `null` event is NOT "a non-drop-off event" — it's an event we couldn't
  // resolve. Falling through with `dropOff = false` silently disabled the
  // entire pickup gate (no code, no collector match, no may-NOT-collect
  // check) and would hand a child to whoever asked. Refuse every action until
  // staff can see the event again.
  if (!studioEvent) {
    logger.error('Event could not be resolved — refusing action', { kind, id, action })
    return new Response(JSON.stringify({ error: NO_EVENT_MSG }), { status: 404 })
  }
  const dropOff = !!studioEvent.dropOff
  const signerName = waiverRecord ? `${waiverRecord.adult.firstName} ${waiverRecord.adult.lastName}`.trim() : ''
  const signerPhone = waiverRecord?.adult.phone ?? ''

  const requestedDay = typeof body?.day === 'string' && DAY_RE.test(body.day) ? body.day : null
  const day = resolveEventDay(studioEvent, requestedDay)

  if (action !== 'checkin' && action !== 'undo-checkin' && action !== 'pickup' && action !== 'pickup-override' &&
      action !== 'undo-pickup' && action !== 'reissue-code' && action !== 'set-pickup') {
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 })
  }

  const CHECKOUT_ACTIONS = ['pickup', 'undo-pickup', 'pickup-override', 'reissue-code', 'set-pickup']
  if (!dropOff && CHECKOUT_ACTIONS.includes(action)) {
    return new Response(JSON.stringify({ error: NOT_DROP_OFF_MSG }), { status: 400 })
  }

  const evKey = eventKey(kind as EventKind, id)

  // Plaintext code is shown to the caller exactly once (never persisted).
  // denyReason/denyStatus are set inside the callback to signal validation
  // failures that still need the event to commit (e.g. pickup-denied, locked).
  // releasedKidIds/releaseCollectedBy/releaseAt capture what to text the
  // parent AFTER the mutation commits — sending SMS is a real side effect,
  // so it must happen exactly once, outside the retry loop, never inside it.
  let oneTimeCode: string | null = null
  let denyReason: string | null = null
  let denyStatus = 400
  let releasedKidIds: string[] = []
  let releaseCollectedBy = ''
  let releaseAt = ''

  let finalState: CheckinState

  try {
    finalState = await mutateCheckin(evKey, recordId, async (state) => {
      // Reset closure variables at the top of each callback invocation so
      // retries don't leak stale values from a previous (failed) attempt.
      oneTimeCode = null
      denyReason = null
      denyStatus = 400
      releasedKidIds = []
      releaseCollectedBy = ''
      releaseAt = ''

      const nowIso = new Date().toISOString()
      const dayState = (state.days[day] ??= { presence: {} })

      switch (action) {
        case 'checkin': {
          // Mark the selected people present. Whoever staff picked is who's here —
          // the RSVP only pre-selected; a late-arriving sibling can be added now.
          // Shared with rsvp.json ("+ Add family") via @lib/checkin-actions.
          const ids = asIds(body?.personIds)
          if (ids.length === 0) {
            denyReason = 'No one selected to check in.'
            return
          }
          oneTimeCode = (await applyPresent(state, { event: studioEvent!, kind: kind as EventKind, id, recordId, waiverRecord, personIds: ids, day, by })).oneTimeCode
          break
        }

        case 'reissue-code': {
          const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
          if (!reason) {
            denyReason = 'Tell us why — pick a reason to resend the code.'
            return
          }
          // Works whether or not a code already exists — fixes the dead-end when
          // drop-off was toggled ON after kids were already checked in with no code.
          // Toggling drop-off OFF leaves any pickupCodeHash in place — harmless,
          // the pickup gate is dropOff-scoped.
          const isRotation = !!state.pickupCodeHash
          const wasLocked = !!state.lockedAt
          oneTimeCode = newCode()
          state.pickupCodeHash = hashCode(oneTimeCode)
          // A fresh code means a fresh set of attempts — clear any lockout.
          state.codeAttempts = 0
          state.lockedAt = null
          state.events.push({ at: nowIso, action: 'reissue-code', personIds: [], note: isRotation ? 'rotated' : 'first issue', reason, day, by })
          if (wasLocked) state.events.push({ at: nowIso, action: 'unlocked', personIds: [], day, by })
          // 'code-sent' is logged AFTER the SMS is actually attempted (fix
          // round 1 addendum, finding 5) — see the post-mutation SMS block.
          break
        }

        case 'undo-checkin': {
          const ids = asIds(body?.personIds)
          const prevPresence = { ...dayState.presence }
          const wasLocked = !!state.lockedAt
          if (ids.length === 0) dayState.presence = {}
          else for (const id of ids) delete dayState.presence[id]
          const clearedIds = ids.length === 0 ? Object.keys(prevPresence) : ids
          for (const id of clearedIds) delete state.releasedTo[id]
          // No one left on-site FOR THIS DAY, and this is the event's last
          // day → retire the code and pickup note. Otherwise keep it — a
          // multi-day camp still needs it tomorrow.
          if (Object.keys(dayState.presence).length === 0 && isLastEventDay(studioEvent, day)) {
            state.pickupCodeHash = null
            state.pickedUpBy = null
            state.codeAttempts = 0
            state.lockedAt = null
          }
          const clearedPresence = Object.fromEntries(clearedIds.filter((id) => prevPresence[id]).map((id) => [id, prevPresence[id]]))
          state.events.push({ at: nowIso, action: 'undo-checkin', personIds: clearedIds, clearedPresence, day, by })
          // A Reset can silently clear an active lockout (fix round 1
          // addendum, finding 6) — log it so the audit trail shows the lock
          // was lifted and why, same as reissue-code's own 'unlocked' event.
          if (wasLocked && !state.lockedAt) {
            state.events.push({ at: nowIso, action: 'unlocked', personIds: [], note: 'reset via undo-checkin', day, by })
          }
          break
        }

        case 'set-pickup': {
          // Log what actually changed (fix round 1 addendum, finding 7) —
          // 'set-pickup' previously logged nothing about the edit itself.
          const before = state.confirmedPickup.map((p) => p.name).join(', ') || '(none)'
          state.confirmedPickup = normalizeAuthorizedPickup(body?.confirmedPickup)
          // A staff edit IS the seed from here on — never re-derive from the
          // waiver again, even if they cleared the list to empty.
          state.pickupSeeded = true
          const after = state.confirmedPickup.map((p) => p.name).join(', ') || '(none)'
          state.events.push({ at: nowIso, action: 'set-pickup', personIds: [], note: `${before} → ${after}`, day, by })
          break
        }

        case 'pickup': {
          const ids = asIds(body?.personIds).filter((id) => dayState.presence[id] && !dayState.presence[id].outAt)
          if (ids.length === 0) {
            denyReason = 'No one here to check out.'
            return
          }
          const collectedBy = typeof body?.collectedBy === 'string' ? body.collectedBy.trim() : ''
          const idChecked = !!body?.idChecked

          // The code is the authorization gate for releasing a CHILD from a drop-off
          // event — whoever holds it was given it by the parent. Adults (or
          // non-drop-off) need no code and none of the collector-matching rules apply.
          if (dropOff && ids.some(isChild)) {
            // A name is required to release a child — mirrors pickup-override's
            // own required-collectedBy check (fix round 1, Important 3: a blank
            // name + idChecked:true was slipping past the "known collector" gate
            // below, since an empty string can never MATCH a chip, but also never
            // fails to match one when idChecked is already true).
            if (!collectedBy) {
              denyReason = 'Who’s collecting? Pick a name or type one.'
              return
            }
            // The may-NOT-collect note always wins, even over a checked photo ID.
            if (state.notAuthorized && fuzzyMatchesNotAuthorized(collectedBy, state.notAuthorized)) {
              denyReason = NOT_AUTHORIZED_MSG
              state.events.push({ at: nowIso, action: 'pickup-denied', personIds: ids, reason: 'not-authorized', day, by })
              return
            }
            if (state.lockedAt) {
              denyReason = LOCKED_MSG
              denyStatus = 423
              return
            }
            if (!isKnownCollector(collectedBy, state.confirmedPickup, signerName) && !idChecked) {
              denyReason = NOT_ON_LIST_MSG
              return
            }
            const code = typeof body?.code === 'string' ? body.code.trim() : ''
            if (!state.pickupCodeHash) {
              denyReason = NO_CODE_MSG
              state.events.push({ at: nowIso, action: 'pickup-denied', personIds: ids, note: 'no code issued', day, by })
              return
            }
            if (hashCode(code) !== state.pickupCodeHash) {
              state.codeAttempts += 1
              if (state.codeAttempts >= 5) {
                state.lockedAt = nowIso
                state.events.push({ at: nowIso, action: 'locked', personIds: ids, day, by })
                denyReason = LOCKED_MSG
                denyStatus = 423
                return
              }
              denyReason = CODE_MISMATCH_MSG
              state.events.push({ at: nowIso, action: 'pickup-denied', personIds: ids, reason: 'code-mismatch', day, by })
              return
            }
            state.codeAttempts = 0
          }

          for (const id of ids) {
            dayState.presence[id] = { ...dayState.presence[id], outAt: nowIso }
            // Adults/non-drop-off leave `collectedBy` optional (§8) — don't
            // write a placeholder "who collected" entry when no one gave a
            // name (fix round 1 addendum, finding 9).
            if (collectedBy) state.releasedTo[id] = { name: collectedBy, at: nowIso, day }
          }
          if (dropOff && ids.some(isChild)) {
            releasedKidIds = ids.filter(isChild)
            releaseCollectedBy = collectedBy
            releaseAt = nowIso
          }
          // Once every child on THIS day has been collected, and this is the
          // event's last day, the family code is spent. A multi-day camp
          // keeps it live overnight for tomorrow's drop-off.
          if (dropOff && !childStillHere(state, day) && isLastEventDay(studioEvent, day)) state.pickupCodeHash = null
          state.events.push({ at: nowIso, action: 'pickup', personIds: ids, collectedBy, idChecked, day, by })
          break
        }

        case 'pickup-override': {
          const ids = asIds(body?.personIds).filter((id) => dayState.presence[id] && !dayState.presence[id].outAt)
          if (ids.length === 0) {
            denyReason = 'No one here to check out.'
            return
          }
          const collectedBy = typeof body?.collectedBy === 'string' ? body.collectedBy.trim() : ''
          const reasonCode = typeof body?.reason === 'string' ? body.reason : ''
          const reasonText = typeof body?.reasonText === 'string' ? body.reasonText.trim() : ''
          const idChecked = !!body?.idChecked

          if (!OVERRIDE_REASON_RE.test(reasonCode)) {
            denyReason = 'Pick a reason for the override.'
            return
          }
          if (reasonCode === 'other' && reasonText.length < 5) {
            denyReason = 'Say a bit more about why — at least 5 characters.'
            return
          }
          if (!collectedBy) {
            denyReason = 'Who’s collecting? Enter a name.'
            return
          }
          // The may-NOT-collect note applies even on an override — this is the
          // one rule an override can never bypass.
          if (state.notAuthorized && fuzzyMatchesNotAuthorized(collectedBy, state.notAuthorized)) {
            denyReason = NOT_AUTHORIZED_MSG
            state.events.push({ at: nowIso, action: 'pickup-denied', personIds: ids, reason: 'not-authorized', day, by })
            return
          }

          const wasLocked = !!state.lockedAt
          for (const id of ids) {
            dayState.presence[id] = { ...dayState.presence[id], outAt: nowIso }
            state.releasedTo[id] = { name: collectedBy, at: nowIso, day }
          }
          state.codeAttempts = 0
          state.lockedAt = null
          releasedKidIds = ids.filter(isChild)
          releaseCollectedBy = collectedBy
          releaseAt = nowIso
          if (!childStillHere(state, day) && isLastEventDay(studioEvent, day)) state.pickupCodeHash = null
          const note = reasonCode === 'other' ? `other: ${reasonText}` : reasonCode
          state.events.push({ at: nowIso, action: 'pickup-override', personIds: ids, collectedBy, idChecked, reason: reasonCode, note, day, by })
          // An override silently lifted an active lockout — log it the same
          // way `reissue-code` and `undo-checkin` do, so the audit trail never
          // has a lock that just disappears.
          if (wasLocked) {
            state.events.push({ at: nowIso, action: 'unlocked', personIds: [], note: 'cleared by override', day, by })
          }
          break
        }

        case 'undo-pickup': {
          const ids = asIds(body?.personIds)
          const targets = ids.length ? ids : Object.keys(dayState.presence)
          for (const id of targets) {
            if (dayState.presence[id]) dayState.presence[id] = { ...dayState.presence[id], outAt: null }
            delete state.releasedTo[id]
          }
          // A child is back on-site but the code was spent → re-issue so pickup works.
          if (dropOff && childStillHere(state, day) && !state.pickupCodeHash) {
            oneTimeCode = newCode()
            state.pickupCodeHash = hashCode(oneTimeCode)
            // 'code-sent' is logged AFTER the SMS is actually attempted
            // (fix round 1 addendum, finding 5) — see the post-mutation
            // SMS block below.
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
    // A refused pickup (wrong code, lockout, not on the list) is the custody
    // event most worth checking afterward, so it goes in the audit log too.
    if (action === 'pickup' || action === 'pickup-override') {
      await recordAudit({
        by: staff,
        action: 'custody.refused',
        target: { kind: 'household', id: recordId, ...(waiverRecord ? { label: signerName } : {}) },
        details: { eventKind: kind, eventId: id, day, attempted: action, reason: denyReason },
        ...(paymentBypassEnabled(request) ? { simulated: true as const } : {}),
      })
    }
    // Carry the live checkin state along with the denial (fix round 1,
    // Important 4) — a wrong-code/lock/not-authorized response still
    // committed mutations to `finalState` (codeAttempts++, lockedAt, …), and
    // without this the console's tries-left/locked UI wouldn't reflect them
    // until the next 30s poll. Top-level, not nested under `data`, matching
    // every other error body in this endpoint.
    return new Response(
      JSON.stringify({ error: denyReason, checkin: toPublicCheckin(finalState!), day }),
      { status: denyStatus },
    )
  }

  // SMS side effects happen exactly once here, AFTER the mutation committed —
  // never inside the callback above, which can re-run on an optimistic-
  // concurrency retry. Never blocks the response: a Quo outage still lets
  // check-in/pickup succeed, just with `smsFailed: true` (HOM-214).
  let smsFailed = false
  if (oneTimeCode) {
    const sent = await sendPickupCode({ event: studioEvent, kind: kind as EventKind, id, recordId, waiverRecord, day, by }, oneTimeCode)
    if (sent.smsFailed) smsFailed = true
  }
  if (releasedKidIds.length > 0) {
    try {
      await sendQuoText({
        to: signerPhone,
        content: pickedUpText(kidNames(waiverRecord, releasedKidIds), releaseCollectedBy, formatTime(releaseAt)),
      })
    } catch (err) {
      logger.error('Pickup-confirmation text failed', { error: err instanceof Error ? err.message : String(err) })
      smsFailed = true
    }
  }

  const AUDIT_ACTION: Record<string, string> = {
    checkin: 'checkin.here',
    'undo-checkin': 'checkin.undone',
    pickup: 'checkin.out',
    'undo-pickup': 'checkin.out-undone',
    'pickup-override': 'custody.override',
    'set-pickup': 'pickup-list.set',
    'reissue-code': 'pickup-code.reissued',
  }
  const collectedByAudit = typeof body?.collectedBy === 'string' ? body.collectedBy.trim() : ''
  await recordAudit({
    by: staff,
    action: AUDIT_ACTION[action],
    target: {
      kind: 'household',
      id: recordId,
      ...(waiverRecord ? { label: signerName } : {}),
    },
    details: {
      eventKind: kind,
      eventId: id,
      day,
      ...(asIds(body?.personIds).length ? { people: asIds(body?.personIds).length } : {}),
      ...(action === 'pickup' || action === 'pickup-override' ? { collectedBy: collectedByAudit || null, idChecked: !!body?.idChecked } : {}),
      ...(action === 'pickup-override' ? { reason: typeof body?.reason === 'string' ? body.reason : null } : {}),
      ...(action === 'reissue-code' ? { reason: typeof body?.reason === 'string' ? body.reason.trim() : null } : {}),
    },
    ...(paymentBypassEnabled(request) ? { simulated: true as const } : {}),
  })

  return new Response(
    JSON.stringify({
      data: {
        checkin: toPublicCheckin(finalState!),
        day,
        ...(oneTimeCode ? { oneTimeCode } : {}),
        ...(smsFailed ? { smsFailed: true } : {}),
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
