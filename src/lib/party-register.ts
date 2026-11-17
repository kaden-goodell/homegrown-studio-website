/**
 * What staff collect at the register for a weeknight party. The host paid a
 * craft credit online, which comes off the crafts; crafts have a minimum, so
 * the credit is always used up and nothing is ever refunded at the counter.
 *
 * Weekend parties are rung up as before (crafts for whoever crafts), so this
 * says nothing for them. A private event (origin 'quote') has its crafts in
 * the package: no minimum, nothing to ring up for crafts.
 *
 * Client-safe.
 */
import { formatMoney } from '@lib/money'
import { dueAtStudioCents, termsForKind } from '@lib/party-terms'

export interface RegisterNote {
  headline: string
  how: string
  /** "12 crafting at $20: crafts $240, collect $0", when the price is known. */
  estimate?: string
}

export function weeknightRegisterNote(
  pay: { kind: 'weekend' | 'weeknight'; paidOnlineCents: number; perHeadCents?: number; origin?: 'quote' } | undefined,
  crafting: number,
): RegisterNote | null {
  if (pay?.origin === 'quote') {
    return { headline: 'Private event · crafts included', how: 'The crafts are part of the package. Nothing to ring up for crafts.' }
  }
  if (!pay || pay.kind !== 'weeknight') return null
  const paid = formatMoney(pay.paidOnlineCents)
  const terms = { ...termsForKind('weeknight'), chargeNowCents: pay.paidOnlineCents }
  const note: RegisterNote = {
    headline: `Weeknight party · ${paid} already paid toward crafts`,
    how: `Ring up the crafts, then tap the Weeknight craft credit discount. Collect what’s left. If the crafts come to ${formatMoney(terms.minimumCents)} or less, there’s nothing more to collect.`,
  }
  if (pay.perHeadCents && crafting > 0) {
    const crafts = pay.perHeadCents * crafting
    note.estimate = `${crafting} crafting at ${formatMoney(pay.perHeadCents)} makes ${formatMoney(crafts)} in crafts. Collect ${formatMoney(dueAtStudioCents(terms, crafts))}.`
  }
  return note
}
