/**
 * Expiry sweep (spec §5, S-41): a sent or picked quote past its expiry that
 * nobody paid texts the owners once ("Quote expired: <first name>, <date>").
 * expiryTold is written by compare-and-set FIRST and the text goes only when
 * that write changed it, so two runs at once never text twice. Reopen and a
 * later expiry date clear expiryTold. Run by the 10-minute job
 * (api/jobs/waitlist-sweep.json). Server only.
 */
import { createLogger } from '@lib/logger'
import { alertOwners } from '@lib/owner-alert'
import { getRequest } from '@lib/event-requests'
import { formatDay } from '@lib/studio-time'
import { listQuotes, updateQuote } from './quote-store'
import { isExpired, type Quote } from './types'

const logger = createLogger('quotes:expiry')

const due = (q: Quote, now: Date) => isExpired(q, now) && !q.expiryTold

async function firstNameOf(requestId: string): Promise<string> {
  try {
    return (await getRequest(requestId))?.about.name.trim().split(/\s+/)[0] || 'a customer'
  } catch {
    return 'a customer'
  }
}

export function quoteExpiredText(firstName: string, startIso: string | null): string {
  return `Quote expired: ${firstName}, ${startIso ? formatDay(startIso) : 'no date yet'}`
}

/** `expired`: quotes found past expiry and not yet told; `told`: texts sent (writes won). */
export async function sweepExpiredQuotes(now: Date = new Date()): Promise<{ expired: number; told: number }> {
  const open = (await listQuotes()).filter((q) => due(q, now))
  let told = 0
  for (const q of open) {
    try {
      let won = false
      const saved = await updateQuote(q.id, (cur) => {
        won = false
        if (!due(cur, now)) return null
        won = true
        return { ...cur, expiryTold: true }
      })
      if (!won) continue
      await alertOwners(quoteExpiredText(await firstNameOf(saved.requestId), saved.startIso))
      told++
    } catch (err) {
      logger.error('Quote expiry not recorded', { quoteId: q.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { expired: open.length, told }
}
