/**
 * Drop-off Program Addendum (HOM-211) — small helper split out of
 * `@pages/api/waiver/sign.json` so that file doesn't keep growing. Mirrors
 * how `@config/waiver-content` hashes the base agreement, but for the
 * addendum's own separately-versioned text.
 */
import { createHash } from 'node:crypto'
import { dropOffAddendum, serializeAddendum } from '@config/waiver-content'
import type { StudioEvent } from '@lib/events'

/**
 * The addendum is only ever required for a studio-run drop-off event AND
 * only when a minor is actually attending — an adult-only drop-off
 * registration makes no sense, so it's skipped. `attending` mirrors
 * `RsvpRecord.attending`: a resolved id list, or `null` meaning "everyone in
 * the household" (in which case `minorsCount` decides).
 */
export function addendumRequired(
  event: StudioEvent | null,
  attending: string[] | null,
  minorsCount: number,
): boolean {
  if (!event?.dropOff) return false
  if (attending === null) return minorsCount > 0
  return attending.some((id) => id.startsWith('child:'))
}

/** The addendum's current version + a fresh hash of its live text — what
 *  gets written onto an `RsvpRecord` as `addendumVersion`/`addendumSha256`
 *  when a household accepts it. */
export function currentAddendum(): { version: string; sha256: string } {
  return {
    version: dropOffAddendum.version,
    sha256: createHash('sha256').update(serializeAddendum(), 'utf8').digest('hex'),
  }
}
