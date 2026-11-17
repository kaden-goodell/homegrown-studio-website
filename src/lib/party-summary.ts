/**
 * What a party costs, split the way it is paid:
 *
 *   PAY TODAY            the package (the studio fee, or on a weeknight the
 *                        craft credit), the extras chosen, and a themed table
 *                        when one is added
 *   PAY AT THE STUDIO    the crafts, for whoever comes (weeknight: less the
 *                        credit, with the minimum)
 *   Estimated party total
 *
 * One model, used on the Guests step, the payment step and the /book page, so
 * the numbers can't disagree. Every amount comes from the party settings
 * (the config until an owner saves Parties setup) or the catalog; the server
 * prices the booking again from the same settings.
 *
 * Client-safe.
 */
import { partyConfig } from '@config/party.config'
import { craftTotalCents } from '@lib/party-pricing'
import { dueAtStudioCents, partyEstimateCents, partyTermsForStart, termsForKind, type PartyKind } from '@lib/party-terms'
import { formatMoney } from '@lib/money'
import { formatDay, formatMonthDay, formatTime } from '@lib/studio-time'

export interface PartySummaryInput {
  /** ISO start of the chosen time, if one is chosen yet. Its day sets the terms. */
  startIso?: string
  /** Weekend or weeknight, before a time is chosen. A start time wins over this. */
  kind?: PartyKind
  craft?: { name: string; perHeadCents: number; perHeadMaxCents?: number } | null
  guests: number
  /**
   * The package being booked: its fee and the craft minimum. Absent = the
   * config's studio fee. `name` is shown in place of "Studio fee" (only
   * when there was a package to choose).
   */
  pkg?: { id?: string; name?: string; priceCents: number; minGuests: number } | null
  /** Extras paid today, priced as the server prices them (pricing.ts quote items). */
  extras?: SummaryExtra[]
  /** A themed table charged today, when that feature is on and one is chosen. */
  themedTable?: { name: string; serves: number; priceCents: number } | null
}

export interface SummaryExtra {
  label: string
  /** How many were chosen: per party, or per guest for a per-guest extra. */
  count: number
  /** Per-guest extras: the guests it is for. */
  forGuests?: number
  unitCents: number
  cents: number
}

export interface SummaryLine {
  label: string
  /** Already formatted: "$300", "about $200", "about $300–$400". */
  amount: string
  note?: string
}

export interface PartySummary {
  kind: PartyKind
  today: SummaryLine[]
  /** What the card is charged now, in cents. */
  dueTodayCents: number
  atStudio: SummaryLine[]
  /** "about $500", or "" until a craft is chosen. */
  estimatedTotal: string
  /** "Pay $300 and reserve Oct 17" */
  payLabel: string
}

function range(minCents: number, maxCents: number): string {
  return maxCents > minCents ? `${formatMoney(minCents)}–${formatMoney(maxCents)}` : formatMoney(minCents)
}

/** "Goodie bags, 12 guests × $8", "Extra half hour", "Balloons × 3". */
function extraLabel(e: SummaryExtra): string {
  if (e.forGuests !== undefined) {
    const each = e.count > 1 ? `${e.count} each for ` : ''
    return `${e.label}, ${each}${e.forGuests} guests × ${formatMoney(e.unitCents)}`
  }
  return e.count > 1 ? `${e.label} × ${e.count}` : e.label
}

export function partySummary(input: PartySummaryInput): PartySummary {
  const minGuests = input.pkg?.minGuests ?? partyConfig.minGuests
  const feeName = input.pkg?.name || 'Studio fee'
  // Weeknights (Mon–Wed) have their own terms for the whole-studio package: the charge is a craft credit.
  const wholeStudio = !input.pkg?.id || input.pkg.id === 'pkg_whole'
  const dayTerms = input.startIso ? partyTermsForStart(input.startIso) : termsForKind(input.kind ?? 'weekend')
  const terms = wholeStudio ? dayTerms : termsForKind('weekend')
  const credit = terms.chargeIsCraftCredit
  const charge = credit ? terms.chargeNowCents : input.pkg?.priceCents ?? partyConfig.basePriceCents
  const guests = Math.max(0, Math.floor(input.guests))
  const holds = input.startIso ? `holds ${formatDay(input.startIso)} at ${formatTime(input.startIso)}` : 'holds your date'

  const today: SummaryLine[] = [
    credit
      ? {
          label: `Craft credit, ${holds}`,
          amount: formatMoney(charge),
          note: 'Counts toward your crafts. No studio fee on weeknights.',
        }
      : { label: `${feeName}, ${holds}`, amount: formatMoney(charge) },
  ]
  const extras = input.extras ?? []
  for (const e of extras) today.push({ label: extraLabel(e), amount: formatMoney(e.cents) })
  if (input.themedTable && input.themedTable.priceCents > 0) {
    today.push({
      label: `Themed table, ${input.themedTable.name} (serves ${input.themedTable.serves})`,
      amount: formatMoney(input.themedTable.priceCents),
    })
  }
  const otherCents = extras.reduce((t, e) => t + e.cents, 0) + (input.themedTable?.priceCents ?? 0)
  const dueTodayCents = charge + otherCents

  const atStudio: SummaryLine[] = []
  let estimatedTotal = ''
  if (input.craft) {
    const low = input.craft.perHeadCents
    const high = Math.max(low, input.craft.perHeadMaxCents ?? low)
    const lowTotal = craftTotalCents(low, guests)
    const highTotal = craftTotalCents(high, guests)
    if (credit) {
      // One line (Kaden, 15 Nov 2026: "way too busy"): $0 while the credit covers
      // the crafts, then only what goes over it.
      const dueLow = dueAtStudioCents(terms, lowTotal)
      const dueHigh = dueAtStudioCents(terms, highTotal)
      atStudio.push(
        dueHigh === 0
          ? { label: 'Crafts', amount: formatMoney(0), note: `Your ${formatMoney(charge)} covers the crafts.` }
          : {
              label: 'Crafts',
              amount: `about ${range(dueLow, dueHigh)}`,
              note: `${guests} guests × ${range(low, high)}, less your ${formatMoney(charge)}.`,
            },
      )
      estimatedTotal = `about ${range(
        otherCents + partyEstimateCents(terms, lowTotal),
        otherCents + partyEstimateCents(terms, highTotal),
      )}`
    } else {
      atStudio.push({
        label: `${input.craft.name}, about ${guests} guests × ${range(low, high)}`,
        amount: `about ${range(lowTotal, highTotal)}`,
        note: `Only for guests who come. Minimum ${minGuests} crafts.`,
      })
      estimatedTotal = `about ${range(dueTodayCents + lowTotal, dueTodayCents + highTotal)}`
    }
  }

  return {
    kind: terms.kind,
    today,
    dueTodayCents,
    atStudio,
    estimatedTotal,
    payLabel: input.startIso
      ? `Pay ${formatMoney(dueTodayCents)} and reserve ${formatMonthDay(input.startIso)}`
      : `Pay ${formatMoney(dueTodayCents)} and reserve your date`,
  }
}
