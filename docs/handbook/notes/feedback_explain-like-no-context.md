---
name: feedback_explain-like-no-context
description: "When reporting review findings/deviations to Kaden, explain each one as if he has zero context — what it is, why it matters, in plain words — short but never jargon or spec-internal references"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2dcd1843-324d-4cfb-b5af-16c757c96ae5
  modified: 2026-10-07T13:37:39.912Z
---

When I report issues, deviations or decisions, Kaden wants each one explained as if he doesn't know what I'm talking about — because he usually doesn't have the context I built up. Short, but complete: what the thing is, what would go wrong, what I did.

**Why:** 2026-10-07, after the seat-options brief: "There were at least 3 where I had no context as to what you were talking about... Don't be super long winded but tell me like I don't know bc I likely dont..." The offenders were lines like "Continue stays enabled instead of Pay disabled", "nothing after a class", "a failed morning scan emails 'couldn't check'", "not exercised live" — all accurate, all meaningless without my context.

**How to apply:** For every finding: one sentence naming the screen/moment a person would hit it, one on what breaks, one on the fix or decision. Never cite spec section letters, task numbers, reviewer labels (I1…), or internal names (`event-meta`, `signupClosed`) as if they explain anything. Test: would Catherine understand it cold? See [[feedback_right-sized-risk-advice]].
