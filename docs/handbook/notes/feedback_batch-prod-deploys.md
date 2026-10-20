---
name: feedback_batch-prod-deploys
description: Batch prod deploys to save Netlify credits — hold small changes on dev and ship them together
metadata:
  type: feedback
---
Batch production deploys: hold small changes on dev and ship several together, rather than one deploy per tweak.

**Why:** 10/9/2026 Kaden learned 22 prod deploys (≈330 of 1,000 monthly Netlify credits, 15 each) had gone out in two days of opening prep — "Oh gosh". He agreed to batching.

**How to apply:** after committing to dev, say what's queued for the next prod push instead of offering to ship each item alone; ship alone only when it's urgent (broken booking, wrong price, customer-facing bug). Count deploys with `netlify api listSiteDeploys` (branch main, context production). Still never push to main without his go ([[feedback_no-prod-push-without-go]]).

- Oct 2026 period (Oct 11–Nov 11): 18 prod deploys by Oct 19 (270 credits on deploys).
