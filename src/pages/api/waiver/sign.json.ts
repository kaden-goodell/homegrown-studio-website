import type { APIRoute } from 'astro'
import { createHash } from 'node:crypto'
import { providers } from '@config/providers'
import { waiverContent, serializeAgreement } from '@config/waiver-content'
import {
  saveWaiverRecord,
  getWaiverRecord,
  newWaiverId,
  addWaiverToPartyIndex,
  indexWaiverByContact,
  type WaiverRecord,
} from '@lib/waiver-store'
import { setExpected } from '@lib/checkin-store'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { verifyReuseToken } from '@lib/reuse-token'
import { getPartyRecord } from '@lib/party-store'

export const prerender = false

const logger = createLogger('api:waiver:sign')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function bad(detail: string, status = 400): Response {
  return new Response(JSON.stringify({ error: detail }), { status })
}

function ok(record: WaiverRecord): Response {
  const covered = [
    `${record.adult.firstName} ${record.adult.lastName}`.trim(),
    ...record.minors.map((m) => m.name),
  ]
  return new Response(
    JSON.stringify({
      data: { recordId: record.id, covered, validUntil: record.validUntil, partyId: record.partyId },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function yearsBetween(dobIso: string, now: Date): number {
  const dob = new Date(`${dobIso}T00:00:00`)
  let years = now.getFullYear() - dob.getFullYear()
  const anniversary = new Date(dob)
  anniversary.setFullYear(now.getFullYear())
  if (now < anniversary) years--
  return years
}

/** Save the signature + update the contact and party indexes. */
async function persistWaiver(record: WaiverRecord): Promise<void> {
  await saveWaiverRecord(record)
  try {
    await indexWaiverByContact(record)
  } catch (err) {
    logger.error('Contact index failed (signature saved)', { id: record.id, error: String(err) })
  }
  if (record.partyId) {
    try {
      await addWaiverToPartyIndex(record.partyId, record.id)
    } catch (err) {
      logger.error('Party index failed (signature saved)', { id: record.id, error: String(err) })
    }
  }
}

/**
 * RSVP "who's coming": record which household members the signer says are
 * attending THIS party. Person ids are `adult` + `child:{i}` in waiver order —
 * the same ids the staff console and pickup flow use. Soft intent only; if the
 * client sends nothing we assume the whole household is coming.
 */
async function recordExpected(record: WaiverRecord, attendingRaw: unknown): Promise<void> {
  if (!record.partyId) return
  const valid = new Set(['adult', ...record.minors.map((_, i) => `child:${i}`)])
  const ids = Array.isArray(attendingRaw)
    ? [...new Set(attendingRaw.map(String))].filter((id) => valid.has(id))
    : [...valid]
  try {
    await setExpected(record.partyId, record.id, ids)
  } catch (err) {
    logger.error('Expected-attendance write failed (signature saved)', { id: record.id, error: String(err) })
  }
}

/** Best-effort: attach to Square customer + write a POS-visible safety note. */
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
    const safety = [
      allergyLines.length ? `Allergies — ${allergyLines.join('; ')}` : 'Allergies: none noted',
      `Emergency: ${record.emergency.name} ${record.emergency.phone}`,
      record.authorizedPickup ? `Pickup: ${record.authorizedPickup}` : '',
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
 * Validate that partyId refers to a real, not-yet-ended party.
 * Returns null if valid (or partyId is absent), or a Response to return
 * immediately if invalid. Swallows transient storage errors to avoid blocking
 * legit RSVPs on a blip.
 */
async function validateParty(partyId: string | null, now: Date): Promise<Response | null> {
  if (!partyId) return null
  try {
    const party = await getPartyRecord(partyId)
    if (!party) {
      return bad("This party link doesn't look right — ask your host to re-share the invitation.", 404)
    }
    if (new Date(party.startIso).getTime() + 24 * 3600_000 < now.getTime()) {
      return bad("This party has already happened — nothing to RSVP to, but thanks for checking!", 410)
    }
    return null
  } catch (err) {
    logger.error('Party validation error — proceeding without it', { partyId, error: String(err) })
    return null
  }
}

/** Returning customer: RSVP by reusing an on-file household — no re-fill. */
async function handleReuse(
  reuseId: string,
  reuseToken: string,
  partyId: string | null,
  attendingRaw: unknown,
  now: Date,
  clientAddress: string | undefined,
  userAgent: string | null,
): Promise<Response> {
  if (!verifyReuseToken(reuseId, reuseToken)) {
    return bad("That session expired — look yourself up again to RSVP.", 401)
  }

  const partyErr = await validateParty(partyId, now)
  if (partyErr) return partyErr

  const source = await getWaiverRecord(reuseId)
  if (!source) return bad("We couldn’t find your agreement — please fill out the form.")
  if (new Date(source.validUntil).getTime() <= now.getTime()) {
    return bad("Your agreement has expired — please sign a new one.")
  }
  const record: WaiverRecord = {
    ...source,
    id: newWaiverId(),
    signedAt: now.toISOString(),
    // Same 12-month agreement re-affirmed for this party; keep original expiry.
    signature: `${source.adult.firstName} ${source.adult.lastName}`.trim(),
    partyId,
    squareCustomerId: null,
    ip: clientAddress ?? null,
    userAgent,
  }
  await persistWaiver(record)
  await recordExpected(record, attendingRaw)
  await attachSquare(record)
  logger.info('RSVP via reuse', { recordId: record.id, sourceId: reuseId, partyId })
  return ok(record)
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`sign:${clientAddress}`, 10, 60_000)) {
    return bad('Too many lookups — give it a minute and try again.', 429)
  }

  try {
    const body = await request.json().catch(() => null)
    if (!body) return bad('Invalid request body')

    const now = new Date()
    const partyId = typeof body.partyId === 'string' && body.partyId.trim() ? body.partyId.trim() : null
    const userAgent = request.headers.get('user-agent')

    // Returning-customer fast path.
    const reuseId = typeof body.reuseRecordId === 'string' ? body.reuseRecordId.trim() : ''
    const reuseToken = typeof body.reuseToken === 'string' ? body.reuseToken.trim() : ''
    if (reuseId) return handleReuse(reuseId, reuseToken, partyId, body.attending, now, clientAddress, userAgent)

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
    }))
    for (const m of minors) {
      if (!m.name || !DATE_RE.test(m.dob)) return bad('Each child needs a name and date of birth.')
      if (yearsBetween(m.dob, now) >= waiverContent.adultAge) {
        return bad(`${m.name} is ${waiverContent.adultAge} or older and needs to sign their own agreement.`)
      }
    }

    const emergency = body.emergency ?? {}
    const emergencyName = String(emergency.name ?? '').trim()
    const emergencyPhone = String(emergency.phone ?? '').trim()
    const emergencyRelationship = String(emergency.relationship ?? '').trim()
    if (!emergencyName || emergencyPhone.replace(/\D/g, '').length < 10) {
      return bad('Please add an emergency contact name and phone number.')
    }

    if (typeof body.photoConsent !== 'boolean') {
      return bad('Please choose a photo preference — either answer is fine.')
    }
    if (body.agreeRelease !== true) return bad('Please read and accept the agreement to continue.')

    const signature = String(body.signature ?? '').trim()
    const fullName = `${firstName} ${lastName}`
    if (signature.toLowerCase().replace(/\s+/g, ' ') !== fullName.toLowerCase().replace(/\s+/g, ' ')) {
      return bad(`To sign, type your name exactly as entered above: “${fullName}”.`)
    }

    const partyErr = await validateParty(partyId, now)
    if (partyErr) return partyErr

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
      authorizedPickup: String(body.authorizedPickup ?? '').trim(),
      photoConsent: body.photoConsent,
      signature,
      partyId,
      squareCustomerId: null,
      ip: clientAddress ?? null,
      userAgent,
    }

    await persistWaiver(record)
    await recordExpected(record, body.attending)
    await attachSquare(record)
    logger.info('Waiver signed', { recordId: record.id, minors: minors.length, partyId })
    return ok(record)
  } catch (err) {
    logger.error('Waiver signing failed', { error: err instanceof Error ? err.message : String(err) })
    return bad('Something went wrong saving your signature — please try again or sign at the front desk.', 500)
  }
}
