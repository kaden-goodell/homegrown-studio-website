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

Numbering restarted at v1 on 2026-08-03 (launch text): no production signatures existed
before this point, so draft-era v1–v4 (git history, Jul 2026) are not part of the series.
