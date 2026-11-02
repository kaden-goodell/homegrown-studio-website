---
name: feedback_reground-after-compaction
description: After a context compaction, re-read the real state before changing anything, and ask Kaden questions instead of assuming
metadata:
  type: feedback
---

After a compaction, do not carry on from the summary. Re-read the branch, the uncommitted diff, the tickets and the memory notes first, and treat the summary's claims as things to check. Where a decision is Kaden's, ask him; do not pick for him and move on.

**Why:** On 2026-09-27 Kaden said, right after a compaction: "assume you know nothing about what you are doing and research everything again... Sometimes, after you compact you are a little dumb" and "If you have any questions, please ask rather than assume". Re-reading that day found a real money bug in uncommitted payment code that the summary had described as finished and green (see [[project_ux-review-sep2026]], Square idempotency).

**How to apply:** first actions after any compaction are read-only: `git status`/log/diff, the relevant Linear tickets, the memory file. Say so in one line. Passing tests are not evidence when the tests mock the thing in doubt; check the outside system's real behaviour (docs, read-only calls). Check Linear for an existing ticket before calling something a new finding, and record decisions on that ticket. Collect open questions and put them to Kaden plainly.
