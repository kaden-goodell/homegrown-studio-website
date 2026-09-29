/**
 * The ONE answer to "who may collect this household's kids at this event".
 * A household's pickup list and may-NOT-collect note follow it to every event:
 *   1. this event's RSVP override, if it has any content
 *   2. else the household's most recent RSVP override from any other event
 *   3. else the signature's own fields
 * Blank never erases; typing new values on an RSVP replaces (rule 1).
 */
import { getRsvp, getLatestPickupForWaiver } from '@lib/rsvp-store'
import { normalizeAuthorizedPickup, type AuthorizedPickup } from '@lib/waiver-store'
import type { EventKind } from '@lib/event-kinds'

export interface EffectivePickup {
  authorizedPickup: AuthorizedPickup[]
  notAuthorized: string
}

const hasContent = (p: { authorizedPickup: unknown[]; notAuthorized: string } | null | undefined): p is EffectivePickup =>
  !!p && (p.authorizedPickup.length > 0 || (p.notAuthorized ?? '').trim() !== '')

export const hasPickupContent = hasContent

export async function effectivePickup(input: {
  /** Omit for a plain (no-event) lookup: skips step 1. */
  kind?: EventKind
  id?: string
  waiver: { id: string; authorizedPickup: unknown; notAuthorized?: string | null }
}): Promise<EffectivePickup> {
  const { kind, id, waiver } = input
  const here = kind && id ? await getRsvp(kind, id, waiver.id) : null
  if (hasContent(here?.pickup)) {
    return { authorizedPickup: normalizeAuthorizedPickup(here!.pickup!.authorizedPickup), notAuthorized: here!.pickup!.notAuthorized }
  }
  const latest = await getLatestPickupForWaiver(waiver.id)
  if (hasContent(latest)) {
    return { authorizedPickup: normalizeAuthorizedPickup(latest.authorizedPickup), notAuthorized: latest.notAuthorized }
  }
  return { authorizedPickup: normalizeAuthorizedPickup(waiver.authorizedPickup as any), notAuthorized: waiver.notAuthorized || '' }
}
