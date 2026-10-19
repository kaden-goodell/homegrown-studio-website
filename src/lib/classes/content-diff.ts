/**
 * What changed between two copies of a class's details, in the owner's words
 * ("Price", "Description"). Pure and browser-safe: the class sheet uses it to
 * decide whether to offer "This class and the library", and the library
 * store records it on each version.
 */
import type { ClassContent } from './types'

/** JSON with keys in a fixed order, so two equal objects always read the same. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

/**
 * The parts of a class's details that differ, in form order. With
 * `usual: false` the library-only defaults (how long it usually runs, the
 * seats it usually has) are left out: a class's own dates and seats never
 * count as a change to its details.
 */
export function contentChanges(a: ClassContent, b: ClassContent, opts: { usual?: boolean } = {}): string[] {
  const out: string[] = []
  const differs = (x: unknown, y: unknown) => canon(x) !== canon(y)
  if (a.name !== b.name) out.push('Name')
  if (differs(a.imageUrl ?? null, b.imageUrl ?? null)) out.push('Photo')
  if (differs(a.prices, b.prices)) out.push('Price')
  if (a.rules.ages !== b.rules.ages) out.push('Ages')
  if (a.description !== b.description) out.push('Description')
  if ((a.instructor ?? '') !== (b.instructor ?? '')) out.push('Teacher')
  if (differs(a.passes, b.passes)) out.push('Ways to book')
  if (differs(a.ticketTypes, b.ticketTypes)) out.push('Seat prices')
  if (differs(a.addOns, b.addOns)) out.push('Extras')
  if (differs(a.questions, b.questions)) out.push('Questions')
  if (differs({ ...a.rules, ages: '' }, { ...b.rules, ages: '' })) out.push('Booking rules')
  if (opts.usual !== false) {
    if (a.defaultMinutes !== b.defaultMinutes) out.push('How long it usually runs')
    if (a.defaultCapacity !== b.defaultCapacity) out.push('Seats it usually has')
  }
  return out
}

/** Same details for a class (its dates, status and seats aside)? */
export const sameDetails = (a: ClassContent, b: ClassContent) => contentChanges(a, b, { usual: false }).length === 0
