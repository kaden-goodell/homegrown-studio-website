import type { APIRoute } from 'astro'
import { createHash } from 'node:crypto'
import { providers } from '@config/providers'
import { waiverContent, serializeAgreement, substantiveSince, compareVersions } from '@config/waiver-content'
import {
  saveWaiverRecord,
  getWaiverRecord,
  newWaiverId,
  upsertWaiverInEventIndex,
  indexWaiverByContact,
  type WaiverRecord,
  type AuthorizedPickup,
} from '@lib/waiver-store'
import { upsertRsvp, getRsvp, type RsvpRecord } from '@lib/rsvp-store'
import { setExpected, getCheckin, mutateCheckin } from '@lib/checkin-store'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { verifyReuseToken } from '@lib/reuse-token'
import { getEvent, isEventPast, type EventKind as StudioEventKind, type StudioEvent } from '@lib/events'
import { sendAgreementCopyEmail, sendDropOffDetailsEmail } from '@lib/email'

export const prerender = false

const logger = createLogger('api:waiver:sign')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Signatures only ever attach to a party or a workshop (never the wider
 * `StudioEventKind`'s 'program' — programs aren't wired to /waiver). Narrower
 * than `StudioEventKind` so it's also a subtype of `@lib/waiver-store`'s own
 * `EventKind` ('party' | 'workshop' | 'open-studio') for the event-index calls.
 */
type SignableEventKind = 'party' | 'workshop'

function bad(detail: string, status = 400): Response {
  return new Response(JSON.stringify({ error: detail }), { status })
}

/** 409 — the on-file signature predates a substantive agreement change; the
 *  client must open the full form instead of one-tap RSVPing. */
function mustResign(): Response {
  return new Response(
    JSON.stringify({ error: waiverContent.mustResignNotice, mustResign: true }),
    { status: 409 },
  )
}

function coveredNames(adult: { firstName: string; lastName: string }, minors: { name: string }[]): string[] {
  return [`${adult.firstName} ${adult.lastName}`.trim(), ...minors.map((m) => m.name)]
}

