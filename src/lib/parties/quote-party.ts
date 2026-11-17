/**
 * Parties born from a private-event quote (`origin: 'quote'`): the package
 * is priced per person with the crafts included, so there is no studio fee
 * and no craft minimum. Its money is a deposit line and, once the deposit is
 * paid, a balance line (both item kind 'quote').
 *
 * Pure and browser-safe: types only.
 */
import type { PartyItem, PartyRecord } from '../party-store'

/** What the owner tools say when asked to change a quote's lines or guests. */
export const QUOTE_PARTY_LOCKED = 'This is a private event quote. Change it with the owners.'

export const isQuoteParty = (r: Pick<PartyRecord, 'origin'>): boolean => r.origin === 'quote'

const quoteItems = (r: Pick<PartyRecord, 'items'>): PartyItem[] => (r.items ?? []).filter((it) => it.kind === 'quote')

/** The whole event: guests × the tier's price per person; without a price, the quote lines on the party. */
export function quoteTotalCents(r: Pick<PartyRecord, 'items' | 'quote'>): number {
  const pp = r.quote?.pricePerPersonCents
  if (typeof pp === 'number' && pp > 0) return pp * r.quote!.guests
  return quoteItems(r).reduce((t, it) => t + it.cents, 0)
}

/** The deposit: the first quote line (the one the quote page charges). */
export function quoteDepositCents(r: Pick<PartyRecord, 'items'>): number {
  return quoteItems(r)[0]?.cents ?? 0
}

/** What is left of the whole event after what is paid (the balance line may not be on the party yet). */
export function quoteStillDueCents(r: Pick<PartyRecord, 'items' | 'quote'>): number {
  const paid = quoteItems(r).filter((it) => it.chargeId !== null).reduce((t, it) => t + it.cents, 0)
  return Math.max(0, quoteTotalCents(r) - paid)
}

/**
 * The amount the refund line names: the deposit for a quote party, the
 * package lines (the studio fee) for any other. Undefined → the default fee.
 */
export function partyRefundBaseCents(r: Pick<PartyRecord, 'items' | 'origin'>): number | undefined {
  if (isQuoteParty(r)) return quoteDepositCents(r) || undefined
  return (r.items ?? []).filter((it) => it.kind === 'package').reduce((t, it) => t + it.cents, 0) || undefined
}
