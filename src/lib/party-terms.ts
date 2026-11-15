/**
 * What a party on a given day costs and how long it runs. THE one place that
 * turns the weekday schedule (partyDays / partyDateOverrides) into terms, so the
 * slots, the clash checks, the price summary, the charge and the staff views
 * can't disagree.
 *
 *   weekend    studio fee (paid online) + crafts at the register
 *   weeknight  no studio fee; crafts with a minimum; the online payment is a
 *              craft credit that counts toward the crafts
 *
 * Client-safe: config only, no env.
 */
import { partyConfig, partyDays, partyDateOverrides, type PartyDay, type PartyKind } from '../config/party.config'

export type { PartyKind }

export interface PartyTerms {
  kind: PartyKind
  /** Party length, cleanup not included. */
  durationMinutes: number
  /** Room fee on top of crafts. 0 on weeknights. */
  studioFeeCents: number
  /** The least the crafts can come to. 0 on weekends (the 10-craft minimum is separate). */
  minimumCents: number
  /** What the card is charged to book (before any add-on). */
  chargeNowCents: number
  /** True when that charge counts toward the crafts rather than being a fee. */
  chargeIsCraftCredit: boolean
}

function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

/** Studio-local YYYY-MM-DD of an ISO instant. */
function studioYmd(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: partyConfig.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/** The schedule entry for a day (a one-off override wins), or undefined when no parties run. */
export function partyDayOn(ymd: string): PartyDay | undefined {
  return partyDateOverrides[ymd] ?? partyDays[weekdayOf(ymd)]
}

/** Weekend or weeknight. A day with no parties counts as weekend (the default terms). */
export function partyKindOn(ymd: string): PartyKind {
  return partyDayOn(ymd)?.kind ?? 'weekend'
}

export function termsForKind(kind: PartyKind, durationMinutes?: number): PartyTerms {
  if (kind === 'weeknight') {
    return {
      kind,
      durationMinutes: durationMinutes ?? 120,
      studioFeeCents: 0,
      minimumCents: partyConfig.weeknightMinimumCents,
      chargeNowCents: partyConfig.weeknightMinimumCents,
      chargeIsCraftCredit: true,
    }
  }
  return {
    kind,
    durationMinutes: durationMinutes ?? partyConfig.durationMinutes,
    studioFeeCents: partyConfig.basePriceCents,
    minimumCents: 0,
    chargeNowCents: partyConfig.basePriceCents,
    chargeIsCraftCredit: false,
  }
}

/** Terms for a party on this studio-local date. */
export function partyTermsOn(ymd: string): PartyTerms {
  const day = partyDayOn(ymd)
  return termsForKind(day?.kind ?? 'weekend', day?.durationMinutes)
}

/** Terms for a party starting at this instant (read on the studio's calendar). */
export function partyTermsForStart(iso: string): PartyTerms {
  // Not a time at all (a hand-edited link): the default terms, never a throw.
  if (Number.isNaN(Date.parse(iso))) return termsForKind('weekend')
  return partyTermsOn(studioYmd(iso))
}

/** What the whole party comes to for a given crafts total: fee + crafts, crafts never under the minimum. */
export function partyEstimateCents(terms: PartyTerms, craftsCents: number): number {
  return terms.studioFeeCents + Math.max(craftsCents, terms.minimumCents)
}

/**
 * What is left to pay at the register for a given crafts total. Weekend: the
 * crafts. Weeknight: crafts (at least the minimum) less the credit, never below 0.
 */
export function dueAtStudioCents(terms: PartyTerms, craftsCents: number): number {
  if (!terms.chargeIsCraftCredit) return craftsCents
  return Math.max(0, Math.max(craftsCents, terms.minimumCents) - terms.chargeNowCents)
}
