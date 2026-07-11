/** Uniform event view for staff surfaces. Parties come from the party store;
 *  workshops (Square Classes) and open-studio days plug in here later. */
import { getPartyRecord, listParties } from '@lib/party-store'

export type StudioEventKind = 'party' | 'workshop' | 'open-studio'
export interface StudioEvent {
  kind: StudioEventKind
  id: string
  title: string
  startIso: string
  dropOff: boolean
}

export async function getEvent(kind: StudioEventKind, id: string): Promise<StudioEvent | null> {
  if (kind === 'party') {
    const p = await getPartyRecord(id)
    return p ? { kind, id, title: p.title ?? `${p.craftName} Party`, startIso: p.startIso, dropOff: p.dropOff } : null
  }
  return null // workshop/open-studio resolvers land with those features
}

export async function listEvents(): Promise<StudioEvent[]> {
  const parties = await listParties()
  return parties.map((p) => ({ kind: 'party' as const, id: p.bookingId, title: p.title ?? `${p.craftName} Party`, startIso: p.startIso, dropOff: p.dropOff }))
}
