---
name: project_waiver-lighter-form-oct2026
description: "Oct 7 2026 — agreement RESET to v1 (no capacity clause) + waiver sign-up form lightened on Kaden's call: adult DOB replaced by an 'I'm 19 or older' tick (ageConfirmed), emergency contact = name+phone, optional except drop-off, photo consent defaults to yes & never blocks; legal text untouched; opinion on the legal text's length recorded"
metadata:
  type: project
  originSessionId: 2dcd1843-324d-4cfb-b5af-16c757c96ae5
---

**Decision (Kaden, 2026-10-07, "Is our waiver too crazy?? … like they're checking into a gun range"):** the FORM was the complaint, not the legal text. Approved and shipped on `dev` (commit 5b2032c + WAIVER.md regen): adult date of birth → one required "I’m 19 or older" tick (`adult.ageConfirmed: true`, `adult.dob` is `''` on new records; old records still carry a DOB); emergency contact = name + phone only (relationship dropped from the form, stored `''`), OPTIONAL on a plain visit (half-filled pair refused client + server), REQUIRED for drop-off events (server checks after the event is known); photo consent defaults to YES and never blocks submit. Staff views show "none given — call the signer" when the contact is blank. `src/lib/dob-input.ts` deleted.

**Legal text (v3, ~1,650 words) — my opinion given, NOT changed:** heavy because of "death" in §2, cigar/tobacco, beer/wine hold-harmless, tallow-balm FDA/AS-IS section, custody court orders — mostly covering events not run yet. Keep: ordinary-negligence release, minor indemnification (AL parents can't waive kids' claims), medical auth, pickup rules. If trimmed: ~700 words + event-specific addenda + a 4-line plain-English box above the text. Attorney review of v3 still pending — good question to add there.

Related: [[project_waiver-custody-rail-shipped]], [[project_seat-options-oct2026]], [[feedback_right-sized-risk-advice]].

**AGREEMENT RESET TO v1 (Kaden, 2026-10-07, dev 65cb266):** the live `waivers` store was empty (nothing ever signed on prod), so `version`/`substantiveSince` = **v1**, archive = `v1.md` only, hashes.json only v1; code/tests/WAIVER.md/archive README no longer mention any earlier series or the retired addendum (old-version test cases use `v0`). §4b(f) is now only the cancel-for-low-enrollment sentence — **the "12 minors / two adult staff" capacity clause is GONE.** Also removed: the roster's hard-coded `DROP_OFF_CAP = 12` warning + badge; crew doc/door card say "minimum 2 adults, owners set headcount". Kaden's rule: customer-facing text, the staff UI and code carry no headcount; internal docs (plans, DHR letter draft, research) and git history may keep it. Never re-add a numeric cap to anything customer-facing or to the staff UI.
