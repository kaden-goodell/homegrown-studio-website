import type { APIRoute } from 'astro'
import { lookupHouseholdEntry } from '@lib/waiver-store'
import { rateLimited } from '@lib/rate-limit'
import { issueReuseToken } from '@lib/reuse-token'

export const prerender = false

/**
 * Returning-customer lookup. Given an email or phone, says whether a still-valid
 * household agreement is on file — returning ONLY the first name, the kids' first
 * names, and the record id. Sensitive fields (emergency contact, allergies,
 * DOBs) are never returned to the browser; they're reused server-side by record
 * id at RSVP time, so typing a stranger's email can't harvest their details.
 *
 * POST { contact }  →  { found, firstName?, kids?, validUntil?, recordId?, reuseToken? }
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`lookup:${clientAddress}`, 10, 60_000)) {
    return new Response(JSON.stringify({ error: 'Too many lookups — give it a minute and try again.' }), { status: 429 })
  }

  const body = await request.json().catch(() => null)
  const contact = typeof body?.contact === 'string' ? body.contact.trim() : ''
  if (!contact) {
    return new Response(JSON.stringify({ error: 'Enter an email or phone number.' }), { status: 400 })
  }

  const h = await lookupHouseholdEntry(contact)
  if (!h) {
    return new Response(JSON.stringify({ data: { found: false } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Found but lapsed: don't offer one-tap reuse — they must re-sign. Tell them
  // who/what we found (their own name + when it expired) so it isn't a mystery.
  if (new Date(h.validUntil).getTime() <= Date.now()) {
    return new Response(
      JSON.stringify({ data: { found: false, expired: true, firstName: h.firstName, validUntil: h.validUntil } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return new Response(
    JSON.stringify({
      data: {
        found: true,
        recordId: h.recordId,
        firstName: h.firstName,
        kids: h.minors.map((m) => m.name.split(' ')[0]),
        validUntil: h.validUntil,
        reuseToken: issueReuseToken(h.recordId),
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
