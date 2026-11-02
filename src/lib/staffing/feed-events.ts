/**
 * What goes in a calendar link (stage 3). The scope always comes from the
 * stored link record, never from the URL.
 *
 * Crew (`mine`): only the classes and parties that person is on. Summary
 * "Needlepoint 101" / "Party · 14 guests"; description "With Catherine." and,
 * for a party, when to be there. No customer names, no contact details.
 *
 * Owners (`all`): every class session and party, blocked time and closed
 * days. "⚠ " in front when someone is still needed; "You're on · " when the
 * owner is on it; a party shows the host's first name (OWNER-4); the
 * description says who's on and the seats.
 *
 * Window: 30 days back to 120 days ahead. A cancelled class or party with
 * someone on it stays (STATUS:CANCELLED) so phones show it crossed out.
 * Reading a feed remembers each event's times, so a moved event keeps its
 * UID and its SEQUENCE goes up. Server only.
 */
import { siteConfig } from '@config/site.config'
import { blockedAndClosedBusy } from '@lib/classes/studio-schedule'
import { localDate } from '@lib/parties/party-times'
import { staffIdForOwner } from '@lib/staff-directory'
import type { Owner } from '@lib/admin-who'
import { crewView, rememberSeen, staffingRows, type StaffingRow } from './events'
import type { FeedEvent } from './ics-feed'
import type { FeedRecord } from './feed-store'

const DAY_MS = 86_400_000
export const FEED_BACK_MS = 30 * DAY_MS
export const FEED_AHEAD_MS = 120 * DAY_MS
const UID_DOMAIN = 'ourhometownstudio.com'

export const CREW_FEED_NAME = 'Hometown Studio · my shifts'
export const OWNER_FEED_NAME = 'Hometown Studio'
export const PARTY_EARLY = 'Be there 30 minutes before it starts.'

export const studioLocation = (): string => {
  const a = siteConfig.address
  return `Hometown Studio, ${a.street}, ${a.city}, ${a.state} ${a.zip}`
}

/** "Kaden and Jessica", "Kaden, Jessica and Sam". */
export function namesList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const uidOf = (key: string) => `${key}@${UID_DOMAIN}`
const cancelledPrefix = (row: StaffingRow) => (row.event.status === 'on' ? '' : 'Cancelled · ')

/** One crew member's events. */
export function crewFeedEvents(rows: StaffingRow[], staffId: string): FeedEvent[] {
  return rows
    .filter((r) => r.entry?.assigned.some((a) => a.staffId === staffId))
    .map((r) => {
      const others = r.entry!.assigned.filter((a) => a.staffId !== staffId).map((a) => a.name)
      const parts = [others.length ? `With ${namesList(others)}.` : 'Just you on this one.']
      if (r.event.kind === 'party' && r.event.status === 'on') parts.push(PARTY_EARLY)
      if (r.event.status !== 'on') parts.unshift('This was cancelled.')
      return {
        uid: uidOf(r.event.key),
        sequence: r.entry?.sequence ?? 0,
        startIso: r.event.startIso,
        endIso: r.event.endIso,
        summary: `${cancelledPrefix(r)}${r.event.title}`,
        description: parts.join(' '),
        status: r.event.status === 'on' ? 'CONFIRMED' : 'CANCELLED',
        url: null,
      }
    })
}

/** Everything, for an owner. `youId`: the owner's team member id ("You're on"), null when not known. */
export function ownerFeedEvents(rows: StaffingRow[], other: { kind: string; id: string; label: string; startIso: string; endIso: string }[], youId: string | null, origin: string): FeedEvent[] {
  const out: FeedEvent[] = rows.map((r) => {
    const on = (r.entry?.assigned ?? []).filter((a) => r.people.some((p) => p.staffId === a.staffId)).map((a) => a.name)
    const short = r.event.status === 'on' && r.needed > 0 && r.state !== 'staffed'
    const youreOn = !!youId && !!r.entry?.assigned.some((a) => a.staffId === youId)
    const title = r.event.kind === 'party'
      ? ['Party', r.event.detail.hostFirst, typeof r.event.detail.guests === 'number' ? `${r.event.detail.guests} ${r.event.detail.guests === 1 ? 'guest' : 'guests'}` : null].filter(Boolean).join(' · ')
      : r.event.title
    const who = on.length === 0
      ? (r.needed > 0 ? 'Nobody on yet.' : 'Nobody needed.')
      : `${namesList(on)} ${on.length === 1 ? 'is' : 'are'} on.${short ? ` ${r.needed - on.length} more needed.` : ''}`
    const parts = [who]
    if (r.leftTeam.length) parts.push(`${namesList(r.leftTeam.map((p) => p.name))} left the team.`)
    if (r.event.detail.seats) parts.push(`${r.event.detail.seats} taken.`)
    if (r.event.status !== 'on') parts.unshift('This was cancelled.')
    return {
      uid: uidOf(r.event.key),
      sequence: r.entry?.sequence ?? 0,
      startIso: r.event.startIso,
      endIso: r.event.endIso,
      summary: `${short ? '⚠ ' : ''}${cancelledPrefix(r)}${youreOn ? "You're on · " : ''}${title}`,
      description: parts.join(' '),
      status: r.event.status === 'on' ? 'CONFIRMED' : 'CANCELLED',
      url: `${origin}/admin${r.event.openHref}`,
    }
  })
  for (const b of other) {
    if (b.kind === 'closed') {
      const day = localDate(b.startIso)
      out.push({
        uid: uidOf(`closed-${day}`), sequence: 0, startIso: b.startIso, endIso: b.endIso,
        summary: b.label, description: '', status: 'CONFIRMED', url: null,
        allDay: { startYmd: day, endYmd: nextDay(day) },
      })
    } else if (b.kind === 'blocked') {
      out.push({
        uid: uidOf(`blocked-${b.id}`), sequence: 0, startIso: b.startIso, endIso: b.endIso,
        summary: `Blocked · ${b.label}`, description: '', status: 'CONFIRMED', url: null,
      })
    }
  }
  return out.sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1, 12)).toISOString().slice(0, 10)
}

/** The feed for a stored link: its events and its name. Throws when the schedule or staffing can't be read. */
export async function feedFor(record: FeedRecord, now: Date, origin: string): Promise<{ name: string; events: FeedEvent[] }> {
  const fromIso = new Date(now.getTime() - FEED_BACK_MS).toISOString()
  const toIso = new Date(now.getTime() + FEED_AHEAD_MS).toISOString()
  if (record.scope === 'mine' && record.staffId) {
    const { mine } = await crewView(fromIso, toIso, record.staffId, now)
    await rememberSeen(mine)
    return { name: CREW_FEED_NAME, events: crewFeedEvents(mine, record.staffId) }
  }
  const [rows, other, youId] = await Promise.all([
    staffingRows(fromIso, toIso, { seats: true }),
    blockedAndClosedBusy(fromIso, toIso),
    record.owner ? staffIdForOwner(record.owner as Owner) : Promise.resolve(null),
  ])
  await rememberSeen(rows)
  return { name: OWNER_FEED_NAME, events: ownerFeedEvents(rows, other, youId, origin) }
}
