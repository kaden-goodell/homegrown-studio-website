# Hometown Studio developer handbook

Start here on a new machine. It covers what's live, where the unfinished work is, how to add events, and the house rules. `notes/` holds the detailed working notes Claude kept while building the site (one topic per file). Read the matching note before changing that area.

> This repo is **public**. Never commit passcodes, tokens, customer names, phones or emails. Secrets live in Netlify env only.

## 1. Set up the machine

```bash
git clone https://github.com/kaden-goodell/homegrown-studio-website.git
cd homegrown-studio-website && git checkout dev && npm install
npx netlify login && npx netlify link        # site: iridescent-croissant-494fc3
```

`.env` is not in git. Rebuild it from Netlify (`npx netlify env:list --context production` shows the names; `npx netlify env:get NAME` gets each value). Local scripts need:

| Variable | Used for |
|---|---|
| `SQUARE_ACCESS_TOKEN`, `SQUARE_ENVIRONMENT=production`, `SQUARE_LOCATION_ID`, `SQUARE_APPLICATION_ID` | every Square script |
| `PROVIDER_MODE=square` | real catalog (otherwise mock data) |
| `POSTHOG_PERSONAL_API_KEY` | `scripts/analytics.ts` |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `QUO_API_KEY`, `QUO_FROM_NUMBER` | email and text. **Local `.env` sends REAL email/texts.** Test texts go only to (402) 980-2907. |
| `STAFF_PASSCODE`, `BOOKINGS_OPEN`, `DEV_BYPASS_PAYMENT`, `PUBLIC_*` | site behaviour |

`npm run dev` → http://localhost:4321. `npx vitest run <path>` for targeted tests (the full suite is heavy).

## 2. Branches and what's live

| Branch | What | State |
|---|---|---|
| `main` | **Production** (ourhometownstudio.com). Every push costs 15 Netlify credits. | Live site |
| `dev` | Day-to-day work. Push = free preview build. Currently = main + 3 privacy/security fixes (party host pages send nothing to analytics; removed an unauthenticated booking cancel endpoint). | Ready to ship when you choose |
| `kaden/own-booking-system` | Stage 1 of leaving Square Classes: our own class booking, admin design D, Square class import. Reviewed. | Sandbox preview only |
| `kaden/admin-d` | Stage 2 (parties, replaces Appointments Plus) Tasks 1–10 done and reviewed, Task 11 (admin party API) is a **WIP commit, untested**. Also plans for stages 2–4 and the build notebooks. | Not merged |

Ship to prod: `git push origin dev:main` (the repo has used a force push when main had drifted; check `git log origin/main..dev` first).

### Own-booking-system project (stages 1–4)
- Spec: `docs/superpowers/specs/2026-10-18-own-booking-system-design.md` (on `kaden/own-booking-system`)
- Plans: `docs/superpowers/plans/2026-10-19-stage{2-parties,3-staffing,4-extras}.md` (on `kaden/admin-d`)
- Build notebooks: `docs/superpowers/ledgers/stage1-own-classes/progress.md` and `stage2-parties/progress.md` (on `kaden/admin-d`). Every decision is logged there as `R<n>` / `S2-R<n>` rulings. "COPY FOR KADEN" in the stage 2 notebook lists customer wording still waiting on approval.
- Next: finish Task 11, Tasks 12–14, stage 2 final review, stages 3–4, then merge `kaden/admin-d` into `kaden/own-booking-system`.
- Before real money: set `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_URL`, `SQUARE_CLASSES_CATEGORY_ID`, `SQUARE_CLASS_TAX_ID` and subscribe the Square webhook to https://ourhometownstudio.com/api/webhooks/square.json.
- Sandbox end-to-end test: `ADMIN_PASSCODE="$(npx netlify env:get ADMIN_PASSCODE --context branch:kaden/own-booking-system)" STAFF_PASSCODE="$(npx netlify env:get STAFF_PASSCODE --context branch:kaden/own-booking-system)" npx tsx scripts/sandbox-e2e.ts` (`--cleanup-only` if it stops part way).

