/**
 * Flag parsing for scripts/set-event.ts. Pure, so it is tested; the script
 * does the reading and writing. The rules themselves (limits, the lock once
 * anyone has picked) are applied by `mergeEventMeta`, same as the gear sheet.
 */
import type { EventMetaPatch } from '@lib/event-meta'
import { validateCutoffHours, type SeatOption } from '@lib/seat-options'

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

/**
 * Reading one key through `netlify blobs:get`. A missing key prints
 * "Blob <key> does not exist in store …" and still exits 0, so the text is
 * what tells "missing" from a real failure (expired login, network). Only
 * "missing" may fall back to a fresh record; "error" must stop before a write.
 */
export function classifyBlobRead(stdout: string, stderr: string, exitCode: number): 'ok' | 'missing' | 'error' {
  if (/does not exist in store/i.test(`${stderr}\n${stdout}`)) return 'missing'
  if (exitCode !== 0) return 'error'
  const start = stdout.indexOf('{')
  if (start < 0) return 'error'
  try {
    JSON.parse(stdout.slice(start))
    return 'ok'
  } catch {
    return 'error'
  }
}

/**
 * Give each given question the id of the one it replaces, so stored picks
 * (which hang off the id) survive a re-send or rename. Matched by label
 * (case-insensitive); otherwise a current question at the same position whose
 * label is absent from the new list is taken as renamed. Anything else gets
 * an empty id (a fresh one is minted on validation). Pure.
 */
export function echoOptionIds(current: SeatOption[], given: SeatOption[]): SeatOption[] {
  const lc = (s: string) => s.toLowerCase()
  return given.map((o, i) => {
    const same = current.find((c) => lc(c.label) === lc(o.label))
    const prev = current[i]
    const renamed = prev && !given.some((g) => lc(g.label) === lc(prev.label)) ? prev : undefined
    return { ...o, id: (same ?? renamed)?.id ?? '' }
  })
}
