/**
 * What `/waiver?party=…` or `?workshop=…` tells the page about its event,
 * looked up on the server (getEvent: parties, Square classes and our own
 * cls_ classes). Pulled out of waiver.astro so a link can be tested.
 *
 * Four outcomes:
 *   1. found + not past  → id + label
 *   2. found + past      → a notice, no id
 *   3. not found         → a notice, no id (no ghost RSVPs)
 *   4. lookup threw      → keep the id, no label (sign.json checks again)
 */
import { getEvent, isEventPast, type StudioEvent } from '@lib/events'
import { formatWhen } from '@lib/studio-time'
import { getClass } from '@lib/classes/class-store'
import { isOwnClassId } from '@lib/classes/staff-view'
import type { EventOutcome } from '@lib/waiver-page'

export async function waiverEventOutcome(eventKind: 'party' | 'workshop' | null, rawId: string | undefined, now = new Date()): Promise<EventOutcome> {
  if (!eventKind || !rawId) return { kind: 'none' }
  try {
    const event: StudioEvent | null = await getEvent(eventKind, rawId)
    if (event === null) {
      // One of our classes that was cancelled: say so, rather than "ask for a fresh link".
      if (eventKind === 'workshop' && isOwnClassId(rawId) && (await getClass(rawId))?.status === 'cancelled') {
        return { kind: 'cancelled', notice: 'This class was cancelled. Nothing to sign.' }
      }
      return {
        kind: 'unknown',
        notice: eventKind === 'party'
          ? 'That party link wasn’t recognized — ask your host for a fresh invitation. You can still sign the general agreement below.'
          : 'That link wasn’t recognized — ask the studio for a fresh link. You can still sign the general agreement below.',
      }
    }
    // Days-based rule, aligned with sign.json's validateEvent: past once every
    // day of the event is before yesterday (studio-local).
    if (isEventPast(event, now)) return { kind: 'past', notice: 'This event has already happened.' }
    return { kind: 'ok', id: rawId, label: `${event.title} · ${formatWhen(event.startIso)} CT`, dropOff: event.dropOff }
  } catch {
    return { kind: 'error', id: rawId }
  }
}
