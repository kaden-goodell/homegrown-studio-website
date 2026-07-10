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

**Capacity & ratio:**
- **Hard cap: 12 children per event.** (This is the licensing decision — do not exceed 12.)
- Staff to at least **1 adult per 6 kids, minimum 2 adults** — so 2 adults up to 12 kids.

**Check-in / check-out:**
- Every child signs in on arrival; the signing parent's waiver (with medical authorization
  + emergency contact + allergies) is on file before the child is left.
- Maintain an **authorized-pickup list**; release a child only to a listed adult. If you
  don't recognize the person, check photo ID against the list.

**Mandatory reporting:**
- Every staffer is a **mandated reporter** (Ala. Code §26-14-3). If you suspect abuse or
  neglect — from any source — report **immediately** to DHR (1-800-458-7214) or local law
  enforcement. Good-faith reports are legally protected. Failure to report is a misdemeanor.

**Incident handling:**
- Any injury: give first aid, contact the parent, document what happened (time, what, who
  witnessed). The waiver's medical-treatment authorization covers emergency care if the
  parent is unreachable.

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
