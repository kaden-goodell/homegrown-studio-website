/**
 * Flag parsing for scripts/set-event.ts. Pure, so it is tested; the script
 * does the reading and writing. The rules themselves (limits, the lock once
 * anyone has picked) are applied by `mergeEventMeta`, same as the gear sheet.
 */
import type { EventMetaPatch } from '@lib/event-meta'
import { validateCutoffHours } from '@lib/seat-options'

export interface SetEventArgs {
  kind: 'workshop' | 'party'
  id: string
  show: boolean
  patch: EventMetaPatch
}

export const SET_EVENT_USAGE =
  'Usage: set-event.ts (--workshop <clssch_id> | --party <bookingId>) [--on | --off] [--days a,b] ' +
  '[--option "Label=Choice|Choice" …] [--no-options] [--cutoff <hours> | --cutoff default] [--show]'

export function parseSetEventArgs(argv: string[]): SetEventArgs | { error: string } {
  const flag = (n: string) => {
    const i = argv.indexOf(`--${n}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const has = (n: string) => argv.includes(`--${n}`)

  const kind = flag('workshop') ? 'workshop' : flag('party') ? 'party' : null
  const id = flag('workshop') ?? flag('party')
  if (!kind || !id) return { error: SET_EVENT_USAGE }

  const patch: EventMetaPatch = {}
  if (has('on')) patch.dropOff = true
  if (has('off')) patch.dropOff = false
  const daysArg = flag('days')
  if (daysArg !== undefined) {
    patch.days = daysArg ? daysArg.split(',').map((s) => s.trim()).filter(Boolean).sort() : null
  }

  const optionArgs = argv.flatMap((a, i) => (a === '--option' && argv[i + 1] !== undefined ? [argv[i + 1]] : []))
  if (optionArgs.length > 0 || has('no-options')) {
    if (kind !== 'workshop') return { error: 'Questions for each seat are for classes (--workshop) only.' }
    const options: NonNullable<EventMetaPatch['options']> = []
    for (const spec of optionArgs) {
      const eq = spec.indexOf('=')
      if (eq <= 0) return { error: `--option needs "Label=Choice|Choice", got "${spec}".` }
      options.push({ id: '', label: spec.slice(0, eq).trim(), choices: spec.slice(eq + 1).split('|').map((c) => c.trim()) })
    }
    patch.options = options
  }

  const cutoff = flag('cutoff')
  if (cutoff !== undefined) {
    if (kind !== 'workshop') return { error: 'Sign-up cutoffs are for classes (--workshop) only.' }
    const checked = validateCutoffHours(cutoff === 'default' ? null : Number(cutoff))
    if (!checked.ok) return { error: checked.error }
    patch.signupCutoffHours = checked.value
  }

  return { kind, id, show: has('show'), patch }
}
