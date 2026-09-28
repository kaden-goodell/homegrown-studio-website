/**
 * What a party costs, split the way it is paid:
 *
 *   PAY TODAY            the studio fee (and a themed table, when one is added)
 *   PAY AT THE STUDIO    the crafts, for whoever comes
 *   Estimated party total
 *
 * One model, used on the Guests step, the payment step and the /book page, so
 * the numbers can't disagree. Every amount comes from config or the catalog.
 *
 * Client-safe.
 */
import { partyConfig } from '@config/party.config'
import { craftTotalCents } from '@lib/party-pricing'
import { formatMoney } from '@lib/money'
import { formatDay, formatMonthDay, formatTime } from '@lib/studio-time'

export interface PartySummaryInput {
  /** ISO start of the chosen time, if one is chosen yet. */
  startIso?: string
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
  const fee = partyConfig.basePriceCents
  const guests = Math.max(0, Math.floor(input.guests))

  const today: SummaryLine[] = [
    {
      label: input.startIso
        ? `Studio fee, holds ${formatDay(input.startIso)} at ${formatTime(input.startIso)}`
        : 'Studio fee, holds your date',
      amount: formatMoney(fee),
    },
  ]
  if (input.themedTable && input.themedTable.priceCents > 0) {
    today.push({
      label: `Themed table, ${input.themedTable.name} (serves ${input.themedTable.serves})`,
      amount: formatMoney(input.themedTable.priceCents),
    })
  }
  const dueTodayCents = fee + (input.themedTable?.priceCents ?? 0)

  const atStudio: SummaryLine[] = []
  let estimatedTotal = ''
  if (input.craft) {
    const low = input.craft.perHeadCents
    const high = Math.max(low, input.craft.perHeadMaxCents ?? low)
    const lowTotal = craftTotalCents(low, guests)
    const highTotal = craftTotalCents(high, guests)
    atStudio.push({
      label: `${input.craft.name}, about ${guests} guests × ${range(low, high)}`,
      amount: `about ${range(lowTotal, highTotal)}`,
      note: `Only for guests who come. Minimum ${partyConfig.minGuests} crafts.`,
    })
    estimatedTotal = `about ${range(dueTodayCents + lowTotal, dueTodayCents + highTotal)}`
  }

  return {
    today,
    dueTodayCents,
    atStudio,
    estimatedTotal,
    payLabel: input.startIso
      ? `Pay ${formatMoney(dueTodayCents)} and reserve ${formatMonthDay(input.startIso)}`
      : `Pay ${formatMoney(dueTodayCents)} and reserve your date`,
  }
}
