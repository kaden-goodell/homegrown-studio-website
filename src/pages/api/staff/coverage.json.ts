import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { lookupHouseholdEntry, lookupHouseholdsByName, type HouseholdOnFile } from '@lib/waiver-store'
import { getOpenStudioDay, type OpenStudioDay } from '@lib/open-studio-store'
import { studioDate } from '@lib/studio-time'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:coverage')

/**
 * GET ?q=phone|email|last-name → { households: [...] } — the door check for
 * walk-ins, workshops, and Open Studio (HOM-208). A phone or email resolves
 * to at most one household; anything else is treated as a last-name search
 * and can return several. Every state — GOOD TO GO, EXPIRED, NOT ON FILE —
 * is the same shape: an empty array just means no match.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const q = url.searchParams.get('q')?.trim() ?? ''
  if (!q) return new Response(JSON.stringify({ error: 'Missing q' }), { status: 400 })

  let households: HouseholdOnFile[]
  try {
    if (q.includes('@')) {
      const h = await lookupHouseholdEntry(q)
      households = h ? [h] : []
    } else if (q.replace(/\D/g, '').length >= 10) {
      const h = await lookupHouseholdEntry(q)
      households = h ? [h] : []
    } else {
      households = await lookupHouseholdsByName(q)
    }
  } catch (err) {
    logger.error('Coverage lookup failed', { error: String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t reach storage — check wifi and try again.' }), { status: 503 })
  }

  const today = studioDate(new Date().toISOString())
  const openStudioDay = await getOpenStudioDay(today).catch((): OpenStudioDay => ({}))

  const data = households.map((h) => ({
    recordId: h.recordId,
    firstName: h.firstName,
    lastName: h.lastName,
    signedAt: h.signedAt,
    agreementVersion: h.agreementVersion,
    validUntil: h.validUntil,
    covered: new Date(h.validUntil).getTime() > Date.now(),
    kids: h.minors.map((m) => ({ name: m.name, allergies: m.allergies || '' })),
    adultAllergies: h.adultAllergies,
    photoConsent: h.photoConsent,
    openStudioToday: !!openStudioDay[h.recordId],
  }))

  return new Response(JSON.stringify({ data: { households: data } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
