---
name: feedback_craft-copy-voice
description: Approved voice/length/structure for craft descriptions AND the approved AI craft-image prompt style (2026-09-20) — full rules live in the repo skill .claude/skills/craft-copy/SKILL.md
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 299a94d3-1458-4718-a60d-4c52fb969376
  modified: 2026-09-20T16:50:51.192Z
---

Craft descriptions (party crafts etc.) follow a locked format: 3 short paragraphs, ~320–380 chars — hook sentence (shows on the card) / "Everyone…" what guests pick and do / "Each guest goes home with ___. Ages N and up." Tween-friendly but not corny; no "girls/kids/birthday/party" (see [[feedback_audience-framing]]). Full rules + gold examples + Square push gotchas: repo skill `.claude/skills/craft-copy/SKILL.md` — load it before writing any craft copy.

**Why:** Kaden rejected a 600–850-char draft as "too wordy" (reader = a mom scrolling, deciding in ~1 min) and a labeled-bullets draft as "too terse"; the middle version got "MUCH better" and he asked to lock it in. All 6 party crafts were rewritten to it on 2026-09-20.

**How to apply:** Any time craft copy is written or edited, match the skill's structure and examples; don't drift longer or into bullets. Never invent materials/ages — flag assumptions.

**Craft images (same day):** Claude Code can't generate images — give Kaden a ChatGPT prompt, he saves the result to ~/Downloads, then convert PNG→JPEG and upload. Approved look ("PERFECT"): tight on the product, camera looking down ~45°, background ONLY the light oak tabletop, a few supplies blurred at the frame edges, handmade imperfections, blush/cream/sage palette, 4:3. He rejected a straight-on shot showing the wall/room ("less of the environment and more of the actual thing"). Reusable template is in the same repo skill. AI images are stand-ins until a real sample photo exists.


**UPDATE 2026-10-06 (Catherine, via Kaden's keyboard):** the approved WORKSHOP style is now LESS specific — hook (what + guest instructor "Mrs. Megan, owner of Nutmeg's Cookies") / "Learn to …, with X guiding the table. No experience needed." / "Each guest goes home with the <thing> they make. Ages N and up." (+ drop-off line only when Kaden says so). No counts, designs, colors, menus, packaging: "if you are too specific and we don't do it exactly, people will complain." All seven Oct workshops were rewritten to this shape on 10/6. Rule lives in the repo skill `.claude/skills/craft-copy`.
