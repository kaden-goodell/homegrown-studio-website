import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { getPartyRecord } from '@lib/party-store'
import { listRsvpsByEvent } from '@lib/rsvp-store'
import { listWaiversByEvent } from '@lib/waiver-store'
import { agreementState, type AgreementState } from '@lib/waiver-coverage'
import { adminPartyView, partyRefundRequests, type AdminPartyView } from '@lib/parties/admin-actions'

export const prerender = false

const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/

/**
 * The party as the sheet shows it: the stage-1 fields (bookingId, host,
 * guests, craft, title, startIso, durationMinutes, themeName, createdAt)
 * and, from stage 2, status, legacy (booked in Square: read only), endIso,
 * items, charges, refunds, dueCents, paymentState, linkSent, overlap and the
 * saved refund requests (null when they couldn't be read).
 */
export type AdminParty = AdminPartyView & { refundRequests: Awaited<ReturnType<typeof partyRefundRequests>> }
/** One household that said yes, from its signed agreement and its RSVP. */
export interface AdminPartyGuest {
  name: string
  /** Children on the agreement. */
  kids: number
  /** People coming, from the RSVP (everyone on the agreement when it doesn't say). */
  coming: number
  waiver: AgreementState
}

/**
 * GET ?id=<party booking id>: one party for the /admin Party sheet, read only
 * (changes go through /api/admin/parties/actions.json).
 * `party` is null when the booking has no record on this site (booked in
 * Square by hand). `guests` is null when the agreements couldn't be read, so
 * the sheet can say so instead of showing nobody. Owners only.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const id = url.searchParams.get('id') ?? ''
  if (!ID_RE.test(id)) return json(400, { error: 'Pick a party.' })
  let record
  try {
    record = await getPartyRecord(id)
  } catch (e) {
    console.error(`[admin/party] ${e instanceof Error ? e.message : e}`)
    return json(503, { error: "The party couldn't be loaded. Try again." })
  }
  const party: AdminParty | null = record
    ? { ...adminPartyView(record), refundRequests: await partyRefundRequests(record.bookingId) }
    : null
  let guests: AdminPartyGuest[] | null = null
  try {
    const now = new Date()
    const [waivers, rsvps] = await Promise.all([listWaiversByEvent('party', id), listRsvpsByEvent('party', id)])
    const coming = new Map(rsvps.map((r) => [r.waiverId, r.attending]))
    guests = waivers
      .sort((a, b) => a.signedAt.localeCompare(b.signedAt))
      .map((w) => {
        const attending = coming.get(w.id)
        return {
          name: `${w.adult.firstName} ${w.adult.lastName}`.trim(),
          kids: w.minors.length,
          coming: attending ? attending.length : 1 + w.minors.length,
          waiver: agreementState(w, now),
        }
      })
  } catch (e) {
    console.warn(`[admin/party] guests for ${id}: ${e instanceof Error ? e.message : e}`)
  }
  return json(200, { data: { party, guests } })
}
