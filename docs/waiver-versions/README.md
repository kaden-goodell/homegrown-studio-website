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
- After bumping, recompute BOTH hashes into `hashes.json` (see below) in the same commit —
  `tests/config/waiver-hashes.test.ts` fails on any edit that isn't accompanied by a bump.

Numbering restarted at v1 on 2026-08-03 (launch text): no production signatures existed
before this point, so draft-era v1–v4 (git history, Jul 2026) are not part of the series.

## Drop-off Program Addendum (HOM-211)

`addendum-aN.md` archives the **Drop-off Program Addendum** (`dropOffAddendum` in
`waiver-content.ts`, serialized by `serializeAddendum()`) — the supplement to Agreement §4(c)
that a household accepts, separately from the base agreement, when registering a minor for a
studio-run drop-off program (camp, kids' workshop, Parents' Night Out). It has its own
version series (`a1`, `a2`, …), bumped and archived under the exact same rule as the base
agreement above — any change to `dropOffAddendum.sections` bumps `version` and gets a new
`addendum-aN.md` + a `hashes.json` update in the same commit. RSVP records store
`addendumVersion` + `addendumSha256` alongside the base agreement's `agreementVersion` +
`agreementSha256`, so the two are proven independently.

## Hash manifest (`hashes.json`)

`hashes.json` holds `{ agreement: { vN: sha256 }, addendum: { aN: sha256 } }` for every
version this repo's tests check against — regenerate an entry with:

```
npx tsx -e "
import { createHash } from 'node:crypto'
import { serializeAgreement, serializeAddendum, waiverContent, dropOffAddendum } from './src/config/waiver-content.ts'
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
console.log(JSON.stringify({ agreement: { [waiverContent.version]: sha(serializeAgreement()) }, addendum: { [dropOffAddendum.version]: sha(serializeAddendum()) } }, null, 2))
"
```

`tests/config/waiver-hashes.test.ts` asserts the live text's hash matches this file for the
*current* version of each — the guard that catches an edit to `legalSections` or
`dropOffAddendum.sections` that forgot to bump the version.

## Forced re-sign (HOM-210)

A returning household whose on-file signature predates `substantiveSince` can't one-tap
RSVP — they're routed to the full form instead. Bump this line only when a version change
is legally substantive (an administrative-only bump, like v1→v2's rebrand, leaves it where
it is). Mirrored exactly as `substantiveSince` in `src/config/waiver-content.ts` — keep
the two in sync.

substantiveSince: v1
