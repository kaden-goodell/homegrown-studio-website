/**
 * "Need to move or cancel?" on the host's party page (final customer review
 * I4; D2: parties stay request-only). The host picks what they want and adds a
 * note; it is saved on the party, the owners get a text, and the request waits
 * in /admin › To decide. Nothing about the party, its money or its time
 * changes here: Catherine moves, cancels or refunds from the party itself,
 * following the 14-day party policy shown to the host.
 *
 * Server only.
 */
import { createLogger } from '@lib/logger'
import { alertOwners } from '@lib/owner-alert'
import { recordAudit } from '@lib/audit'
import { formatSlotLabel } from '@lib/studio-time'
import { getPartyRecord, hostTokenValid, isOurs, updatePartyRecord, type PartyChangeRequest, type PartyRecord } from '@lib/party-store'

const logger = createLogger('parties:change-request')

export const CHANGE_NOTE_MAX = 500
/** At most this many owner texts a day for one party; later requests still save and show in To decide. */
const OWNER_TEXTS_PER_DAY = 3
const NOTE_IN_TEXT_MAX = 120

export const CHANGE_WORDS = {
  notFound: 'This party link doesn’t work. Open the link from your booking email again, or text us.',
  gone: 'This party has already happened or was cancelled, so there’s nothing to change here. Text us with any questions.',
  pickOne: 'Choose whether you want to move it, cancel it or something else.',
  tooLong: `Keep the note under ${CHANGE_NOTE_MAX} characters.`,
  needNote: 'Tell us a little about what you need.',
}

export class ChangeRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const WANT_WORDS: Record<PartyChangeRequest['want'], string> = { move: 'move', cancel: 'cancel', other: 'change' }

/** The request the host page shows as sent: the last one, while the party is still to come. */
export function openRequest(rec: PartyRecord): PartyChangeRequest | null {
  return rec.changeRequests?.[rec.changeRequests.length - 1] ?? null
}

export async function askToChangeParty(
  input: { bookingId: unknown; key: unknown; want: unknown; note: unknown },
  now: Date = new Date(),
): Promise<{ request: PartyChangeRequest; repeated: boolean }> {
  const bookingId = typeof input.bookingId === 'string' ? input.bookingId : ''
  const key = typeof input.key === 'string' ? input.key : ''
  const rec = bookingId ? await getPartyRecord(bookingId) : null
  if (!rec || !hostTokenValid(rec, key) || !isOurs(rec)) throw new ChangeRequestError(404, CHANGE_WORDS.notFound)
  if (rec.status === 'cancelled' || Date.parse(rec.startIso) <= now.getTime()) throw new ChangeRequestError(409, CHANGE_WORDS.gone)
  const want = input.want === 'move' || input.want === 'cancel' || input.want === 'other' ? input.want : null
  if (!want) throw new ChangeRequestError(400, CHANGE_WORDS.pickOne)
  const note = typeof input.note === 'string' ? input.note.trim().replace(/\s+/g, ' ') : ''
  if (note.length > CHANGE_NOTE_MAX) throw new ChangeRequestError(400, CHANGE_WORDS.tooLong)
  if (want === 'other' && !note) throw new ChangeRequestError(400, CHANGE_WORDS.needNote)

  let repeated = false
  let text = false
  const saved = await updatePartyRecord(rec.bookingId, (r) => {
    const list = r.changeRequests ?? []
    const last = list[list.length - 1]
    // The same request twice (a double tap, a reload) is one request.
    if (last && last.want === want && last.note === note && now.getTime() - Date.parse(last.at) < 10 * 60_000) {
      repeated = true
      return null
    }
    const textedToday = list.filter((x) => x.told && now.getTime() - Date.parse(x.at) < 86_400_000).length
    text = textedToday < OWNER_TEXTS_PER_DAY
    const next: PartyChangeRequest = { at: now.toISOString(), want: want!, note, told: text }
    return { ...r, changeRequests: [...list, next].slice(-10) }
  }, `Host asked to ${WANT_WORDS[want]} the party`, null)
  const request = openRequest(saved)!
  if (repeated) return { request, repeated }

  const when = formatSlotLabel(saved.startIso)
  const short = note.length > NOTE_IN_TEXT_MAX ? `${note.slice(0, NOTE_IN_TEXT_MAX - 1).trimEnd()}…` : note
  if (text) {
    await alertOwners(`${saved.hostName || 'A host'} asked to ${WANT_WORDS[want]} their party on ${when}${short ? `: “${short}”` : ''}. Open /admin › To decide to see it, then move, cancel or refund it from the party.`)
      .catch((err) => logger.error('Owner text for a party change request failed', { bookingId: saved.bookingId, error: String(err) }))
  }
  await recordAudit({
    by: { id: 'customer-online', name: `${saved.hostName || 'Host'} (online)`, role: 'owner' },
    action: 'party-change-request',
    target: { kind: 'party', id: saved.bookingId, label: `${saved.craftName} party, ${when}` },
    details: { want, note: note.slice(0, 200), ...(text ? {} : { texted: false }) },
  }).catch(() => undefined)
  return { request, repeated }
}