/** Response for a fresh signature (new WaiverRecord just written). */
function okSigned(
  record: WaiverRecord,
  partyId: string | null,
  context: { kind: SignableEventKind; id: string } | null,
): Response {
  return new Response(
    JSON.stringify({
      data: {
        recordId: record.id,
        covered: coveredNames(record.adult, record.minors),
        validUntil: record.validUntil,
        partyId,
        context,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

/** Response for a reuse RSVP (no new signature — the on-file one covers them). */
function okRsvp(source: WaiverRecord, rsvp: RsvpRecord): Response {
  return new Response(
    JSON.stringify({
      data: {
        rsvpId: rsvp.id,
        waiverId: source.id,
        validUntil: source.validUntil,
        covered: coveredNames(source.adult, source.minors),
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

/** Response for a reuse lookup with no event to RSVP to — just confirms coverage. */
function okCovered(source: WaiverRecord): Response {
  return new Response(
    JSON.stringify({
      data: {
        waiverId: source.id,
        validUntil: source.validUntil,
        covered: coveredNames(source.adult, source.minors),
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

/** Cleaned `authorizedPickup`/`notAuthorized` shared by the fresh-sign body
 *  and a reuse RSVP's `pickupUpdate` (HOM-212). */
type PickupInput = { authorizedPickup: AuthorizedPickup[]; notAuthorized: string }

/**
 * Validate + normalize authorized-pickup rows and the "may NOT collect" note
 * (HOM-212). Up to 3 rows, each name ≥2 chars, phone ≥10 digits when given.
 * Drop-off events do NOT require a row — the signer may be the sole collector.
 */
function parsePickupInput(raw: any): { err: Response | null; data: PickupInput } {
  const empty: PickupInput = { authorizedPickup: [], notAuthorized: '' }
  const rowsInput: unknown[] = Array.isArray(raw?.authorizedPickup) ? raw.authorizedPickup : []
  if (rowsInput.length > 3) {
    return { err: bad('You can list up to 3 people for pickup.'), data: empty }
  }
  const authorizedPickup = rowsInput.map((p: any) => ({
    name: String(p?.name ?? '').trim(),
    phone: String(p?.phone ?? '').trim(),
  }))
  for (const p of authorizedPickup) {
    if (p.name.length < 2) {
      return { err: bad('Each pickup name needs at least 2 characters.'), data: empty }
    }
    if (p.phone && p.phone.replace(/\D/g, '').length < 10) {
      return { err: bad('Pickup phone numbers need at least 10 digits.'), data: empty }
    }
  }
  const notAuthorized = String(raw?.notAuthorized ?? '').trim()
  if (notAuthorized.length > 200) {
    return { err: bad("That's a bit long — please keep it under 200 characters."), data: empty }
  }
  return { err: null, data: { authorizedPickup, notAuthorized } }
}

function yearsBetween(dobIso: string, now: Date): number {
  const dob = new Date(`${dobIso}T00:00:00`)
  let years = now.getFullYear() - dob.getFullYear()
  const anniversary = new Date(dob)
  anniversary.setFullYear(now.getFullYear())
  if (now < anniversary) years--
  return years
}

/**
 * Fire the "here's your copy" email (HOM-216) without blocking the response
 * — a thrown or rejected send must never fail the signature/RSVP that's
 * already saved. `.catch` alone isn't enough (a synchronous throw from a
 * bad mock/impl would escape before it attaches), so this wraps the whole
 * call in an async IIFE.
 */
function fireAgreementCopyEmail(input: Parameters<typeof sendAgreementCopyEmail>[0], recordId: string): void {
  void (async () => {
    try {
      await sendAgreementCopyEmail(input)
    } catch (err) {
      logger.error('Agreement copy email failed (record saved)', { id: recordId, error: String(err) })
    }
  })()
}

/** Same contract as `fireAgreementCopyEmail`, for the drop-off details email. */
function fireDropOffDetailsEmail(input: Parameters<typeof sendDropOffDetailsEmail>[0], recordId: string): void {
  void (async () => {
    try {
      await sendDropOffDetailsEmail(input)
    } catch (err) {
      logger.error('Drop-off details email failed (RSVP saved)', { id: recordId, error: String(err) })
    }
  })()
}

/** Save the signature + update the contact index. Event attachment (roster,
 *  RSVP) is separate — see `indexEventRsvp` — a signature no longer carries
 *  its event (HOM-210). */
async function persistWaiver(record: WaiverRecord): Promise<void> {
  await saveWaiverRecord(record)
  try {
    await indexWaiverByContact(record)
  } catch (err) {
    logger.error('Contact index failed (signature saved)', { id: record.id, error: String(err) })
  }
}

/**
 * Attach a household (by waiver id) to an event's roster, and carry forward
 * check-in state when this waiver id replaces a different one for the same
 * household at this event (a family re-signs or re-affirms under a
 * different signature and the earlier check-in must follow them). Shared by
 * fresh-in-context signs and reuse RSVPs — either can change which waiver
 * id is now canonical for a household at an event.
 */
async function indexEventRsvp(kind: SignableEventKind, id: string, record: WaiverRecord, rsvpId: string): Promise<void> {
  try {
    const { replacedRecordId } = await upsertWaiverInEventIndex(kind, id, record, rsvpId)
    // Checkin migration is party-only — check-in state lives in the party domain.
    if (replacedRecordId && kind === 'party') {
      try {
        const old = await getCheckin(id, replacedRecordId)
        const hadAnyPresence = Object.values(old.days).some((d) => Object.keys(d.presence).length > 0)
        if (hadAnyPresence || old.pickupCodeHash) {
          await mutateCheckin(id, record.id, (s) => { Object.assign(s, old) })
        }
      } catch (err) {
        logger.error('Checkin migration failed on re-RSVP', { error: String(err) })
      }
    }
  } catch (err) {
    logger.error('Event index failed (signature saved)', { id: record.id, error: String(err) })
  }
}

/** Resolve which person ids ('adult', 'child:N') a client said are attending,
 *  filtered to ids that actually exist on this household. No selection = everyone. */
function resolveAttending(attendingRaw: unknown, validIds: Set<string>): string[] {
  return Array.isArray(attendingRaw)
    ? [...new Set(attendingRaw.map(String))].filter((id) => validIds.has(id))
    : [...validIds]
}

/**
 * Legacy "who's coming" mirror on the checkin record — still read by
 * checkin-store consumers pending Task 7's rework. Superseded going forward
 * by `RsvpRecord.attending`, but kept in sync here so nothing regresses.
 */
async function recordExpected(partyId: string | null, waiverId: string, ids: string[]): Promise<void> {
  if (!partyId) return
  try {
    await setExpected(partyId, waiverId, ids)
  } catch (err) {
    logger.error('Expected-attendance write failed (signature saved)', { id: waiverId, error: String(err) })
  }
}

/** Best-effort: attach to Square customer + write a POS-visible safety note.
 *  Signature-specific — runs once, on the sign that creates the record;
 *  never on a reuse RSVP (which creates no new signature to attach). */
async function attachSquare(record: WaiverRecord): Promise<void> {
  try {
    const customer = await providers.customer.findOrCreate({
      email: record.adult.email,
      givenName: record.adult.firstName,
      familyName: record.adult.lastName,
      phone: record.adult.phone,
    })
    const signedDate = record.signedAt.slice(0, 10)
    const photoFlag = record.photoConsent ? 'photo:yes' : 'photo:no'
    const kids = record.minors.length ? ` kids:${record.minors.length}` : ''
    // Per-person allergies rolled up for the POS note.
    const allergyLines = [
      record.adult.allergies ? `${record.adult.firstName}: ${record.adult.allergies}` : '',
      ...record.minors.map((m) => (m.allergies ? `${m.name}: ${m.allergies}` : '')),
    ].filter(Boolean)
    const medicationLines = record.minors
      .map((m) => (m.medications ? `${m.name}: ${m.medications}` : ''))
      .filter(Boolean)
    const pickupNames = record.authorizedPickup
      .map((p) => (p.phone ? `${p.name} (${p.phone})` : p.name))
      .join(', ')
    const safety = [
      allergyLines.length ? `Allergies — ${allergyLines.join('; ')}` : 'Allergies: none noted',
      medicationLines.length ? `Medications — ${medicationLines.join('; ')}` : '',
      `Emergency: ${record.emergency.name} ${record.emergency.phone}`,
      pickupNames ? `Pickup: ${pickupNames}` : '',
      record.notAuthorized ? `⛔ NOT authorized: ${record.notAuthorized}` : '',
    ].filter(Boolean).join(' · ')
    await providers.customer.appendNote(
      customer.id,
      `waiver:${record.agreementVersion}:${signedDate}:${record.id} ${photoFlag}${kids}\n${safety}`,
    )
    await saveWaiverRecord({ ...record, squareCustomerId: customer.id })
  } catch (err) {
    logger.error('Customer attach failed (signature is stored)', { id: record.id, error: String(err) })
  }
}

/**
 * Validate that a party/workshop event link (via `getEvent`) is real and not
 * already past. Returns `{ event }` when kind/id are absent (general
 * agreement, no event context) or when the event checks out. A storage
 * error FAILS CLOSED (503) rather than letting the RSVP through unvalidated
 * (HOM-219 M10).
 */
async function validateEvent(
  kind: StudioEventKind | null,
  id: string | null,
  now: Date,
): Promise<{ err: Response | null; event: StudioEvent | null }> {
  if (!kind || !id) return { err: null, event: null }
  let event: StudioEvent | null
  try {
    event = await getEvent(kind, id)
  } catch (err) {
    logger.error('Event validation error — failing closed', { kind, id, error: String(err) })
    return { err: bad("Couldn't reach storage — try again.", 503), event: null }
  }
  if (!event) {
    return { err: bad("We couldn't find that event link.", 404), event: null }
  }
  // A full studio day of grace past the event's last day before it's "past".
  if (isEventPast(event, now)) {
    return { err: bad('That event has already happened.', 410), event: null }
  }
  return { err: null, event }
}

/**
 * Enforce: when a party RSVP has children crafting but the signer (adult) is
 * not in the attending list, require a responsible adult name. Skipped for
 * studio-run drop-off events (camps/PNO) — those have their own check-in and
 * pickup-code procedures.
 */
function checkResponsibleAdult(
  partyId: string | null,
  dropOff: boolean,
  resolvedIds: string[],
  responsibleAdult: string,
): Response | null {
  if (!partyId || dropOff) return null
  const hasKids = resolvedIds.some((id) => id.startsWith('child:'))
  const adultPresent = resolvedIds.includes('adult')
  if (hasKids && !adultPresent) {
    if (!responsibleAdult) {
      return bad("Every child needs an adult at the party — tell us who'll be with yours.")
    }
  }
  return null
}

/**
 * Returning customer: RSVP by reusing an on-file household — no re-fill, and
 * (HOM-210) no new signature. The on-file WaiverRecord is never touched;
 * only a new/updated RsvpRecord is written.
 */
async function handleReuse(
  reuseId: string,
  reuseToken: string,
  partyId: string | null,
  workshopId: string | null,
  bookingId: string | null,
  attendingRaw: unknown,
  responsibleAdult: string,
  pickupUpdateRaw: unknown,
  now: Date,
  clientAddress: string | undefined,
  userAgent: string | null,
): Promise<Response> {
  if (!verifyReuseToken(reuseId, reuseToken)) {
    return bad("That session expired — look yourself up again to RSVP.", 401)
  }

  // Compact "Who may pick up?" block on the returning screen (HOM-212) —
  // only sent when the on-file signature had no pickup rows. Stored on the
  // RSVP, never on the immutable signature (HOM-210).
  let pickup: PickupInput | null = null
  if (pickupUpdateRaw && typeof pickupUpdateRaw === 'object') {
    const { err: pickupErr, data } = parsePickupInput(pickupUpdateRaw)
    if (pickupErr) return pickupErr
    pickup = data
  }

  const eventKind: SignableEventKind | null = partyId ? 'party' : workshopId ? 'workshop' : null
  const { err: eventErr, event } = await validateEvent(eventKind, partyId ?? workshopId, now)
  if (eventErr) return eventErr
  const dropOff = !!event?.dropOff

  const source = await getWaiverRecord(reuseId)
  if (!source) return bad("We couldn't find your agreement — please fill out the form.")
  if (new Date(source.validUntil).getTime() <= now.getTime()) {
    return bad("Your agreement has expired — please sign a new one.")
  }
  // The agreement text has changed substantively since this household last
  // signed — cloning it forward (the old behavior) is exactly what HOM-210
  // removes. Force a full re-sign instead.
  if (compareVersions(source.agreementVersion, substantiveSince) < 0) {
    return mustResign()
  }

  if (!eventKind) {
    // General re-affirmation with nothing to RSVP to — the on-file signature
    // already covers them; nothing new to write.
    logger.info('Reuse lookup confirmed (no event context)', { waiverId: source.id })
    return okCovered(source)
  }

  const eventId = (partyId ?? workshopId)!
  const validIds = new Set(['adult', ...source.minors.map((_, i) => `child:${i}`)])
  const resolvedIds = resolveAttending(attendingRaw, validIds)

  // A re-RSVP (e.g. just changing headcount) with no pickupUpdate must never
  // silently erase a pickup override saved on an earlier RSVP for this same
  // event — upsertRsvp fully replaces the record, so carry the existing
  // pickup forward when the client didn't send a new one (fix round 1).
  if (!pickup) {
    const existingRsvp = await getRsvp(eventKind, eventId, source.id)
    if (existingRsvp?.pickup) pickup = existingRsvp.pickup
  }

  const raErr = checkResponsibleAdult(partyId, dropOff, resolvedIds, responsibleAdult)
  if (raErr) return raErr

  const rsvp = await upsertRsvp({
    waiverId: source.id,
    event: { kind: eventKind, id: eventId },
    ...(bookingId ? { ref: { bookingId } } : {}),
    attending: resolvedIds,
    responsibleAdult: responsibleAdult || null,
    ...(pickup ? { pickup } : {}),
    at: now.toISOString(),
    ip: clientAddress ?? null,
    userAgent,
  })
  await recordExpected(partyId, source.id, resolvedIds)
  await indexEventRsvp(eventKind, eventId, source, rsvp.id)

  if (dropOff && event) {
    fireDropOffDetailsEmail(
      { record: source, event, attending: resolvedIds, ...(pickup ? { authorizedPickup: pickup.authorizedPickup } : {}) },
      source.id,
    )
  }

  logger.info('RSVP via reuse', { waiverId: source.id, rsvpId: rsvp.id, partyId, workshopId })
  return okRsvp(source, rsvp)
}

/**
 * Fresh signature: full form submitted, `agreeRelease === true`, a typed
 * signature. Always writes a new WaiverRecord; writes an RsvpRecord too when
 * signing in an event context (party or workshop).
 */
async function handleFresh(
  body: any,
  partyId: string | null,
  workshopId: string | null,
  bookingId: string | null,
  responsibleAdult: string,
  now: Date,
  clientAddress: string | undefined,
  userAgent: string | null,
): Promise<Response> {
  const adult = body.adult ?? {}
  const firstName = String(adult.firstName ?? '').trim()
  const lastName = String(adult.lastName ?? '').trim()
  const email = String(adult.email ?? '').trim()
  const phone = String(adult.phone ?? '').trim()
  const dob = String(adult.dob ?? '').trim()

  if (!firstName || !lastName) return bad('Please enter your full name.')
  if (!EMAIL_RE.test(email)) return bad('Please enter a valid email address.')
  if (phone.replace(/\D/g, '').length < 10) return bad('Please enter a valid phone number.')
  if (!DATE_RE.test(dob)) return bad('Please enter your date of birth.')

  const age = yearsBetween(dob, now)
  if (age < waiverContent.adultAge) {
    return bad(`The signing adult must be at least ${waiverContent.adultAge} years old.`)
  }
  if (age > 120) return bad('Please check your date of birth.')

  const minorsInput: unknown[] = Array.isArray(body.minors) ? body.minors : []
  if (minorsInput.length > 12) return bad('Too many children listed — please contact the studio.')
  const minors = minorsInput.map((m: any) => ({
    name: String(m?.name ?? '').trim(),
    dob: String(m?.dob ?? '').trim(),
    allergies: String(m?.allergies ?? '').trim(),
    medications: String(m?.medications ?? '').trim(),
  }))
  for (const m of minors) {
    if (!m.name || !DATE_RE.test(m.dob)) return bad('Each child needs a name and date of birth.')
    if (yearsBetween(m.dob, now) >= waiverContent.adultAge) {
      return bad(`${m.name} is ${waiverContent.adultAge} or older and needs to sign their own agreement.`)
    }
    if (m.medications.length > 300) {
      return bad("That's a bit long — please keep it under 300 characters.")
    }
  }

  const emergency = body.emergency ?? {}
  const emergencyName = String(emergency.name ?? '').trim()
  const emergencyPhone = String(emergency.phone ?? '').trim()
  const emergencyRelationship = String(emergency.relationship ?? '').trim()
  if (!emergencyName || emergencyPhone.replace(/\D/g, '').length < 10) {
    return bad('Please add an emergency contact name and phone number.')
  }

  // Authorized pickup + "may NOT collect" (HOM-212). Rendered client-side
  // only for drop-off events, but validated here regardless — a drop-off
  // event with zero rows is fine (the signer may be the only collector).
  const { err: pickupErr, data: pickupData } = parsePickupInput(body)
  if (pickupErr) return pickupErr

  if (typeof body.photoConsent !== 'boolean') {
    return bad('Please choose a photo preference — either answer is fine.')
  }
  if (body.agreeRelease !== true) return bad('Please read and accept the agreement to continue.')

  const signature = String(body.signature ?? '').trim()
  const fullName = `${firstName} ${lastName}`
  if (signature.toLowerCase().replace(/\s+/g, ' ') !== fullName.toLowerCase().replace(/\s+/g, ' ')) {
    return bad(`To sign, type your name exactly as entered above: “${fullName}”.`)
  }

  const eventKind: SignableEventKind | null = partyId ? 'party' : workshopId ? 'workshop' : null
  const { err: eventErr, event } = await validateEvent(eventKind, partyId ?? workshopId, now)
  if (eventErr) return eventErr
  const dropOff = !!event?.dropOff

  const freshValidIds = new Set(['adult', ...minors.map((_, i) => `child:${i}`)])
  const freshResolvedIds = resolveAttending(body.attending, freshValidIds)
  const freshRaErr = checkResponsibleAdult(partyId, dropOff, freshResolvedIds, responsibleAdult)
  if (freshRaErr) return freshRaErr

  const validUntil = new Date(now)
  validUntil.setMonth(validUntil.getMonth() + waiverContent.validityMonths)

  const record: WaiverRecord = {
    id: newWaiverId(),
    agreementVersion: waiverContent.version,
    agreementSha256: createHash('sha256').update(serializeAgreement(), 'utf8').digest('hex'),
    signedAt: now.toISOString(),
    validUntil: validUntil.toISOString(),
    adult: { firstName, lastName, email, phone, dob, allergies: String(body.adultAllergies ?? '').trim() },
    minors,
    emergency: { name: emergencyName, phone: emergencyPhone, relationship: emergencyRelationship },
    authorizedPickup: pickupData.authorizedPickup,
    notAuthorized: pickupData.notAuthorized,
    photoConsent: body.photoConsent,
    signature,
    squareCustomerId: null,
    ip: clientAddress ?? null,
    userAgent,
  }

  await persistWaiver(record)

  // Every fresh signature gets an emailed copy (HOM-216) — fire-and-forget,
  // never blocks or fails the save.
  fireAgreementCopyEmail({ record }, record.id)

  const eventId = partyId ?? workshopId
  let context: { kind: SignableEventKind; id: string } | null = null
  if (eventKind && eventId) {
    context = { kind: eventKind, id: eventId }
    const rsvp = await upsertRsvp({
      waiverId: record.id,
      event: { kind: eventKind, id: eventId },
      ...(bookingId ? { ref: { bookingId } } : {}),
      attending: freshResolvedIds,
      responsibleAdult: responsibleAdult || null,
      at: now.toISOString(),
      ip: clientAddress ?? null,
      userAgent,
    })
    await recordExpected(partyId, record.id, freshResolvedIds)
    await indexEventRsvp(eventKind, eventId, record, rsvp.id)
    if (dropOff && event) {
      fireDropOffDetailsEmail({ record, event, attending: freshResolvedIds }, record.id)
    }
  }

  await attachSquare(record)
  logger.info('Waiver signed', { recordId: record.id, minors: minors.length, partyId })
  return okSigned(record, partyId, context)
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`sign:${clientAddress}`, 10, 60_000)) {
    return bad('Too many submissions — give it a minute and try again.', 429)
  }

  try {
    const body = await request.json().catch(() => null)
    if (!body) return bad('Invalid request body')

    const now = new Date()
    const partyId = typeof body.partyId === 'string' && body.partyId.trim() ? body.partyId.trim() : null
    const workshopId = typeof body.workshopId === 'string' && body.workshopId.trim() ? body.workshopId.trim() : null
    // The per-seat Square booking id (workshops only) — the class itself
    // (`workshopId` = classScheduleId) is what the RSVP attaches to; this is
    // carried along on the RSVP as `ref.bookingId` for staff lookup.
    const bookingId = typeof body.booking === 'string' && body.booking.trim() ? body.booking.trim().slice(0, 128) : null
    const userAgent = request.headers.get('user-agent')
    const responsibleAdult = typeof body.responsibleAdult === 'string'
      ? body.responsibleAdult.trim().slice(0, 120)
      : ''

    // Mutually exclusive — can only attach a signature to one event at a time.
    if (partyId && workshopId) return bad('One event per signature, please.')

    // Validate workshopId shape (workshop bookings live in Square — no record lookup needed).
    if (workshopId && !/^[\w-]{4,64}$/.test(workshopId)) {
      return bad('Invalid workshop ID.')
    }

    // Returning-customer fast path.
    const reuseId = typeof body.reuseRecordId === 'string' ? body.reuseRecordId.trim() : ''
    const reuseToken = typeof body.reuseToken === 'string' ? body.reuseToken.trim() : ''
    if (reuseId) {
      return handleReuse(reuseId, reuseToken, partyId, workshopId, bookingId, body.attending, responsibleAdult, body.pickupUpdate, now, clientAddress, userAgent)
    }

    return handleFresh(body, partyId, workshopId, bookingId, responsibleAdult, now, clientAddress, userAgent)
  } catch (err) {
    logger.error('Waiver signing failed', { error: err instanceof Error ? err.message : String(err) })
    return bad('Something went wrong saving your signature — please try again or sign at the front desk.', 500)
  }
}
