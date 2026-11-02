/**
 * Stage 4: the waitlist things an owner must look at, said once for both the
 * warnings (/staff, the daily email) and /admin › To decide (with buttons):
 *   waitlist-unknown   we charged someone's saved card and Square never said
 *                      whether it went through; their seat is held
 *                      → the sheet asks Square: Add them · Keep them waiting ·
 *                        Take them off (I5)
 *   waitlist-declined  a card didn't go through (or the price rose since
 *                      they joined), so they came off the list
 *                      → Got it (call them if you like)
 * Server only.
 */
import { formatMoney } from '@lib/money'
import { tokenOf } from './decided'
import type { ScheduledClass } from './types'
import { waitlistOrNull, lastAttempt, type WaitlistAttempt, type WaitlistEntry } from './waitlist-store'

/** Declined or skipped people stay on To decide this long (or until "Got it"). */
export const WAITLIST_DECLINED_DAYS = 14

export interface WaitlistItem {
  id: string
  kind: 'waitlist-unknown' | 'waitlist-declined'
  at: string
  entry: WaitlistEntry
  /** "Potholder Looms: …" for the warnings line. */
  warning: string
  /** For To decide's head. */
  head: string
}

const nameOf = (e: WaitlistEntry) => `${e.customer.givenName} ${e.customer.familyName}`.trim()

/** M5: only the messages that actually went out. `texts`: whether a text was part of it at all. */
function toldWords(told: WaitlistAttempt['told'], texts: boolean): string {
  if (!told) return texts ? 'We tried to text and email them.' : 'We tried to email them.'
  if (told.text && told.email) return 'They got a text and an email.'
  if (told.email) return texts ? 'They got an email (no text went out).' : 'They got an email.'
  if (told.text) return 'They got a text (the email didn’t go out).'
  return 'Neither a text nor an email went out, so call them if you can.'
}

export const waitlistItemId = (e: WaitlistEntry) => tokenOf(`wl-${e.id}-${lastAttempt(e)?.n ?? 0}`)

export async function waitlistItems(cls: ScheduledClass, decided: Set<string>, now: Date): Promise<WaitlistItem[]> {
  const list = await waitlistOrNull(cls.id)
  if (!list) return []
  const out: WaitlistItem[] = []
  const name = cls.content.name
  for (const e of list.entries) {
    const a = lastAttempt(e)
    if (!a) continue
    const id = waitlistItemId(e)
    if (decided.has(id)) continue
    if (e.state === 'charging' && a.outcome === 'unknown') {
      const money = a.amountCents ? formatMoney(a.amountCents) : 'the class'
      out.push({
        id, kind: 'waitlist-unknown', at: a.at, entry: e,
        warning: `${name}: the waitlist charged ${nameOf(e)}’s saved card for ${money} and Square didn’t say whether it went through. Their seat is held.`,
        head: e.leaveAskedAt
          ? `We charged ${nameOf(e)}’s saved card (ending ${e.square.last4}) ${a.amountCents ? formatMoney(a.amountCents) : ''} from the waitlist for ${name}, and Square didn’t say whether it went through. They’ve since asked to leave, so that charge is never sent again. Their seat is held until we know.`.replace('  ', ' ')
          : `We charged ${nameOf(e)}’s saved card (ending ${e.square.last4}) ${a.amountCents ? formatMoney(a.amountCents) : ''} from the waitlist for ${name}, and Square didn’t say whether it went through. Their seat is held, and we ask Square again every 10 minutes.`.replace('  ', ' '),
      })
    } else if ((e.state === 'declined' || e.state === 'skipped') && Date.parse(a.at) >= now.getTime() - WAITLIST_DECLINED_DAYS * 86_400_000) {
      const price = e.state === 'skipped'
      out.push({
        id, kind: 'waitlist-declined', at: a.at, entry: e,
        warning: price
          ? a.skipWhy === 'gone'
            ? `${name}: ${nameOf(e)} was skipped on the waitlist because what they picked isn’t sold any more. Not charged.`
            : `${name}: ${nameOf(e)} was skipped on the waitlist because the price is now higher than they agreed to. Not charged.`
          : `${name}: ${nameOf(e)}’s card ending ${e.square.last4} didn’t go through, so the seat went to the next person. Not charged.`,
        head: price
          ? `${a.skipWhy === 'gone' ? `A seat opened in ${name}, but what ${nameOf(e)} picked isn’t sold any more` : `A seat opened in ${name}, but the price is now higher than the ${formatMoney(e.maxCents)} ${nameOf(e)} agreed to`}, so they weren’t charged and came off the waitlist. ${toldWords(a.told, false)}`
          : `A seat opened in ${name}, but ${nameOf(e)}’s card ending ${e.square.last4} didn’t go through, so they came off the waitlist and the seat went to the next person. ${toldWords(a.told, true)} Nothing was charged.`,
      })
    }
  }
  return out
}
