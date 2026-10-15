/**
 * A class's prep list ("Lavender 3 · Black 2") from its seat records, for the
 * staff Today list and the This week summary. Never throws: a read that
 * fails leaves the prep off rather than failing the page.
 */
import { listSeatChoicesByEvent } from '@lib/seat-choices'
import { choiceTotals, prepOptions, type PrepOption, type SeatOption } from '@lib/seat-options'
import { createLogger } from '@lib/logger'

const logger = createLogger('event-prep')

export async function prepForEvent(e: { kind: string; id: string; capacity?: number; seats?: number; options?: SeatOption[] }): Promise<{ prep?: PrepOption[] }> {
  if (e.kind !== 'workshop') return {}
  const options = e.options ?? []
  if (options.length === 0) return {}
  try {
    const records = await listSeatChoicesByEvent('workshop', e.id)
    const sold = typeof e.capacity === 'number' && typeof e.seats === 'number' ? e.capacity - e.seats : null
    return { prep: prepOptions(options, choiceTotals(options, records.flatMap((r) => r.picks)), sold) }
  } catch (err) {
    logger.warn('Prep list not built', { id: e.id, error: err instanceof Error ? err.message : String(err) })
    return {}
  }
}
