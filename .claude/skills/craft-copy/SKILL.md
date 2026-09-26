---
name: craft-copy
description: Use when writing or editing ANY craft description for Hometown Studio — party crafts, open-studio crafts, kits, workshop blurbs — or when adding a craft to Square via scripts/add-party-craft.ts. Locks in the approved voice, length, and structure (approved by Kaden 2026-09-20).
---

# Hometown craft description voice

The reader is **a mom scrolling on her phone, choosing between crafts in about a minute**. Make the choice easy. Kaden rejected two earlier drafts: a 600–850-char version ("too wordy") and a labeled-bullets version ("too terse"). The approved middle is below — don't drift toward either.

## Structure — three short paragraphs, 320–380 characters total

1. **Hook (one sentence, ≤ ~100 chars).** What you make + why it's fun/useful. This is ALL that shows on the craft card (2-line clamp), so it must stand alone.
2. **"Everyone…" paragraph (1–2 sentences).** What each guest chooses and does. Name the real, concrete materials. If instructors help or a tool is involved, say so here in a clause.
3. **Take-home + age (two tiny sentences).** `Each guest goes home with ___. Ages 8 and up.` If the age differs, give the reason in a clause: `Ages 10 and up, since we use a heat press.`

Made-to-order crafts (the `--personalized` flag) get ONE extra paragraph starting `Heads up:` — plain statement that it's made to order, we email for headcount/details, and no changes or refunds once made. No caps-lock "IMPORTANT".

Paragraphs are separated by a blank line (the modal renders `white-space: pre-line`).

## Voice

- Tween-friendly but not corny; cute, not stupid. A little dry wit is welcome ("the notebook nobody else is allowed to read"), one touch per description at most.
- Second person / "everyone" — never "girls", "kids", "birthday", or "party" in names or copy. Crafts are for everyone, any occasion (see memory: audience-framing).
- Concrete nouns over adjectives: "fuzzy pom-poms", "gold carabiners", not "a wide variety of fun embellishments".
- Banned: "one-of-a-kind creation", "uniquely yours", "unleash your creativity", "perfect mix of", exclamation-mark stacking, "at Hometown Studio's …!" openers, em-dash pileups.
- Never invent facts. If the materials, take-home count, or age aren't known, ask — don't guess. Flag any assumption when presenting the draft.

## Names

Short, plural-or-noun craft names. No "Party", no "Birthday": "Bubble Letter Keychains", "Denim Patch Notebooks", "Keychain Bar".

## Gold-standard examples

**Bubble Letter Keychains**
> Spell any word in chunky bubble letters, then clip it to your water bottle, backpack, or keys.
>
> Everyone picks their own word — a name, a sport, a team, an inside joke — plus their cord color, beads, and fuzzy pom-poms. We'll teach the knots that hold it all together, so it lasts.
>
> Each guest goes home with a finished keychain. Ages 8 and up.

**Denim Patch Notebooks**
> Cover a denim notebook in patches you pick, then make a bookmark to go with it.
>
> Everyone digs through the patch bar, lays out their own design, and locks it in on the heat press with our help — so the patches stay put, even in the bottom of a backpack.
>
> Each guest goes home with a notebook and a bookmark. Ages 10 and up, since we use a heat press.

## Craft images — AI stand-in prompt (approved by Kaden 2026-09-20: "PERFECT")

Claude Code can't generate images; hand Kaden a prompt to paste into ChatGPT, then upload what lands in ~/Downloads. A real photo of a real sample always replaces an AI stand-in when one exists.

The approved look is **tight on the product, looking down ~45°, tabletop-only background**. His first rejection was a straight-on shot showing the wall/window/room: "want less of the environment and more of the actual thing."

Template — swap the bracketed parts, keep the rest:

```
Photorealistic casual iPhone photo, 4:3 landscape. [THE FINISHED CRAFT,
described concretely: size, materials, colors — blush pink, cream, sage
green palette] — visibly handmade, with [small real imperfections: paper
edges, tiny wrinkles, uneven spacing] so it looks made by a 10-year-old,
not factory-produced. Camera high, looking down at about a 45-degree angle
so we see [the top AND the decorated front/side that is the actual craft].
Close in: the craft fills about 60% of the frame, centered with a little
breathing room. The background is ONLY the light oak tabletop — no wall,
no window, no plants, no horizon line. At the edges of the frame, softly
out of focus: [2–3 of the actual supplies used, e.g. foam brush tip, torn
paper scraps]. Soft natural window light, shallow depth of field,
true-to-life colors. No text, no logos, no people, no hands.
```

Rules: never fully top-down if the craft's side is the point; say what's NOT included (e.g. "no saucer") so the image doesn't over-promise; no brand logos or trademarked characters; subject must survive a tiny thumbnail crop (modal summary chip). ChatGPT returns 1448×1086 PNG — already 4:3; convert to JPEG (`sips -s format jpeg`) before upload.

## Pushing to Square (gotchas)

- `npx tsx scripts/add-party-craft.ts --name … --price … --description …` upserts by exact name against the PRODUCTION catalog.
- **Updating an existing craft rewrites its categories.** Re-pass `--personalized` for made-to-order crafts, and re-run `scripts/set-popular-craft.ts --name "<craft>"` afterward if it held the Most Popular badge. Images are preserved.
- Photos: 4:3 landscape, ≥1600×1200, subject centered; upload with `scripts/upload-workshop-image.ts <itemId> <path> --role card`.
- Verify after every push: `GET /api/party/service-info.json` — check price, image, personalized, popular for ALL crafts, not just the one you touched.
