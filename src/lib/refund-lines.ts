/**
 * The one-line refund terms shown beside a Pay button and on a confirmation.
 * Built from the policy settings, never typed, so they can't disagree with
 * the policy page.
 *
 * Client-safe.
 */
import { policyWindows } from '@config/policy-content'
import { partyConfig } from '@config/party.config'
import { formatMoney } from '@lib/money'
import { formatMonthDay } from '@lib/studio-time'

const DAY_MS = 86_400_000

export function workshopRefundLine(): string {
  const hours = policyWindows.workshopRefundHours
  return `Full refund up to ${hours} hours before. After that, studio credit or a free seat transfer.`
}

/**
 * For a party on a given date. The cash refund runs until a set number of
 * days before the party; a date booked inside that window is credit-only from
 * the moment it is paid, and the customer is told so before they pay.
 */
export function partyRefundLine(startIso: string, now: Date = new Date()): string {
  const days = policyWindows.partyFullRefundDays
  const lastFullRefund = new Date(new Date(startIso).getTime() - days * DAY_MS)
  if (lastFullRefund.getTime() > now.getTime()) {
    return `Full refund until ${formatMonthDay(lastFullRefund.toISOString())}. After that, studio credit.`
  }
  const fee = formatMoney(partyConfig.basePriceCents)
  return `This date is less than ${days} days away, so the ${fee} is refundable as studio credit, not cash. Free reschedule with ${policyWindows.partyRescheduleNoticeHours} hours’ notice.`
}
