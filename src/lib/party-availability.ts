/**
 * Party availability, kept as a doorway for older imports. The rules live in
 * `@lib/parties/open-times` (our party book, the shared studio schedule, and
 * Square-booked parties read only); every function there fails closed.
 */
import { partyConfig } from '@config/party.config'

export { openPartyStarts, isStartOpen, PARTY_TIMES_UNREADABLE } from '@lib/parties/open-times'

/** Studio-local YYYY-MM-DD for any ISO instant. */
export function studioDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: partyConfig.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso)) // en-CA → YYYY-MM-DD
}
