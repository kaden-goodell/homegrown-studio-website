# Crew Operations Runbook

How staffing works at Homegrown Studio: hourly Studio Assistants (paid cash via
Square Payroll) and the Studio Crew (moms paid $7.25/hr cash + store-credit
top-ups on gift cards). Everyone clocks in with the Square Team app or a POS
passcode; timecards flow into payroll automatically.

Design + decisions: `docs/superpowers/specs/2026-07-09-staff-payroll-setup-design.md`

## 1. One-time setup (Kaden, manual — do this week)

State registrations first; they have days-to-weeks of lead time and payroll
onboarding needs the account numbers. Grand opening is Sep 1, 2026 (pushed from Jul 31).

1. **Alabama withholding tax account** — register at
   [myalabamataxes.alabama.gov](https://myalabamataxes.alabama.gov) (needs the
   business EIN). You get an AL withholding account number.
2. **Alabama unemployment (SUTA) account** — register as a new employer at
   [labor.alabama.gov](https://labor.alabama.gov) (eGov → new employer
   registration). You get a UC account number and a new-employer rate.
3. **Verify Square Plus is active** — Dashboard → Settings → Pricing &
   subscriptions. Shifts scheduling/open-shift claiming rides on this.
4. **Subscribe to Square Payroll** — Dashboard → Staff → Payroll ($35/mo +
   $6/person paid). Enter the EIN + both state account numbers, connect the
   bank account (verification takes a few days).
5. **Workers' comp** — Alabama requires it at 5+ employees (part-timers
   count); we'll have 6–10. Square's payroll flow offers a pay-as-you-go
   policy — premiums scale with actual payroll, no big deposit.
