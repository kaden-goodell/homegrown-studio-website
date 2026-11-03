import type { StudioEvent } from '@lib/events'

/**
 * The name to use in anything a host, guest or parent reads (emails, texts, the waiver page): the host's own party
 * title, never the owners' and crew's `title` ("Paige's party · Pots"). Classes have only `title`. Pure, so the
 * senders don't pull in (or have their tests mock) the event loader.
 */
export function guestTitle(e: Pick<StudioEvent, 'title' | 'publicTitle'>): string {
  return e.publicTitle ?? e.title
}
