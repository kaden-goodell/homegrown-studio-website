/**
 * Regenerates `docs/WAIVER.md` from `src/config/waiver-content.ts` (HOM-219).
 * Run this any time `legalSections` or `counselNotes`
 * change — `tests/config/waiver-hashes.test.ts` fails CI if the file on
 * disk drifts from this output.
 *
 * Usage: npm run gen:waiver
 */
import { writeFileSync } from 'node:fs'
import { generateWaiverDoc } from '../src/lib/waiver-doc'

writeFileSync('docs/WAIVER.md', generateWaiverDoc())
console.log('Wrote docs/WAIVER.md')