## 3. Adding a workshop (today's way, live Square)

Until the own-booking system ships, a workshop on the site = a Square **class schedule** (dated instance) + its catalog item. Details: `notes/square-class-schedule-create.md`, `notes/square-admin-api-capabilities.md`.

1. **Write the description** with the rules in `.claude/skills/craft-copy/SKILL.md` (3 short paragraphs, no colons, ages line, no "party"/"birthday"). Get it approved before pushing.
2. **Create the item** (API key works for this):
   `npx tsx scripts/create-class.ts --name "Name" --create --price 25 --description "..." --start "2026-10-24T18:00" --duration 120 --capacity 35 --dry-run`
   The dry run creates the item if missing, prints the schedule body and checks for a party clash.
3. **Add the photo** (4:3, ≥1600×1200, finished craft, not supplies or text): `npx tsx scripts/upload-workshop-image.ts <itemId> <photo.jpg> --role card`
4. **Create the dated class.** Square only accepts this from a signed-in dashboard session, not the API key. Either:
   - put a fresh app.squareup.com cookie in `captures/.square-session` (gitignored) and run step 2 without `--dry-run`, or
   - paste `scripts/square-tab-schedule.js` into a studio-site tab signed in at /staff (`checkStudio`) and then into a signed-in app.squareup.com tab (`scheduleInSquare`); or just create it in the Square dashboard by hand.
5. **Save the capacity** (Square doesn't report it): `npx tsx scripts/set-event.ts --workshop clssch_… --capacity 35`. Optional: `--cutoff 24`, `--made-to-order`, `scripts/set-dropoff.ts --on` for kids drop-off classes.
6. **Check** it on https://ourhometownstudio.com/workshops.

Other tools: `move-class.ts` (refuses a class with bookings), `hide-class.ts`, `update-class-description.ts`, `list-classes.ts`, `set-cafe-windows.ts` (Craft Café Saturdays, re-run monthly).

**Pending right now:** "Bring Your Own Bedazzle (BYOB)" item `Q4MD7HSF5HJULRSC3RLBAT7M` + photo are in Square, but the **Sat Oct 24, 6–8 PM, 35-seat schedule was never created** (step 4–5).

## 4. House rules

- **Never push `main` without Kaden's go.** Batch prod deploys (credits).
- **Never cancel, refund or release a customer's booking** in code or by script. Conflict guards refuse the *new* thing only; show Kaden and he acts in Square.
- **No guessed Square writes.** Only proven calls on live Square; try them on sandbox or test data first.
- **Copy:** show the full draft and wait for OK. No colons, no timelines, "party" never "birthday", **"Craft Café"** never "Open Studio" (code names `openStudio*` stay), business is **"Hometown Studio"** (one word). Crafts are for everyone 8+, not kids' birthdays.
- **Kits stay hidden** until Kaden says otherwise.
- **Privacy:** no analytics on `/party/*`, `/staff`, `/waiver`; strip host keys from URLs.
- **Test texts → (402) 980-2907 only.** Test emails → `kaden+tag@ourhometownstudio.com`.
- Admin actions are Kaden's: don't write live data for him when there's a button for it.

## 5. Analytics

`npx tsx scripts/analytics.ts --report overview --days 7` (reports: overview, funnel, sources, pages, bookings, quits, problems, leads, devices, events) or raw HogQL. Exclude `is_team` and `utm_source=claude_test`. Notes: `notes/reference_posthog.md`, `notes/reference_google-analytics.md`, `notes/reference_meta-pixel.md`.
Traffic report for Catherine (Oct 19): https://claude.ai/artifact/GtA9r5vQxocpYHvghNT1ra

## 6. Notes index

See `notes/INDEX.md`.
