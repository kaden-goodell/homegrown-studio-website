/**
 * A class's prep list ("Lavender 3 · Black 2") from its seat records, for the
 * staff Today list and the This week summary. Never throws: a read that
 * fails leaves the prep off rather than failing the page.
 *
 * Our own classes (cls_ ids) count the answers on the seat ledger for one day
 * (`day`, else the class's first day), so each day of a multi-day class has
 * its own list.
 */
import { listSeatChoicesByEvent } from '@lib/seat-choices'
import { choiceTotals, prepOptions, type PrepOption, type SeatOption } from '@lib/seat-options'
import { createLogger } from '@lib/logger'
import { getClass } from '@lib/classes/class-store'
import { getLedger } from '@lib/classes/seat-ledger'
import { isOwnClassId, ownPrep } from '@lib/classes/staff-view'

const logger = createLogger('event-prep')

export async function prepForEvent(
  e: { kind: string; id: string; capacity?: number; seats?: number; options?: SeatOption[]; days?: string[] },
  day?: string,
): Promise<{ prep?: PrepOption[] }> {
  if (e.kind !== 'workshop') return {}
  const options = e.options ?? []
  if (options.length === 0) return {}
  try {
    if (isOwnClassId(e.id)) {
      const cls = await getClass(e.id)
      if (!cls) return {}
      const prep = ownPrep(cls, await getLedger(cls.id), day ?? e.days?.[0] ?? '', new Date())
      return prep ? { prep } : {}
    }
    const records = await listSeatChoicesByEvent('workshop', e.id)
    const sold = typeof e.capacity === 'number' && typeof e.seats === 'number' ? e.capacity - e.seats : null
    return { prep: prepOptions(options, choiceTotals(options, records.flatMap((r) => r.picks)), sold) }
  } catch (err) {
    logger.warn('Prep list not built', { id: e.id, error: err instanceof Error ? err.message : String(err) })
    return {}
  }
}
