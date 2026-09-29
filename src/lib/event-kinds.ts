/** Pure (no server imports) so client components can share it with `@lib/events`. */
export type EventKind = 'party' | 'workshop' | 'program'

/** Shared kind-param validator for every staff surface that resolves an
 *  event (checkin, roster, print). Rejects 'program' — `getEvent` has no
 *  resolver for it yet — so a stray `?kind=program` fails the same way
 *  everywhere. Widen this (and `getEvent`) together when Programs land. */
export const EVENT_KIND_RE = /^(party|workshop)$/
