---
name: feedback_workshops-stay-closed
description: Workshop booking stays OFF on the live site until Kaden explicitly says to open it — never suggest bundling the switch
metadata:
  type: feedback
---
"No live workshops at all until I for sure say so" (Kaden, 2026-10-09). Netlify `BOOKINGS_OPEN=parties` stays as is; classes can be created in Square and show on the calendar, but booking stays closed.

**Why:** he wants to control the launch of workshop sales himself (opening is Fri Oct 16).

**How to apply:** don't propose opening workshops as part of a deploy or as a recommended option; only flip `BOOKINGS_OPEN` to include `workshops` when he says so in plain words.

**Update 2026-10-09 evening:** Kaden said "Launch the workshops now!" → production BOOKINGS_OPEN=parties,workshops, deployed 3eeedab. Same rule now applies to take-home KITS: "Make sure that you don't launch the take home" — never add `kits` without his explicit word.