6. **Decide the three numbers** (then they're just script arguments):
   - Studio Assistant hourly wage: $____/hr
   - Studio Crew credit rate: $____/hr in store credit (cash stays $7.25)
   - Pay frequency: weekly / biweekly

## 2. Adding a person

```bash
# Hourly assistant (cash wage you chose):
npx tsx scripts/team/add-team-member.ts --given First --family Last \
  --email her@email.com --phone "+1256..." --job assistant --wage 12

# Studio Crew mom (always 7.25 cash; credit comes separately):
npx tsx scripts/team/add-team-member.ts --given First --family Last \
  --email her@email.com --phone "+1256..." --job crew --wage 7.25
```

Then in the Dashboard (Staff → Team → the new person): send the **Square Team
app invite** and set a **POS passcode** for clock-in at the register.

> ⚠️ **Never enable anyone in Appointments.** Kaden must stay the only
> bookable staff member — workshop/party availability is driven by his
> calendar blocks, and a second bookable person breaks that math.

## 3. Weekly rhythm

- **Monday:** post next week's open Crew slots (defaults to next week):
  ```bash
  npx tsx scripts/team/post-open-shifts.ts            # or --week 2026-08-03, --copies 2
  ```
  Safe to re-run — already-posted slots are skipped.
- **As claims arrive:** moms tap *Request* on a shift in their Team app; you
  get a push — approve or decline from the notification.
- **Before the weekend:** Dashboard → Staff → Shifts → Schedule. Drag Studio
  Assistants into the gaps around the claimed Crew shifts, publish.

## 4. Each pay period

1. **Run payroll** (Dashboard → Payroll): timecards import automatically.
   Crew moms are in the run at $7.25/hr like everyone else.
2. **Load Crew store credit** for the same period:
   ```bash
   npx tsx scripts/team/load-crew-credit.ts --from 2026-07-20 --to 2026-08-02 --rate 15
   git add scripts/team/data/credit-ledger.json && git commit -m "chore(crew): credit loads"
   ```
   Add `--dry-run` first to preview. The ledger makes re-runs safe (a period
   already loaded for a person is skipped) — always commit it after a run.
   Each mom's credit lands on a digital gift card tied to her email; she
   spends it like any gift card (workshops, parties, retail).
3. Keep Crew members **under 40 hrs/week** — overtime math with in-kind
   credit is a mess we've chosen not to enter.

> **CPA follow-ups (once, before first credit run):** confirm the
> $7.25-cash-plus-credit structure, and how gift-card credit is reported
> (imputed income on the W-2 vs other treatment).

## 5. Kids' events (Parents Night Out) — safety & supervision

Applies to any **drop-off** event where parents leave (Parents Night Out). These rules
are how we protect the kids and stay defensible; they are not optional. Legal background
in Linear HOM-99 (licensing) and HOM-114 (safeguards).

**Onboarding gate — no one works a PNO until all three are on file:**
1. Criminal background check (GoodHire/Checkr — national criminal + sex-offender registry).
2. Alabama DHR Mandated Reporter Training certificate (free, training.dhr.alabama.gov).
3. Read and acknowledged this section (and Stewards of Children if the insurer requires it).

**The two-adult rule (non-negotiable):**
- **Always at least two vetted adults present** for the whole event.
- **Never one adult alone with a child.** No one-on-one, no closed-door situations.
- Bathroom policy for young kids: a child is never alone with a single adult behind a
  closed door — door stays ajar / a second adult is aware.

**Staffing:**
- **Minimum 2 adults** for any drop-off event; the owners set the headcount and add staff for bigger groups.

**Check-in / check-out — how the iPad actually walks you through it:**
- **The Today screen (front desk) answers one of three questions** the moment you type a
  name or phone: **GOOD TO GO** (waiver's on file and current — tap "✓ Here"; if they're
  here for a party or workshop, tap that event's button under it), **EXPIRED** (waiver's stale), or **NOT ON
  FILE**. Expired or not on file both get the same two buttons — "Show QR" (they sign on
  their own phone) or "Sign on this iPad."
- **Only drop-off events have check-out.** Parties, workshops and Craft Café are
  attendance only: tick who's here → "✓ Here (n)". A family that isn't on the roster yet:
  open the roster → "+ Add family" → search → "✓ Add & mark here" (or Show QR / Sign on
  this iPad if they need to sign first).
- **A red "Needs attention" box at the top of Today means stop and tell Kaden or Catherine.**
  It lists schedule problems for the next 60 days: a class on top of, or within an hour of,
  a booked party, two classes less than an hour apart, a class with more seats sold than it
  has, a party on a closed day, or seats sold with no pick on record. Nothing on that box fixes itself and you can't dismiss
  it — it clears when an owner moves things in Square. If it says "Couldn't check the
  schedule", tap Try again; if it keeps failing, say so.
- **Classes that ask each seat a question (like a pumpkin colour)** show a totals line at
  the top of the roster — that's the make-ahead list — and each family's picks on their
  card. "Paid, not signed in yet" under the roster is people who booked but haven't signed
  the agreement; their picks are there too. Picks can't be changed after booking; if a
  parent asks, note it in the family's History and tell an owner.
- **Drop-off is a setting on the event, not a separate mode.** Tap the gear (Event
  settings) on the roster to see or change it, and the multi-day dates — don't guess from
  the event name or how it sounds.
- **Check-in texts the pickup code.** Tap "Check in (n)" on the roster; for a drop-off event
  this sends the family's pickup code by text the moment their first kid checks in. The
  signing parent agreed to the drop-off terms (Section 4b of the participation agreement) —
  they govern everything below.
- **Pickup is chip + code.** The person collecting shows up on the "Who's collecting?"
  chips. Known person + correct code → "Check out (n)." Someone not on the chip list →
  tick "Not on the list — I checked their photo ID" first, then check out. No code on
  hand, or it's been typed wrong five times (locked) → "Override…": pick a reason (Called
  the parent — verified / Parent is here in person / Other) and say what happened. **You
  never decide whether to trust someone — the screen does**, off the chip and the code;
  Override is how you tell it you verified some other way, not a way around it.
