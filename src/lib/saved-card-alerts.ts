/**
 * Review I3: when Square refuses a saved-card request as a setup problem
 * (cardTroubleOf → 'setup': an expired token, a missing permission, rate
 * limiting, a rejected field), the owners hear about it ONCE per Chicago day,
 * whoever hits it (the waitlist save step, Task 9; the waitlist runner,
 * Task 10). No family is told anything; no card is disabled.
 *
 * The owner text names what Catherine can do herself: nothing in /admin can
 * renew the register connection (KNOWN GAP), so the plain fallback is to
 * take waitlisted people by phone until it works again.
 *
 * Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import { alertOwners } from '@lib/owner-alert'
import { chicagoYmd } from '@lib/classes/chicago-day'

const logger = createLogger('saved-card-alerts')
const markers = makeKvStore('card-setup-alerts', 'card-setup-alerts')

export const CARD_SETUP_ALERT = 'Square refused a saved-card request (a setup problem), so nobody was charged and no card was turned off. Saving cards for the waitlist and charging them is paused until it works again. Take waitlisted people by phone meanwhile.'

/** Texts the owners at most once per Chicago day. Never throws. Returns whether this call sent it. */
export async function alertCardSetupOnce(where: 'save' | 'charge', now = new Date()): Promise<boolean> {
  const key = `card-setup-${chicagoYmd(now)}`
  try {
    if (!(await markers.setIfMatch(key, JSON.stringify({ at: now.toISOString(), where }), null, false))) return false
  } catch (err) {
    logger.error('Card setup alert marker not written — not texting', { where, error: String(err) })
    return false
  }
  logger.error('Saved-card setup problem — owners told', { where })
  await alertOwners(CARD_SETUP_ALERT).catch(() => undefined)
  return true
}
