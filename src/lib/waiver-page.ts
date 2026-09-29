/**
 * What `/waiver` tells `WaiverFlow` about an event, from the outcome of the
 * server-side event lookup. Pulled out of waiver.astro so it can be tested.
 */

export type EventOutcome =
  | { kind: 'ok'; id: string; label: string; dropOff: boolean }
  | { kind: 'past'; notice: string }
  | { kind: 'unknown'; notice: string }
  | { kind: 'error'; id: string }
  | { kind: 'none' }

export function flowPropsFor(eventKind: 'party' | 'workshop' | null, outcome: EventOutcome) {
  const live = outcome.kind === 'ok' || outcome.kind === 'error'
  return {
    partyId: eventKind === 'party' && live ? outcome.id : undefined,
    workshopId: eventKind === 'workshop' && live ? outcome.id : undefined,
    partyLabel: eventKind === 'party' && outcome.kind === 'ok' ? outcome.label : undefined,
    eventTitle: eventKind === 'workshop' && outcome.kind === 'ok' ? outcome.label : undefined,
    // On a lookup ERROR we keep the id (sign.json re-validates) but don't know
    // whether the event is drop-off — show nothing drop-off-specific.
    dropOff: outcome.kind === 'ok' ? outcome.dropOff : outcome.kind === 'error' ? false : undefined,
    notice: outcome.kind === 'unknown' || outcome.kind === 'past' ? outcome.notice : null,
  }
}