- **May-not-collect is absolute.** A name on the "may NOT collect" list never gets the
  child released to them, correct code or not — call the parent instead, full stop.
- **Late pickup:** 15-minute grace period past the posted end time, then **$1/minute**.
  Call the parent, then the emergency contact, right at the 15-minute mark.
- Code got lost, or needs to change hands? "Re-send code" on the pickup panel.
- **Before any drop-off event, "🖨 Print" the roster.** Wifi drops happen, and the printed
  sheet carries every allergy, emergency contact, and pickup name you'd need without it.

**Mandatory reporting:**
- Every staffer is a **mandated reporter** (Ala. Code §26-14-3). If you suspect abuse or
  neglect — from any source — report **immediately** to DHR (1-800-458-7214) or local law
  enforcement. Good-faith reports are legally protected. Failure to report is a misdemeanor.

**Incident handling:**
- First aid → call the parent → **🚑 Incident** (top of every staff screen, any screen you're
  on) → fill it in → **Save incident** → **Print note** and send it home with the kid.

**Never delete a record.** Check-ins, pickups, overrides, incidents — that history is what
protects you and the family later. Something's wrong or changed? Add a note, or an Override
with the real reason — don't erase what's there. Need the whole story on a family? Open
**History** on their card.

## 6. What this costs

| Item | Cost |
|---|---|
| Square Payroll | $35/mo + $6 per person actually paid that month |
| Scheduling, clock-ins, open shifts | $0 — included in Square Plus |
| Gift-card credit loads | $0 — promotional loads, no processing |
| Workers' comp | pay-as-you-go premium, scales with payroll |

## Script map

| Script | Purpose |
|---|---|
| `scripts/team/add-team-member.ts` | Create team member + hourly wage (never bookable) |
| `scripts/team/post-open-shifts.ts` | Publish the week's open Crew slots (idempotent) |
| `scripts/team/load-crew-credit.ts` | Pay-period credit → gift cards (ledger-idempotent) |
| `src/lib/crew/` | Slot templates, timezone + credit math (unit-tested) |

## 7. Records & archive

Every legal record — signed agreements (`waivers`), RSVPs, the custody event
log (`checkins`), incident reports (`incidents`), plus event/open-studio
metadata — lives in Netlify Blobs. **Never delete any of it.** In Alabama a
minor's injury claim is tolled until they turn 19, then they have two more
years to file — a signature from a 6-year-old today must still exist in
2041. Audit finding H3; HOM-217.

**Weekly self-archive (automatic):** a Netlify scheduled function
(`netlify/functions/archive-records.ts`, Sunday ~3am Central) exports every
record, writes a full snapshot into the `archive` blob store, and emails a
zip (one JSON per store + `custody.csv`, the flattened custody log a lawyer
would ask for) to `ARCHIVE_TO` (default kaden@ourhometownstudio.com). If a
store's data is too big to email (>20 MB combined), it splits into one email
per store instead of skipping any of it. If the export itself fails, you get
an "Archive FAILED — {error}" email instead of silence.

**Manual run**, anytime:

```bash
# Write a local copy instead of emailing:
npx tsx scripts/archive-records.ts --out ./archive-2026-09-28.zip

# Or email it right now (same as the weekly job):
npx tsx scripts/archive-records.ts
```

**Restoring after a Netlify incident:** unzip the most recent archive (from
the emailed copy, or `archive/{date}.json` in the `archive` blob store) —
each `{store}.json` is that store's key → record map and can be replayed
back into a fresh Blobs store key-by-key if it ever comes to that.

**Who can see records day to day:** owners and on-shift crew, through the
staff console — a household's card has a "History" button showing every
custody event (check-in, pickup, overrides, denials) for that family. It's
read-only; nothing in the console lets anyone edit or delete a past event.

**A customer asking for their data:** forward the request to Kaden/Catherine
— see the Records paragraph on `/policies` for what we tell customers we
keep and why.
