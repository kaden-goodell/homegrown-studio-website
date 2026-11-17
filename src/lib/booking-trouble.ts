/**
 * Browser side of /api/alerts/client.json: a booking pop-up says it broke on
 * the customer's phone (the card form didn't load, the booking request got no
 * answer, the pop-up crashed). The server never sees those, so the page has to
 * tell it. Once per problem per page load; never throws, never waits.
 *
 * Client-safe.
 */
export type TroubleKind = 'class' | 'party' | 'shop' | 'kit'
export type TroubleProblem = 'payment_form' | 'booking_network' | 'booking_bad_answer' | 'crash' | 'wallet'

const sent = new Set<string>()

/** From the analytics booking kinds ('workshop' is a class here). */
export function troubleKind(kind: string | undefined): TroubleKind | null {
  if (kind === 'workshop') return 'class'
  if (kind === 'party' || kind === 'shop' || kind === 'kit') return kind
  return null
}

export function reportBookingTrouble(kind: TroubleKind | null, problem: TroubleProblem, detail?: unknown): void {
  if (!kind || typeof window === 'undefined') return
  const once = `${kind}:${problem}`
  if (sent.has(once)) return
  sent.add(once)
  try {
    const body = JSON.stringify({
      kind,
      problem,
      detail: String(detail instanceof Error ? detail.message : detail ?? '').slice(0, 160),
      page: window.location.pathname.slice(0, 80),
    })
    const url = '/api/alerts/client.json'
    // sendBeacon only (every current browser has it): it survives the page
    // closing and never competes with the booking's own requests.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
  } catch {
    /* an alarm must never break the page */
  }
}

/** A failed booking answer our code didn't write (no JSON code): a gateway or crash page. */
export function isForeignFailure(status: number, body: unknown): boolean {
  return status >= 500 && !(body && typeof body === 'object' && 'code' in (body as Record<string, unknown>))
}

/** Tests only. */
export function _resetBookingTrouble(): void {
  sent.clear()
}
