/**
 * Telling a team member they're on a class or party, or off it (stage 3,
 * OWNER-2): one email and one text, the same words in both. DRAFT copy for
 * Kaden. Written to read at a glance on a phone: what, which day, what time,
 * no colons, no customer names, no pronouns guessed.
 *
 * Sending never undoes an assignment: a failure comes back as a warning the
 * owner sees ("Saved. The text to Jessica didn't go through."). On a
 * namespaced preview every message goes to Kaden (preview-outbound.ts).
 * Server only.
 */
import { sendShiftEmail } from '@lib/email'
import { sendQuoText } from '@lib/quo'
import { createLogger } from '@lib/logger'
import { studioClock } from '@lib/studio-time'
import type { StaffPerson } from '@lib/staff-directory'
import type { StaffableEvent } from './types'

const logger = createLogger('staffing-notify')
const TZ = 'America/Chicago'

/** "Sun Oct 25" (no commas, so the sentence around it stays easy to read). */
export function shiftDay(iso: string): string {
  const d = new Date(iso)
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ })
  const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ })
  return `${weekday} ${monthDay}`
}

/** "1 PM", "1:30 PM", "12 PM" (a time's own colon is the only one in these messages). */
export function shiftClock(iso: string): string {
  const [h, m] = studioClock(iso).split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`
}

/** What they're on, as a phrase: "Needlepoint 101" / "a party for 14 guests" / "a party". */
export function shiftWhat(ev: Pick<StaffableEvent, 'kind' | 'title' | 'detail'>): string {
  if (ev.kind !== 'party') return ev.title
  const g = ev.detail.guests
  return typeof g === 'number' && g > 0 ? `a party for ${g} ${g === 1 ? 'guest' : 'guests'}` : 'a party'
}

type ShiftEvent = Pick<StaffableEvent, 'kind' | 'title' | 'detail' | 'startIso' | 'endIso'>

/** "Mon Dec 21", "Mon Dec 21 and Tue Dec 22", "Mon Dec 21, Tue Dec 22 and Wed Dec 23". */
function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * The text and the email's words for one change, on one event or on several
 * days of the same class (one message for a multi-day class, never one per day).
 */
export function shiftMessage(kind: 'on' | 'off', evOrDays: ShiftEvent | ShiftEvent[], shiftsLink: string): { text: string; subject: string; lines: string[] } {
  const days = (Array.isArray(evOrDays) ? evOrDays : [evOrDays]).slice().sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
  const what = shiftWhat(days[0])
  const dayList = listOf(days.map((d) => shiftDay(d.startIso)))
  const subjectDays = days.length === 1 ? shiftDay(days[0].startIso) : `${days.length} days from ${shiftDay(days[0].startIso)}`
  if (kind === 'on') {
    const clock = (d: ShiftEvent) => `${shiftClock(d.startIso)} to ${shiftClock(d.endIso)}`
    const sameTimes = days.every((d) => clock(d) === clock(days[0]))
    const when = sameTimes ? `${dayList}, ${clock(days[0])}` : listOf(days.map((d) => `${shiftDay(d.startIso)} ${clock(d)}`))
    return {
      text: `Hometown Studio here. You're on ${what}, ${when}. See your shifts at ${shiftsLink}`,
      subject: `You're on ${what}, ${subjectDays}`,
      lines: [`You're on ${what}, ${when}.`, 'Your shifts are all on the staff page.'],
    }
  }
  return {
    text: `Hometown Studio here. You're no longer on ${what}, ${dayList}. Thanks!`,
    subject: `You're no longer on ${what}, ${subjectDays}`,
    lines: [`You're no longer on ${what}, ${dayList}.`, 'Thanks!'],
  }
}

/** The staff page without "https://" (no colon in a text; phones still make it a link). */
export function shiftsLinkFor(origin: string): { bare: string; url: string } {
  let host = 'ourhometownstudio.com'
  try { host = new URL(origin).host || host } catch { /* keep the live host */ }
  return { bare: `${host}/staff`, url: `https://${host}/staff` }
}

export interface Told { email: boolean; text: boolean; warning: string | null }

/**
 * Sends the email and the text to one person. Never throws. `warning` is
 * what the owner should hear when something didn't go (null when both went).
 */
export async function tellPerson(kind: 'on' | 'off', person: Pick<StaffPerson, 'name' | 'givenName' | 'email' | 'phone'>, ev: ShiftEvent | ShiftEvent[], origin: string): Promise<Told> {
  const link = shiftsLinkFor(origin)
  const msg = shiftMessage(kind, ev, link.bare)
  const name = person.name
  let email = false, text = false
  if (person.email) {
    try {
      email = (await sendShiftEmail({ to: person.email, givenName: person.givenName || name, subject: msg.subject, lines: msg.lines, shiftsUrl: link.url })).sent
    } catch (err) {
      logger.error('Shift email failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }
  if (person.phone) {
    try {
      await sendQuoText({ to: person.phone, content: msg.text })
      text = true
    } catch (err) {
      logger.error('Shift text failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { email, text, warning: toldWarning(name, { hasEmail: !!person.email, hasPhone: !!person.phone, email, text }) }
}

/** What the owner is told when a message didn't go. */
export function toldWarning(name: string, r: { hasEmail: boolean; hasPhone: boolean; email: boolean; text: boolean }): string | null {
  if (!r.hasEmail && !r.hasPhone) return `Saved. Square has no phone or email for ${name}, so no message went.`
  const failed = [r.hasPhone && !r.text ? 'text' : null, r.hasEmail && !r.email ? 'email' : null].filter(Boolean)
  if (failed.length === 2) return `Saved. The text and email to ${name} didn't go through.`
  if (failed.length === 1) return `Saved. The ${failed[0]} to ${name} didn't go through.`
  if (!r.hasPhone) return `Saved. Square has no phone number for ${name}, so only the email went.`
  if (!r.hasEmail) return `Saved. Square has no email for ${name}, so only the text went.`
  return null
}
