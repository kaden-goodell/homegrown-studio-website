/**
 * What a party costs, split the way it is paid:
 *
 *   PAY TODAY            the package (the studio fee), the extras chosen, and
 *                        a themed table when one is added
 *   PAY AT THE STUDIO    the crafts, for whoever comes
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
import { formatMoney } from '@lib/money'
import { formatDay, formatMonthDay, formatTime } from '@lib/studio-time'

export interface PartySummaryInput {
  /** ISO start of the chosen time, if one is chosen yet. */
  startIso?: string
  craft?: { name: string; perHeadCents: number; perHeadMaxCents?: number } | null
  guests: number
  /**
   * The package being booked: its fee and the craft minimum. Absent = the
   * config's studio fee. `name` is shown in place of "Studio fee" (only
   * when there was a package to choose).
   */
  pkg?: { name?: string; priceCents: number; minGuests: number } | null
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
  const fee = input.pkg?.priceCents ?? partyConfig.basePriceCents
  const minGuests = input.pkg?.minGuests ?? partyConfig.minGuests
  const feeName = input.pkg?.name || 'Studio fee'
  const guests = Math.max(0, Math.floor(input.guests))

  const today: SummaryLine[] = [
    {
      label: input.startIso
        ? `${feeName}, holds ${formatDay(input.startIso)} at ${formatTime(input.startIso)}`
        : `${feeName}, holds your date`,
      amount: formatMoney(fee),
    },
  ]
  const extras = (input.extras ?? []).filter((e) => e.cents > 0)
  for (const e of extras) today.push({ label: extraLabel(e), amount: formatMoney(e.cents) })
  if (input.themedTable && input.themedTable.priceCents > 0) {
    today.push({
      label: `Themed table, ${input.themedTable.name} (serves ${input.themedTable.serves})`,
      amount: formatMoney(input.themedTable.priceCents),
    })
  }
  const dueTodayCents = fee + extras.reduce((t, e) => t + e.cents, 0) + (input.themedTable?.priceCents ?? 0)

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
      note: `Only for guests who come. Minimum ${minGuests} crafts.`,
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
