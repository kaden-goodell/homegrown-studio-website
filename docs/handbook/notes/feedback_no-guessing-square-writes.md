---
name: feedback-no-guessing-square-writes
description: Never try guessed/undocumented write endpoints against live Square (dashboard or API); prove the route first
metadata:
  type: feedback
---
Kaden stopped me (12 Oct 2026) mid-try of a guessed dashboard cancel endpoint and said: "THIS HAS TO BE RIGHT!!!!! I DON'T CARE HOW WE DO IT BUT IT HAS TO BE RIGHT".

**Why:** money and class rosters are live; a guessed write that half-works is worse than slow. Multi-seat class bookings had already undercharged a real customer (see [[square-class-bookings]]).

**How to apply:** for any live Square write, only use a call that is documented or observed from Square's own UI (network capture), and test it on a hold or my own test data first. Say what is verified vs. not before shipping. When in doubt, have Kaden click it in Square's UI.
