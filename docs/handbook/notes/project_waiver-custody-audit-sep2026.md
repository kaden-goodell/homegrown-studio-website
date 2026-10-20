---
name: project_waiver-custody-audit-sep2026
description: "Sep 27 2026 full audit of waiver signing + child check-in/pickup — ranked findings (C1–C6 pre-opening), Kaden's framing constraints, and the published report link"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2dcd1843-324d-4cfb-b5af-16c757c96ae5
  modified: 2026-09-28T01:38:21.985Z
---

Full audit report (Sep 27 2026, dev@89328db, agreement v2): https://claude.ai/artifact/UpDnyctNm2NVjEabcaEJdW

**Kaden's framing (stated mid-audit):** "We are NOT a daycare. We've already gotten insurance for that" — do not relitigate licensing/insurance in waiver/check-in work; borrow childcare-world practices only where cheap and useful. See [[feedback_right-sized-risk-advice]].

**Verified state:** agreement text is strong (Alabama-tuned, hashed, archived); first-time signing flow good; party check-in good (family pickup code hashed, allergy/no-photo badges, dup-kid detection). Staff console has only Parties/Roster/Kits phases.

**Critical gaps (pre-Oct-16 list):**
- C1 `/api/staff/coverage.json` door-check endpoint has ZERO UI callers — no walk-in/workshop door check exists.
- C2 `handleReuse()` in `sign.json.ts` clones a NEW WaiverRecord with a server-synthesized signature and the OLD version/hash — returning RSVP never sees text; should be an RSVP record referencing the source signature + forced re-sign on substantive version bump.
- C3 Drop-off addendum referenced by signed §4(c) was never written (draft in report Appendix A).
- C4 `CheckinEvent` has no actor field — shared passcode → anonymous custody log. Fix = staff-name picker at login.
- C5 `confirmedPickup[]` computed but never rendered; `set-pickup` has no caller; "Re-issue code" is a silent bypass; code only spoken, never texted (Quo carrier registration still pending).
- C6 No copy of agreement emailed to signer.
High: no kiosk mode/QR path (H1), public lookup leaks kids' first names + issues reuse token unverified (H2), custody log invisible/unexportable/500-cap + no waiver backup (records must survive to youngest minor's 21st bday — AL tolling) (H3), no incident form (H4), Programs intake orphaned (H5), docs/WAIVER.md drifted from signed text + no hash-vs-archive test (H6).

Related: [[legal-compliance-jul2026]] [[post-audit-fixes-jul2026]] [[project_homegrown-launch-date]]
