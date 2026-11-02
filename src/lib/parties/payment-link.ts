/**
 * The payment link: a page where the host of a party an owner booked (or
 * that had extras added later) pays what is still due. Its key is the
 * party's `payToken`, never the host page key (S2-R6: the host page shows
 * other families' children and allergies).
 *
 * `sendPaymentLink` emails and texts the host the link (both go through the
 * preview reroute in sendEmail / sendQuoText, so a namespaced preview only
 * ever reaches Kaden) and notes it on the party (`linkSent`).
 *
 * Server only.
 */
import { createLogger } from '@lib/logger'
import { sendPartyPaymentLinkEmail } from '@lib/email'
import { sendQuoText } from '@lib/quo'
import { formatDay, formatTime } from '@lib/studio-time'
import { formatMoney } from '@lib/money'
import type { By } from '@lib/staff-auth'
import { updatePartyRecord, type PartyRecord } from '@lib/party-store'
import { dueCents } from './money'

const logger = createLogger('parties:payment-link')

/** The pay page for this party. Throws when the party has no payment key. */
export function payLinkUrl(origin: string, rec: PartyRecord): string {
  if (!rec.payToken) throw new Error('This party has no payment link.')
  return `${origin.replace(/\/$/, '')}/party/pay/${encodeURIComponent(rec.bookingId)}?k=${encodeURIComponent(rec.payToken)}`
}

/** "Sat, Nov 8 at 1:30 PM" (studio time). */
export function partyWhenLabel(startIso: string): string {
  return `${formatDay(startIso)} at ${formatTime(startIso)}`
}

/** Only extras added since are due (something on the party is already paid). */
export function extrasOnly(rec: PartyRecord): boolean {
  return (rec.items ?? []).some((it) => it.chargeId !== null)
}

/** "a, b and c" */
export function andList(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/**
 * What the money is for, in the host's words (D1: crafts are never charged
 * online, so the link only ever carries the studio fee and priced extras,
 * and says which): "the studio fee", "the studio fee and Goodie bags",
 * "Goodie bags". `items`: the ones to name (default: what is due now).
 */
/** "Goodie bags" → "goodie bags" mid-sentence; "DJ" stays "DJ". */
const midSentence = (label: string) => (/^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label)

export function whatIsDue(rec: PartyRecord, items = (rec.items ?? []).filter((it) => it.chargeId === null)): string {
  const words = [...new Set(items.map((it) => (it.kind === 'package' ? 'the studio fee' : midSentence(it.label))))]
  return andList(words) || 'your party'
}

/** DRAFT copy for Kaden: the text with the link (a second wording when only extras are due). No colons, no crafts charge. */
export function paymentLinkText(rec: PartyRecord, url: string): string {
  const amount = formatMoney(dueCents(rec))
  if (extrasOnly(rec)) return `Hometown Studio here. Pay ${amount} for ${whatIsDue(rec)}, added to your party on ${partyWhenLabel(rec.startIso)}. ${url}`
  return `Hometown Studio here. Your party on ${partyWhenLabel(rec.startIso)} is held for you. Pay ${amount} for ${whatIsDue(rec)} here to finish booking. Crafts are paid at the studio. ${url}`
}

export class PaymentLinkError extends Error {}

/**
 * Email and text the host the payment link and note it on the party. Each
 * channel is tried on its own; `email` / `text` say which went out. Refused
 * (PaymentLinkError) for a party that isn't ours, isn't booked, has no key
 * or owes nothing.
 */
export async function sendPaymentLink(
  rec: PartyRecord, origin: string, by: By | null,
): Promise<{ url: string; email: boolean; text: boolean; rec: PartyRecord }> {
  if (rec.source !== 'ours' || rec.status !== 'booked') throw new PaymentLinkError('Only a booked party of ours can be paid by link.')
  if (!rec.payToken) throw new PaymentLinkError('This party has no payment link.')
  const due = dueCents(rec)
  if (due <= 0) throw new PaymentLinkError('Nothing is due on this party.')
  const url = payLinkUrl(origin, rec)
  const givenName = rec.hostName.split(' ')[0] ?? ''

  let email = false
  if (rec.hostEmail) {
    try {
      email = (await sendPartyPaymentLinkEmail({ to: rec.hostEmail, givenName, whenLabel: partyWhenLabel(rec.startIso), dueCents: due, payUrl: url, extrasOnly: extrasOnly(rec), what: whatIsDue(rec) })).sent
    } catch (err) {
      logger.error('Payment link email failed', { partyId: rec.bookingId, error: String(err) })
    }
  }
  let text = false
  if (rec.hostPhone) {
    try {
      await sendQuoText({ to: rec.hostPhone, content: paymentLinkText(rec, url) })
      text = true
    } catch (err) {
      logger.error('Payment link text failed', { partyId: rec.bookingId, error: String(err) })
    }
  }

  const at = new Date().toISOString()
  const how = [email ? 'emailed' : null, text ? 'texted' : null].filter(Boolean).join(' and ') || 'not delivered'
  let saved = rec
  try {
    saved = await updatePartyRecord(
      rec.bookingId,
      (r) => ({ ...r, linkSent: [...(r.linkSent ?? []), { at, by, email, text, startIso: rec.startIso }] }),
      `Payment link ${how}`,
      by,
    )
  } catch (err) {
    logger.error('Payment link sent but not noted on the party', { partyId: rec.bookingId, error: String(err) })
  }
  return { url, email, text, rec: saved }
}
