/**
 * What a party costs, split the way it is paid:
 *
 *   PAY TODAY            the studio fee (weekend) or the craft credit (weeknight),
 *                        and a themed table, when one is added
 *   PAY AT THE STUDIO    the crafts, for whoever comes (weeknight: less the credit,
 *                        with the minimum)
 *   Estimated party total
 *
 * One model, used on the Guests step, the payment step and the /book page, so
 * the numbers can't disagree. Every amount comes from config or the catalog.
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
  /** A themed table charged today, when that feature is on and one is chosen. */
  themedTable?: { name: string; serves: number; priceCents: number } | null
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

export function partySummary(input: PartySummaryInput): PartySummary {
  const terms = input.startIso ? partyTermsForStart(input.startIso) : termsForKind(input.kind ?? 'weekend')
  const credit = terms.chargeIsCraftCredit
  const charge = terms.chargeNowCents
  const guests = Math.max(0, Math.floor(input.guests))
  const holds = input.startIso ? `holds ${formatDay(input.startIso)} at ${formatTime(input.startIso)}` : 'holds your date'

  const today: SummaryLine[] = [
    credit
      ? {
          label: `Craft credit, ${holds}`,
          amount: formatMoney(charge),
          note: 'Counts toward your crafts. No studio fee on weeknights.',
        }
      : { label: `Studio fee, ${holds}`, amount: formatMoney(charge) },
  ]
  if (input.themedTable && input.themedTable.priceCents > 0) {
    today.push({
      label: `Themed table, ${input.themedTable.name} (serves ${input.themedTable.serves})`,
      amount: formatMoney(input.themedTable.priceCents),
    })
  }
  const tableCents = input.themedTable?.priceCents ?? 0
  const dueTodayCents = charge + tableCents

  const atStudio: SummaryLine[] = []
  let estimatedTotal = ''
  if (input.craft) {
    const low = input.craft.perHeadCents
    const high = Math.max(low, input.craft.perHeadMaxCents ?? low)
    const lowTotal = craftTotalCents(low, guests)
    const highTotal = craftTotalCents(high, guests)
    const craftLabel = `${input.craft.name}, about ${guests} guests × ${range(low, high)}`
    if (credit) {
      const minimum = formatMoney(terms.minimumCents)
      atStudio.push({
        label: craftLabel,
        amount: `about ${range(lowTotal, highTotal)}`,
        note:
          highTotal < terms.minimumCents
            ? `Only for guests who come. Under the ${minimum} minimum, so it counts as ${minimum}.`
            : `Only for guests who come. ${minimum} minimum.`,
      })
      atStudio.push({ label: 'Less your craft credit', amount: `−${formatMoney(charge)}` })
      const dueLow = dueAtStudioCents(terms, lowTotal)
      const dueHigh = dueAtStudioCents(terms, highTotal)
      atStudio.push({
        label: 'Left to pay at the studio',
        amount: dueHigh === 0 ? formatMoney(0) : `about ${range(dueLow, dueHigh)}`,
      })
    } else {
      atStudio.push({
        label: craftLabel,
        amount: `about ${range(lowTotal, highTotal)}`,
        note: `Only for guests who come. Minimum ${partyConfig.minGuests} crafts.`,
      })
    }
    estimatedTotal = `about ${range(
      tableCents + partyEstimateCents(terms, lowTotal),
      tableCents + partyEstimateCents(terms, highTotal),
    )}`
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
