# Waiver version archive

One file per released waiver version — the exact legal text customers signed under that
version string. Signed records store `version` + a SHA-256 hash of the serialized text
(`serializeAgreement()` in `src/config/waiver-content.ts`); this folder keeps each version's
text readable for posterity without digging through git history.

Rules:
- Bump `version` in `waiver-content.ts` on ANY change to `legalSections`.
- In the same commit, snapshot the new text here as `vN.md` (run:
  `npx tsx -e "import('./src/config/waiver-content.ts').then(m=>console.log(m.serializeAgreement()))" > docs/waiver-versions/vN.md`).
- Never edit an archived file after its version has taken a signature.
- After bumping, recompute the hash into `hashes.json` (see below) in the same commit —
  `tests/config/waiver-hashes.test.ts` fails on any edit that isn't accompanied by a bump.


## Hash manifest (`hashes.json`)

`hashes.json` holds `{ agreement: { vN: sha256 } }` for every version this repo's tests
check against — regenerate the current entry with:

```
npx tsx -e "
import { createHash } from 'node:crypto'
import { serializeAgreement, waiverContent } from './src/config/waiver-content.ts'
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
console.log(JSON.stringify({ [waiverContent.version]: sha(serializeAgreement()) }, null, 2))
"
```

`tests/config/waiver-hashes.test.ts` asserts the live text's hash matches this file for the
*current* version — the guard that catches an edit to `legalSections` that forgot to bump the version.

## Forced re-sign (HOM-210)

A returning household whose on-file signature predates `substantiveSince` can't one-tap
RSVP — they're routed to the full form instead. Bump this line only when a version change
is legally substantive (an administrative-only bump, like a rebrand, leaves it where
it is). Mirrored exactly as `substantiveSince` in `src/config/waiver-content.ts` — keep
the two in sync.

substantiveSince: v1
