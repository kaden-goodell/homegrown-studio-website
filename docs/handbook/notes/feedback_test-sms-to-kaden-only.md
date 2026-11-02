---
name: feedback_test-sms-to-kaden-only
description: "Never send test texts to made-up/555 numbers — every test SMS goes to Kaden's own phone (402) 980-2907; test emails to a kaden+tag@ourhometownstudio.com address"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2dcd1843-324d-4cfb-b5af-16c757c96ae5
  modified: 2026-09-30T15:37:37.380Z
---

Every test text message goes to Kaden's phone, **(402) 980-2907**, never to a fictional or 555 number. Test households used in walkthroughs should carry that number (and a `kaden+<tag>@ourhometownstudio.com` email).

**Why:** On 2026-09-29 I ran test signatures with a made-up 256-555-0142 household, which pushed real Quo texts at a number nobody owns. Kaden: "you can't just send to fake numbers... you have to send to me... Don't do that again."

**How to apply:** Before any flow that texts (check-in codes, pickup confirmations, waiver links, OTPs), set the household/parent phone to 4029802907. If a test needs a second household, still use his number. Local `.env` points at production Quo/Gmail/Square, so a "local" test still sends real messages and creates real Square customers — say so before running one. See [[project_waiver-custody-rail-shipped]].
