/**
 * Text the owners when something needs a person: a "tell me when it opens"
 * sign-up, a waitlist request, someone planning a later party date.
 *
 * Goes out FROM the studio number through Quo (see quo.ts) TO the mobiles of
 * the owners picked in /admin › More › Notifications (notify-settings.ts);
 * until an owner saves there, or when nobody picked has a mobile, the numbers
 * in OWNER_ALERT_NUMBERS (comma-separated, the site setup). No numbers or no
 * Quo → a quiet no-op, so a sign-up can never fail because an alert couldn't
 * be sent. Slack (providers.notification) stays the second channel.
 */
import { createLogger } from '@lib/logger'
import { quoConfigured, sendQuoText } from '@lib/quo'
import { recipientsFor } from '@lib/notify-settings'

const logger = createLogger('owner-alert')

/** Long enough to be useful, short enough to stay near one or two segments. */
const MAX_LENGTH = 300

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** The numbers in the site setup (OWNER_ALERT_NUMBERS). */
export function ownerAlertNumbers(): string[] {
  return env('OWNER_ALERT_NUMBERS')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
}

/**
 * Never throws. `sent` is how many owner phones the text actually reached.
 * `row`: which Notifications row decides who ('booking-alerts' for "someone
 * just booked"; everything else is 'owner-texts').
 */
export async function alertOwners(content: string, row: 'owner-texts' | 'booking-alerts' = 'owner-texts'): Promise<{ attempted: number; sent: number }> {
  if (!quoConfigured()) return { attempted: 0, sent: 0 }
  const numbers = await recipientsFor(row, 'text').catch(() => ownerAlertNumbers())
  if (numbers.length === 0) return { attempted: 0, sent: 0 }

  const text = content.length > MAX_LENGTH ? `${content.slice(0, MAX_LENGTH - 1)}…` : content
  const results = await Promise.allSettled(numbers.map((to) => sendQuoText({ to, content: text })))
  const sent = results.filter((r) => r.status === 'fulfilled').length
  if (sent < numbers.length) {
    logger.error('Owner alert did not reach every phone', { attempted: numbers.length, sent })
  }
  return { attempted: numbers.length, sent }
}
