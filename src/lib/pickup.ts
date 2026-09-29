/**
 * The ONE answer to "who may collect this household's kids". A household's
 * pickup list and may-NOT-collect note follow it to every event — the newest
 * source wins, blank never erases, typing new values replaces:
 *   - the newest RSVP pickup (any event) under this waiver id
 *   - if the household re-signed (a DIFFERENT current record for the same
 *     email AND signer name): that record's own fields and its RSVPs too, so a
 *     restriction typed on a re-sign reaches events booked under the old id
 *   - the waiver's own fields
 */
import { getLatestPickupForWaiver } from '@lib/rsvp-store'
import { lookupHouseholdEntry, normalizeAuthorizedPickup, type AuthorizedPickup } from '@lib/waiver-store'
import { hasPickupContent, sameHousehold } from '@lib/pickup-rules'

export { hasPickupContent, sameHousehold }

export interface EffectivePickup {
  authorizedPickup: AuthorizedPickup[]
  notAuthorized: string
}

/** Either a WaiverRecord (`adult`, `id`) or a HouseholdOnFile (`recordId`, flat name/email). */
export interface PickupSubject {
  id?: string
  recordId?: string
  authorizedPickup: unknown
  notAuthorized?: string | null
  signedAt?: string
  adult?: { email: string; firstName: string; lastName: string }
  email?: string
  firstName?: string
  lastName?: string
}

const idOf = (w: PickupSubject) => (w.id ?? w.recordId)!
const personOf = (w: PickupSubject) => ({
  email: w.adult?.email ?? w.email ?? '',
  firstName: w.adult?.firstName ?? w.firstName ?? '',
  lastName: w.adult?.lastName ?? w.lastName ?? '',
})

export async function effectivePickup({ waiver }: { waiver: PickupSubject }): Promise<EffectivePickup> {
  type Candidate = { authorizedPickup: unknown[]; notAuthorized: string; at: string }
  const candidates: Candidate[] = [] // ties keep list order: RSVPs first, own fields last
  const push = (p: { authorizedPickup: unknown; notAuthorized?: string | null; at?: string } | null) => {
    if (!p) return
    const rows = normalizeAuthorizedPickup(p.authorizedPickup as any)
    const c = { authorizedPickup: rows, notAuthorized: p.notAuthorized ?? '', at: p.at ?? '' }
    if (hasPickupContent(c)) candidates.push(c)
  }

  const id = idOf(waiver)
  push(await getLatestPickupForWaiver(id))

  // The household's CURRENT record, when it re-signed under a new id.
  let current: PickupSubject | null = null
  const email = personOf(waiver).email
  if (email) {
    try {
      const h = await lookupHouseholdEntry(email)
      if (h && h.recordId !== id && sameHousehold(personOf(h), personOf(waiver))) current = h
    } catch {
      // best effort — nothing extra
    }
  }
  if (current) {
    push(await getLatestPickupForWaiver(idOf(current)))
    push({ authorizedPickup: current.authorizedPickup, notAuthorized: current.notAuthorized, at: current.signedAt })
  }
  push({ authorizedPickup: waiver.authorizedPickup, notAuthorized: waiver.notAuthorized, at: waiver.signedAt })

  // Newest wins (stable sort keeps list order on ties).
  candidates.sort((a, b) => b.at.localeCompare(a.at))
  const best = candidates[0]
  return best
    ? { authorizedPickup: best.authorizedPickup as AuthorizedPickup[], notAuthorized: best.notAuthorized }
    : { authorizedPickup: [], notAuthorized: '' }
}
