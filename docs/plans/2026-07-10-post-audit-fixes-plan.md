# Post-Audit Party/Waiver/Check-in Fix Batch — Implementation Plan

> **For agents:** Use team-dev (parallel) or sdd (sequential) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Source:** UX/security/legal audit of 2026-07-10 (four parallel review reports), scope approved by Kaden in conversation. No separate PRD/design doc.

**Goal:** Fix the launch-blocking, security, operational, and copy issues found in the party booking / participation agreement / staff check-in system, and land the extensibility refactors (event context, shared blob store, workshop waiver linking) before more records accumulate.

**Architecture:** Astro 5 SSR (Netlify) + React islands. Persistence: Netlify Blobs (prod) / `.data/` fs (dev) via three per-domain stores. Square for payments/bookings/customers. All customer copy in `src/config/*` modules.

**Tech stack notes:**
- Tests: `npx vitest run` (no `test` script in package.json). **Pre-existing failures:** 2 tests in `tests/providers/square/booking.test.ts` ("creates booking and upserts custom attributes", "omits optional custom attributes when not provided") fail before this work — do NOT chase them; the bar is "no NEW failures".
- Path aliases: `@lib/*`, `@config/*`, `@components/*`.
- Commit convention: conventional, `type(scope): message` (jig.config.md).
- Business decisions locked by Kaden: studio fee is **$300** (`basePriceCents: 30000` is correct; docs referencing $200 are stale). Drop-off is a **studio decision only** (camps/PNO) — parties are never drop-off; every minor at a party must have a responsible adult present. Confirmation email via **Gmail** (nodemailer + app password), env-gated.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/blob-store.ts` | Create | Shared Blobs/fs KV helper with correct error semantics (store-unavailable → fs; transient read/write error after probe → throw) |
| `src/lib/studio-time.ts` | Create | All studio-local (America/Chicago) date/time formatting + local-day → UTC range |
| `src/lib/party-availability.ts` | Create | Server-side "is this start still open" check shared by availability + book endpoints (fixes UTC-window bug) |
| `src/lib/rate-limit.ts` | Create | Per-IP sliding-window limiter (in-memory per instance) |
| `src/lib/reuse-token.ts` | Create | Short-lived HMAC token binding waiver-reuse to a fresh lookup |
| `src/lib/email.ts` | Create | Gmail SMTP (nodemailer) confirmation email, env-gated no-op |
| `src/lib/events.ts` | Create | Event abstraction (`getEvent`, `listEvents`) over parties (workshops/open-studio slots reserved) |
| `src/lib/waiver-store.ts` | Modify | Event context (`context {kind,id}` normalizing legacy `partyId`), household **upsert** into party index, `responsibleAdult` field, blob-store helper |
| `src/lib/checkin-store.ts` | Modify | Append-only `events` audit log, blob-store helper, read-modify-write retry |
| `src/lib/party-store.ts` | Modify | blob-store helper, comment fixes |
| `src/pages/api/party/book.json.ts` | Modify | Slot re-validation → customer → **booking → charge** (cancel booking on charge failure), honest error copy, `serviceVariationVersion === 0` fix, confirmation email, comment fix |
| `src/pages/api/party/availability.json.ts` | Modify | Use `party-availability` helper (UTC-window fix) |
| `src/pages/api/party/roster.json.ts` | Modify | Strip `email`/`phone`/`emergency`/`signedAt` from host payload; duplicate-kid handling in counts |
| `src/pages/api/waiver/sign.json.ts` | Modify | Party validation (exists + not past), `responsibleAdult`, reuse-token check, rate limit, upsert index, returning path no longer note-spams |
| `src/pages/api/waiver/lookup.json.ts` | Modify | Rate limit + issue reuse token |
| `src/pages/api/staff/checkin.json.ts` | Modify | Audit events, reissue guard, distinguish "no code issued" error, undo-checkin preserves history |
| `src/pages/api/staff/roster.json.ts` | Modify | Duplicate-kid flags, `via getEvent` |
| `src/pages/api/staff/coverage.json.ts` | Create | Staff-only "is this contact covered right now" check (workshops/open-studio door) |
| `src/config/waiver-content.ts` | Modify | Agreement **v2** (§4c supervision rewrite), `adultAge` interpolation fix, second-adult copy, "RSVP'd" confirmation, dead copy removal |
| `src/config/invite-content.ts` | Modify | Second-adult copy |
| `src/config/party.config.ts` | Modify | Docblock $200 → $300 |
| `src/config/party-content.ts` | Modify | Confirmation next-steps no longer promise an email unconditionally |
| `src/config/site.config.ts` | Modify | Empty testimonials, real party type replaces stale Kids/Adult Party entries, mock-in-prod guard |
| `src/components/waiver/WaiverFlow.tsx` | Modify | Drop-off copy removal + responsible-adult field, returning no-party path becomes read-only, party context chip, second-adult confirmation line |
| `src/components/staff/StaffConsole.tsx` | Modify | Refresh + poll + search, fetch error handling, Reset two-tap guard, issue-code fix, adult allergies in summary, badge wrap, drop-off toggle copy, studio-time |
| `src/components/party/PartyDashboard.tsx` | Modify | Host token out of calendar details, PII interface cleanup, group copy + per-row perspective fix, refresh/poll, studio-time |
| `src/components/party/PartyModal.tsx` | Modify | Backdrop/Escape discard guard + dialog semantics, `emailSent` handling, placeholder, studio-time labels, `available-dates` retry |
| `src/pages/invite.astro` | Modify | Server-side party resolution (query params become fallback), studio-local time |
| `src/pages/waiver.astro` | Modify | Server-side party resolution + past-party notice, meta copy |
| `src/pages/index.astro` | Modify | Hero + Private Parties card occasion-neutral copy |
| `src/pages/programs.astro` | Modify | Meta copy neutralized (hidden feature) |
| `src/providers/mock/data.ts` | Modify | Neutralize birthday/wine copy |
| `src/components/workshops/WorkshopBookingModal.tsx` (or wherever `handoff.workshopCta` renders — locate with grep) | Modify | Waiver link carries `?workshop={bookingId}` |
| `docs/NEEDS-FROM-KADEN.md` | Modify | Gmail env vars, attorney review of agreement v2, $15–$40 FAQ price verification, PROVIDER_MODE guard note |
| `package.json` | Modify | Add `nodemailer` + `@types/nodemailer`; remove unused `resend` |
| `tests/lib/blob-store.test.ts` | Create | fs-mode round-trip, error semantics |
| `tests/lib/studio-time.test.ts` | Create | Formatting pinned to America/Chicago regardless of host TZ; day-range DST cases |
| `tests/lib/party-availability.test.ts` | Create | Open/taken/UTC-boundary starts |
| `tests/lib/rate-limit.test.ts` | Create | Window behavior |
| `tests/lib/reuse-token.test.ts` | Create | Issue/verify/expiry/tamper |
| `tests/lib/waiver-store.test.ts` | Create | Upsert-by-contact dedup, legacy index normalization, context normalization |
| `tests/lib/checkin-events.test.ts` | Create | Audit log append + undo preserves history |
| `tests/api/party-book.test.ts` | Create | Ordering: booking fails → no charge; charge fails → booking cancelled; slot taken → 409 before any Square write |

Execution graph (post-review, honoring shared-file chains): **1, 2 → 3 → 4 → 5 → 6 → 7 → 9 → 8 → 11 → 10 → 12 → 13 → 14 → 15 → 16.** The chain exists because of heavily shared files (`sign.json.ts`: 9→8→10; `PartyModal.tsx`: 4→6→13→14; `WaiverFlow.tsx`: 8→9→15; `waiver.astro`: 15→16; `NEEDS-FROM-KADEN.md`: 4→5→6→7; `checkin-store.ts`: 11 before 10's migration). This batch is effectively **serial** — prefer sdd over team-dev.

---

## Task 1: Shared blob store with correct error semantics

**Files:** Create `src/lib/blob-store.ts`, `tests/lib/blob-store.test.ts`; Modify `src/lib/waiver-store.ts`, `src/lib/checkin-store.ts`, `src/lib/party-store.ts`

**Why:** Three copy-pasted store layers, and all of them treat a *transient* Blobs error the same as "not on Netlify" — falling back to fs, which is empty in prod, so a flaky read returns empty state that then gets written back over real data (this can silently destroy a family's live check-in state, incl. pickup code).

- [ ] **Write failing tests** (`tests/lib/blob-store.test.ts`): construct a store with `makeKvStore('test-things', 'things')`; in a non-Netlify env it uses fs (`.data/things/`); assert round-trip get/set, `get` of missing key → `null`, `list()` returns written keys. Also test `setIfMatch` against a faked blob store whose `set` resolves `{ modified: false }` → must return `false` (this is how @netlify/blobs v10 reports a lost conditional write — it does NOT throw), and `{ modified: true }` → `true`.
- [ ] **Implement** `src/lib/blob-store.ts`:

```ts
/**
 * Shared KV persistence: Netlify Blobs in prod, `.data/<dir>/` on disk in dev.
 *
 * Error semantics matter here: "Blobs unavailable" (probe fails — we're not on
 * Netlify) falls back to fs, but a read/write that fails AFTER a successful
 * probe is a transient outage and MUST throw — proceeding on empty state and
 * writing it back destroys real data.
 */
import { createLogger } from '@lib/logger'

export interface KvStore {
  get(key: string): Promise<string | null>
  set(key: string, json: string): Promise<void>
  /** getWithMetadata → { value, etag } when Blobs; fs mode returns etag null. */
  getWithMeta(key: string): Promise<{ value: string | null; etag: string | null }>
  /** Conditional write. Returns false when the etag didn't match (Blobs only). */
  setIfMatch(key: string, json: string, etag: string | null): Promise<boolean>
  list(): Promise<string[]>
}

export function makeKvStore(storeName: string, fsDirName: string): KvStore {
  const logger = createLogger(`kv:${storeName}`)
  let blobStore: any | null | undefined // undefined = not probed yet, null = unavailable

  async function resolveBlobStore(): Promise<any | null> {
    if (blobStore !== undefined) return blobStore
    try {
      const { getStore } = await import('@netlify/blobs')
      const store = getStore(storeName)
      await store.get('__probe__') // fails outside Netlify → fs fallback
      blobStore = store
    } catch {
      blobStore = null
    }
    return blobStore
  }

  const fsDir = () => new URL(`../../.data/${fsDirName}/`, import.meta.url)

  async function fsRead(key: string): Promise<string | null> {
    try {
      const { readFile } = await import('node:fs/promises')
      return await readFile(new URL(`${key}.json`, fsDir()), 'utf8')
    } catch {
      return null
    }
  }
  async function fsWrite(key: string, json: string): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(fsDir(), { recursive: true })
    await writeFile(new URL(`${key}.json`, fsDir()), json, 'utf8')
  }

  return {
    async get(key) {
      const store = await resolveBlobStore()
      if (!store) return fsRead(key)
      // NOTE: no fs fallback here — a throw after a successful probe is a
      // transient Blobs error and must surface to the caller.
      return (await store.get(key, { type: 'text' })) ?? null
    },
    async set(key, json) {
      const store = await resolveBlobStore()
      if (!store) return fsWrite(key, json)
      await store.set(key, json)
      logger.info('kv set', { key })
    },
    async getWithMeta(key) {
      const store = await resolveBlobStore()
      if (!store) return { value: await fsRead(key), etag: null }
      const res = await store.getWithMetadata(key, { type: 'text' })
      return { value: res?.data ?? null, etag: res?.etag ?? null }
    },
    async setIfMatch(key, json, etag) {
      const store = await resolveBlobStore()
      if (!store) { await fsWrite(key, json); return true }
      // @netlify/blobs v10: a conditional set that loses the race resolves
      // NORMALLY with { modified: false } — it does NOT throw (verified against
      // node_modules/@netlify/blobs/dist/main.d.ts WriteResult). Detect the
      // lost race from the return value; let genuine transient errors throw.
      const res = await store.set(key, json, etag ? { onlyIfMatch: etag } : { onlyIfNew: true })
      return res?.modified === true
    },
    async list() {
      const store = await resolveBlobStore()
      if (store) {
        const { blobs } = await store.list()
        return blobs.map((b: { key: string }) => b.key)
      }
      try {
        const { readdir } = await import('node:fs/promises')
        return (await readdir(fsDir())).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
      } catch {
        return []
      }
    },
  }
}
```

- [ ] **Refactor the three stores onto it.** In each of `waiver-store.ts`, `checkin-store.ts`, `party-store.ts`: delete the local `getBlobStore`/`fsRead`/`fsWrite` blocks and replace `rawGet`/`rawSet`/read/write bodies with a module-level `const kv = makeKvStore('waivers', 'waivers')` (respectively `'checkins'/'checkins'`, `'parties'/'parties'`). `listParties()` uses `kv.list()` + `getPartyRecord`. Public function signatures stay identical.
- [ ] **Run:** `npx vitest run tests/lib` → all pass. `npx vitest run` → no new failures vs baseline.
- [ ] **Commit:** `refactor(stores): shared blob-store helper with fail-loud transient-error semantics`

---

## Task 2: Studio-time helpers + timezone pinning

**Files:** Create `src/lib/studio-time.ts`, `tests/lib/studio-time.test.ts`

- [ ] **Write failing tests:** with `process.env.TZ` forced to `'America/New_York'` in the test (`vi.stubEnv` won't change Intl — instead pass explicit expectations: `formatSlotLabel('2026-08-08T17:00:00.000Z')` must be `'Sat, Aug 8 · 12:00 PM CT'` — noon Central regardless of host TZ). Cover `studioDayUtcRange('2026-12-19')` (CST, UTC-6) → `{ startIso: '2026-12-19T06:00:00.000Z', endIso: '2026-12-20T05:59:59.999Z' }` and a CDT date (`2026-08-08` → offset -5).
- [ ] **Implement** `src/lib/studio-time.ts`:

```ts
/** All customer/staff-facing times are studio-local (America/Chicago), always. */
import { partyConfig } from '@config/party.config'

const TZ = partyConfig.timezone // 'America/Chicago'

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
}

/** "Sat, Aug 8 · 12:00 PM CT" */
export function formatSlotLabel(iso: string): string {
  const d = new Date(iso)
  const datePart = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ })
  return `${datePart} · ${formatTime(iso)} CT`
}

/** "Sat, Aug 8, 12:00 PM" — dashboard/console rows (CT suffix optional there). */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ,
  })
}

/** UTC instant range covering a studio-local calendar day (handles DST). */
export function studioDayUtcRange(ymd: string): { startIso: string; endIso: string } {
  // IMPORTANT: do NOT use `new Date(date.toLocaleString(...))` — parsing a
  // locale string is implementation-defined. Reuse the formatToParts-based
  // local→UTC conversion that already exists in src/lib/party-slots.ts
  // (`localToUtcISO(ymd, 'HH:MM')`, lines ~38-57): export that helper from
  // party-slots (or move it here and re-import there) and build the range as:
  const startIso = localToUtcISO(ymd, '00:00')
  return { startIso, endIso: new Date(new Date(startIso).getTime() + 24 * 3600_000 - 1).toISOString() }
}
```

(The two modules MUST share one conversion — party-slots generates the starts, studio-time bounds the bookings query; two independent offset implementations is how the UTC-window bug happens again. Add the test `studioDayUtcRange(d).startIso === localToUtcISO(d, '00:00')`.)
- [ ] **Run:** `npx vitest run tests/lib/studio-time.test.ts` → pass.
- [ ] **Commit:** `feat(lib): studio-time helpers — all display times pinned to America/Chicago`

---

## Task 3: Server-side slot availability helper (UTC-window fix)

**Files:** Create `src/lib/party-availability.ts`, `tests/lib/party-availability.test.ts`; Modify `src/pages/api/party/availability.json.ts`

**Dependencies:** Task 2 (`studioDayUtcRange`).

- [ ] **Write failing tests:** mock a `listBookings` fn; assert (a) a start present in `partyStartsForDate` and not booked → `isStartOpen` true; (b) booked → false; (c) a start not in the schedule at all → false; (d) the bookings query range passed to `listBookings` equals `studioDayUtcRange(date)` (this is the UTC-boundary fix — the old code queried `${date}T00:00:00Z`..`T23:59:59Z`).
- [ ] **Implement** `src/lib/party-availability.ts`:

```ts
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { partyStartsForDate, removeBooked } from '@lib/party-slots'
import { studioDayUtcRange } from '@lib/studio-time'

/** Studio-local YYYY-MM-DD for an ISO instant. */
export function studioDateOf(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  return parts // en-CA gives YYYY-MM-DD
}

/** Open start ISOs for a studio-local date (schedule minus booked minus past). */
export async function openPartyStarts(date: string, serviceVariationId?: string): Promise<string[]> {
  const now = Date.now()
  const candidates = partyStartsForDate(date).filter((iso) => new Date(iso).getTime() > now)
  if (candidates.length === 0 || !providers.booking.listBookings) return candidates
  const { startIso, endIso } = studioDayUtcRange(date)
  const bookings = await providers.booking.listBookings({
    startDate: startIso,
    endDate: endIso,
    locationId: siteConfig.providers.booking.config.locationId || '',
  })
  const bookedStarts = bookings
    .filter((b) => b.status !== 'cancelled' && (!serviceVariationId || b.slot?.serviceVariationId === serviceVariationId))
    .map((b) => b.slot.startAt)
  return removeBooked(candidates, bookedStarts)
}

/** Is this exact start still open? Used by book.json before charging. */
export async function isStartOpen(startIso: string, serviceVariationId?: string): Promise<boolean> {
  const open = await openPartyStarts(studioDateOf(startIso), serviceVariationId)
  const t = new Date(startIso).getTime()
  return open.some((s) => new Date(s).getTime() === t)
}
```

- [ ] **Rewire `availability.json.ts`** to call `openPartyStarts(date, serviceVariationId)` (keep its existing "lookup failed → show all candidates" fallback by try/catching around the helper and falling back to `partyStartsForDate(date)` future-filtered), then map to slots as today.
- [ ] **Run:** `npx vitest run tests/lib/party-availability.test.ts` and full suite → no new failures.
- [ ] **Commit:** `fix(party): shared availability check with studio-local day bounds (UTC-window bug)`

---

## Task 4: Booking API — book before charge, re-validate slot, honest errors, email hook

**Files:** Modify `src/pages/api/party/book.json.ts`, `src/providers/square/booking.ts` (+ `src/providers/interfaces/booking.ts`); Create `src/lib/email.ts`, `tests/api/party-book.test.ts`; Modify `package.json`, `src/components/party/PartyModal.tsx` (confirmation copy), `src/config/party-content.ts`, `docs/NEEDS-FROM-KADEN.md`

**Dependencies:** Task 3.

### 4a — email module (no-op until env is set)

- [ ] `npm install nodemailer && npm install -D @types/nodemailer && npm uninstall resend`
- [ ] **Implement** `src/lib/email.ts`:

```ts
/**
 * Transactional email via Gmail SMTP. Gated on GMAIL_USER + GMAIL_APP_PASSWORD
 * (Google account → Security → 2-Step Verification → App passwords). When
 * unset, sends are skipped and callers get { sent: false } — the UI must not
 * promise an email it can't verify was attempted.
 */
import { createLogger } from '@lib/logger'
import { siteConfig } from '@config/site.config'

const logger = createLogger('email')

function creds() {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const user = env.GMAIL_USER || process.env.GMAIL_USER || ''
  const pass = env.GMAIL_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD || ''
  return user && pass ? { user, pass } : null
}

export function emailConfigured(): boolean {
  return !!creds()
}

export async function sendEmail(input: { to: string; subject: string; html: string; text: string }): Promise<{ sent: boolean }> {
  const c = creds()
  if (!c) {
    logger.warn('Email not configured — skipping send', { subject: input.subject })
    return { sent: false }
  }
  try {
    const nodemailer = await import('nodemailer')
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: c.user, pass: c.pass },
    })
    await transport.sendMail({
      from: `"${siteConfig.email.fromName}" <${c.user}>`,
      to: input.to, subject: input.subject, html: input.html, text: input.text,
    })
    return { sent: true }
  } catch (err) {
    logger.error('Email send failed', { error: err instanceof Error ? err.message : String(err) })
    return { sent: false }
  }
}

export async function sendPartyConfirmationEmail(input: {
  to: string; hostName: string; craftName: string; slotLabel: string
  hostPageUrl: string; inviteUrl: string; totalChargedCents: number; receiptUrl: string | null
}): Promise<{ sent: boolean }> {
  const fee = `$${(input.totalChargedCents / 100).toFixed(2).replace(/\.00$/, '')}`
  const text = [
    `You're booked! ${input.craftName} · ${input.slotLabel}`,
    ``,
    `Studio fee paid today: ${fee}. Crafts are paid at the studio based on who comes.`,
    ``,
    `Your party page (manage details + see who's RSVP'd — keep this link):`,
    input.hostPageUrl,
    ``,
    `Invitation link to share with your guests:`,
    input.inviteUrl,
    ...(input.receiptUrl ? [``, `Receipt: ${input.receiptUrl}`] : []),
    ``,
    `Homegrown Studio · 525 Hughes Rd Ste F, Madison, AL`,
  ].join('\n')
  const html = text
    .split('\n')
    .map((l) => (l.startsWith('http') ? `<p><a href="${l}">${l}</a></p>` : `<p>${l || '&nbsp;'}</p>`))
    .join('')
  return sendEmail({ to: input.to, subject: `You're booked — ${input.craftName} at Homegrown Studio`, html, text })
}
```

### 4b — booking order + validation

- [ ] **Interface:** add `version?: number` to `Booking` in `src/providers/interfaces/booking.ts`; in `src/providers/square/booking.ts` `createBooking`, map Square's returned booking `version` onto it (read the existing response-mapping block around line 108–160 and follow the v44 unwrapping pattern already used there).
- [ ] **Write failing tests** (`tests/api/party-book.test.ts`, follow the provider-mocking pattern in `tests/api/booking.test.ts`): (1) slot not open → 409, `providers.payment.processPayment` never called; (2) `createBooking` throws → error response says card was not charged, `processPayment` never called; (3) `processPayment` returns `status: 'failed'` → `cancelBooking` called with the new booking's id, response is 402 mentioning the date was released; (4) happy path returns `bookingId`, `hostToken`, `emailSent`, and `createBooking` was called WITHOUT `orderIdRef` (see below); (5) `serviceVariationVersion: 0` passes validation; (6) order-total mismatch → `cancelBooking` called, 500, copy says card was not charged and date released.
- [ ] **Rewrite the flow in `book.json.ts`** (keep validation + dev bypass; the dev bypass response also gains `emailSent: false`):
  - Validation fix: replace `!body.serviceVariationVersion` with `body.serviceVariationVersion == null`.
  - `dropOff` comment (line 24): `dropOff: false, // parties are never drop-off; studio-run drop-off events (camps, PNO) are flagged by staff`.
  - New step order inside the try:

```ts
    // Step 1: The slot may have been taken since the client fetched availability
    // — re-verify server-side BEFORE any Square write.
    let stillOpen = true
    try {
      stillOpen = await isStartOpen(body.startTime, body.serviceVariationId)
    } catch (err) {
      logger.error('Slot re-check failed (proceeding)', { error: String(err) })
    }
    if (!stillOpen) {
      return errorResponse('That time was just booked by someone else. Your card was not charged — pick another time.', 409)
    }

    // Step 2: customer (unchanged)
    const customer = await providers.customer.findOrCreate({ ...as today })

    // Step 3: create the booking FIRST — if this fails, nothing was charged.
    // NOTE: the order does not exist yet, so `orderIdRef` MUST be omitted from
    // the create args (today's code passes `orderIdRef: order.id` — that value
    // is unavailable in the new ordering; nothing reads the order_id custom
    // attribute back, so dropping it is safe. If reconciliation wants it, use
    // providers.booking.setCustomAttribute(booking.id, 'order_id', order.id)
    // best-effort AFTER the charge succeeds.)
    let booking
    try {
      booking = await providers.booking.createBooking({ ...same args as today EXCEPT orderIdRef removed })
    } catch (err) {
      logger.error('Party booking create failed (nothing charged)', { error: String(err) })
      return errorResponse('We couldn’t reserve that time. Your card was not charged — please try again.', 502)
    }

    // Step 4: order + charge. On failure, release the booking so the slot
    // isn't held by an unpaid party.
    let order, payment
    try {
      order = await providers.payment.createOrder({ ...as today })
      if (order.totalAmount !== partyConfig.basePriceCents) {
        logger.error('Party order total mismatch', { orderId: order.id, orderTotal: order.totalAmount })
        await releaseBooking(booking)
        return errorResponse('Pricing mismatch — your card was not charged and the date was released. Please try again or text us.', 500)
      }
      payment = await providers.payment.processPayment({ ...as today })
    } catch (err) {
      await releaseBooking(booking)
      logger.error('Party payment failed after booking created', { bookingId: booking.id, error: String(err) })
      return errorResponse('Payment didn’t go through, so we released the date. Your card was not charged — please try again.', 502)
    }
    if (payment.status === 'failed') {
      await releaseBooking(booking)
      return errorResponse('Payment was declined, so we released the date. Please try a different card.', 402)
    }
```

  with a local helper:

```ts
async function releaseBooking(booking: { id: string; version?: number }): Promise<void> {
  try {
    await providers.booking.cancelBooking(booking.id, booking.version ?? 0)
  } catch (err) {
    // Booking exists but couldn't be cancelled — flag loudly for manual cleanup.
    logger.error('ORPHANED BOOKING — cancel failed after payment failure', { bookingId: booking.id, error: String(err) })
  }
}
```

  - Step 5 (persist party record — unchanged) then **send the confirmation email** best-effort and include the result:

```ts
    const hostToken = await persistParty(booking.id, body)
    const origin = new URL(request.url).origin
    const hostPageUrl = `${origin}/party/${encodeURIComponent(booking.id)}?key=${encodeURIComponent(hostToken)}`
    const slotLabel = formatSlotLabel(body.startTime) // from @lib/studio-time
    const inviteUrl = partyInviteUrl({ bookingId: booking.id, craftName: body.craft.name, slotLabel, startIso: body.startTime }, origin)
    const { sent: emailSent } = await sendPartyConfirmationEmail({
      to: body.customer.email, hostName: body.customer.firstName, craftName: body.craft.name,
      slotLabel, hostPageUrl, inviteUrl, totalChargedCents: order.totalAmount, receiptUrl: payment.receiptUrl ?? null,
    })
```

  - Response `data` gains `emailSent`.
  - **Charge-succeeded-but-party-record-not-saved state:** `persistParty` currently swallows `savePartyRecord` failures and still returns a token — the host would get a token whose party page can never load. Change `persistParty` to return `null` on save failure (after one retry); the response then carries `hostToken: null`. In `PartyModal`, when `hostToken` is null after a completed booking, replace the "View your party page →" button with: `We couldn’t set up your party page — text us at {partyContent.textNumber} and we’ll send you the link.` (Booking + charge are still confirmed; this is a degraded-but-honest state.)
  - **Catch-all copy fix:** the final `catch` can no longer claim "Your card was not charged" (payment may have succeeded on an unexpected late failure). Replace with: `'Something went wrong finishing your booking. Don’t rebook — if you were charged, we’ll make it right. Text us at (256) 464-1710.'` (pull the number from `partyContent.textNumber` instead of hardcoding).
- [ ] **PartyModal confirmation:** (`party-content.ts` and `PartyModal.tsx:801` MUST change in the same commit — the `nextSteps` key rename breaks the component's sole consumer otherwise.) Thread `emailSent` from the booking response into state. When `emailSent === false`, replace the line `a confirmation is on its way to {email}` with `Save your party page link below — it’s how you get back to your party.` and skip the first `nextSteps` entry. Implement by adding `const [emailSent, setEmailSent] = useState(false)` set from `data.emailSent === true`, and in `party-content.ts` split `confirmation.nextSteps` into `nextStepsEmail` (current 3) and `nextStepsNoEmail` (drop the email line); modal picks by flag. Also update `PartyModal.tsx:445` fallback error copy `'Booking failed. Your card was not charged.'` → `'Booking failed — nothing was charged unless the message above says otherwise.'` is wrong; keep it simple: `'Booking failed.'` and let the server `detail` carry specifics (it always does now).
- [ ] **NEEDS-FROM-KADEN:** add item — create Gmail app password, set `GMAIL_USER` + `GMAIL_APP_PASSWORD` in Netlify env (and locally in `.env`).
- [ ] **Run:** `npx vitest run tests/api/party-book.test.ts` and full suite.
- [ ] **Commit:** `fix(party): create booking before charging, re-validate slot, honest failure copy, Gmail confirmation email`

---

## Task 5: Config cleanup — testimonials, stale party types, mock-in-prod guard, price docblocks

**Files:** Modify `src/config/site.config.ts`, `src/config/party.config.ts`, `src/lib/party-pricing.ts`, `src/providers/mock/data.ts`, `docs/NEEDS-FROM-KADEN.md`, `tests/config/site.config.test.ts`, `tests/api/catalog.test.ts`, `tests/providers/mock/catalog.test.ts`, `tests/providers/square/booking.test.ts`

**Dependencies:** Task 4 (shared `docs/NEEDS-FROM-KADEN.md` — Tasks 4→5→6→7 form a serial chain on that file)

- [ ] **Testimonials:** in `site.config.ts` (~line 356) set `items: []` (keep `heading`). `index.astro` already hides the section when empty — verify by grepping how `testimonials` is derived there. Add a NEEDS-FROM-KADEN note: "add real testimonials when they exist".
- [ ] **Party types:** replace the two stale entries (`Kids Party` $400/extra-child, `Adult Party` "drinks and snacks included" — an alcohol claim the business can't legally make yet) with ONE accurate entry:

```ts
const partyTypes: EventTypeConfig[] = [
  {
    id: 'party',
    name: 'Private Party',
    description: 'The whole studio for your group — pick a craft, pick a date, and make something together.',
    icon: 'sparkles',
    flow: 'booking',
    baseCapacity: 10,
    duration: 90,
    allowAddOns: false,
    allowExtraGuests: true,
    extraGuestPrice: 0, // crafts are per-head, settled at the studio
    maxCapacity: 30,
    basePrice: 30000, // $300 flat studio fee — must match partyConfig.basePriceCents
    catalogItemId: 'ZMSLASCRBGJ7JE3MJVOVJUSA',
    catalogCategory: 'party',
  },
]
```

  Then run the full test suite — FOUR test files assert on the old entries and need their assertions updated to the new single entry (that's fixing stale tests, not weakening them): `tests/config/site.config.test.ts`, `tests/api/catalog.test.ts`, `tests/providers/mock/catalog.test.ts` (line ~26 does `types.find(t => t.category === 'birthday')`), and `tests/providers/square/booking.test.ts` (uses `eventType: 'birthday'` in ~6 places — lines 170, 181, 190, 254, 357, 406). Grep for `'birthday'`/`'adult-party'` event-type id usages across `src/` and update any (e.g. mock catalog keys `party-birthday`/`category: 'birthday'` in `src/providers/mock/data.ts:5,8`).
- [ ] **Mock-in-prod guard:** immediately after `const providerMode = env.PROVIDER_MODE || 'mock'` add:

```ts
// Never let demo copy/data ship: a production BUILD without an explicit
// PROVIDER_MODE is a deploy misconfiguration, not a fallback.
// ALLOW_MOCK_PROVIDER=1 is the local escape hatch for `npm run build` without
// Square creds — never set it in Netlify.
if (env.PROD && providerMode === 'mock' && !env.ALLOW_MOCK_PROVIDER) {
  throw new Error('PROVIDER_MODE is unset/mock in a production build — set PROVIDER_MODE=square in the Netlify environment (or ALLOW_MOCK_PROVIDER=1 for a local build).')
}
```

  **Blast radius warning:** `site.config.ts` is imported by ~21 files and this throw fires at module load during ANY prod-mode Vite build — including free Netlify deploy previews. **Before merging this task, confirm `PROVIDER_MODE=square` is set site-wide in the Netlify env** (not just flagged in NEEDS-FROM-KADEN). The plan's own `npm run build` verification needs either `PROVIDER_MODE=square` or `ALLOW_MOCK_PROVIDER=1` locally. Vitest runs with `PROD=false` — unaffected.
- [ ] **Price docblocks:** `party.config.ts:4` `($200 flat studio fee)` → `($300 flat studio fee)`; grep `src/lib/party-pricing.ts` for `$200` and fix its header comment the same way.
- [ ] **Mock data copy:** in `src/providers/mock/data.ts` rewrite the flagged strings: the kids-birthday item description (line ~7) → occasion-neutral (`'Celebrate anything with a hands-on craft party — every guest makes a piece to take home.'`), remove "birthday crown craft for the guest of honor", and delete/replace `'Complimentary wine, beer, and a charcuterie spread are included'` (line ~28) → `'Bring a treat to share if you like — we handle the crafting.'`. Rename the `kids-party` category id/copy to `party` if it exists only in mock data (align with the partyTypes change above).
- [ ] **Run:** `npx vitest run` → update stale assertions, no new failures.
- [ ] **Commit:** `fix(config): remove fake testimonials, stale party types + alcohol claim, guard mock provider in prod, $300 docblocks`

---

## Task 6: Copy sweep — homepage, programs meta, party placeholder, misc

**Files:** Modify `src/pages/index.astro`, `src/pages/programs.astro`, `src/components/party/PartyModal.tsx`, `src/lib/party-store.ts`, `docs/NEEDS-FROM-KADEN.md`

**Dependencies:** Task 1 (`party-store.ts` refactor lands first), Task 5 (shared `docs/NEEDS-FROM-KADEN.md` — Tasks 4→5→6→7 form a serial chain on that file)

- [ ] `index.astro:57`: `Handcrafted workshops, birthday parties, and creative experiences for all ages` → `Handcrafted workshops, private parties, and creative experiences for all ages`
- [ ] `index.astro:13` (Private Parties card description): → `The whole studio for your people — birthdays, girls’ nights, showers, team nights, or just because.`
- [ ] `programs.astro:16` meta description: replace the "programs for kids" phrasing with `Camps, classes, and multi-week creative programs at Homegrown Studio.` (feature is hidden; this stops the copy time-bomb).
- [ ] `PartyModal.tsx:724` placeholder: `e.g. Ari’s 7th Birthday` → `e.g. Maya’s Birthday · Team Night`
- [ ] `party-store.ts` `dropOff` docblock: replace "Birthday-style parties (parent present) leave this false." with `Parties are never drop-off (a responsible adult stays with each child); only studio-run drop-off events (camps, PNO) set this, via the staff console.`
- [ ] `docs/NEEDS-FROM-KADEN.md`: add "verify the FAQ claim 'most are $15–$40' against actual Party Crafts prices" (from `party-content.ts:69`).
- [ ] **Run:** `npx vitest run` (copy-only; expect clean), and `npm run build` compiles.
- [ ] **Commit:** `fix(copy): occasion-neutral homepage/placeholder copy, drop-off comments, programs meta`

---

## Task 7: Agreement v2 + waiver copy (second adult, supervision, RSVP'd)

**Files:** Modify `src/config/waiver-content.ts`, `src/config/invite-content.ts`, `src/pages/waiver.astro`, `docs/NEEDS-FROM-KADEN.md`

**Dependencies:** Task 6 (shared `docs/NEEDS-FROM-KADEN.md` chain)

**Note:** the agreement text is SHA-256-hashed into every signed record — ANY `legalSections` change requires the version bump (v1 → v2). Existing v1 records stay valid; new signatures record v2. **This is a one-way door:** records signed at v2 carry a v2 hash and can never be re-verified if the text is rolled back to v1 — add that as a comment next to the `version` field, alongside the attorney-review pointer.

- [ ] **`waiver-content.ts` structural fix:** hoist `const adultAge = 19` above the object; set `adultAge: adultAge,` and `adultNote: \`You must be ${adultAge} or older to sign. This covers you plus any children you’re the parent or legal guardian of — every other adult signs their own.\``
- [ ] **Version:** `version: 'v2'`.
- [ ] **§4(c) rewrite** (replace the current supervision paragraph verbatim with):

```
'(c) Supervision. Private parties and regular Studio activities are NOT drop-off events. I remain responsible for each listed minor at all times while at the Studio, and if I am not personally present I will designate another responsible adult, present at the Studio, who is in charge of each listed minor. The Studio provides craft instruction and facilities; it does not provide childcare or supervision of minors. Separately, if the Studio offers a designated drop-off program (such as a camp), participation in that program is governed by that program’s own registration terms and check-in/pickup procedures, which I agree to at registration.',
```

- [ ] **Page copy:**
  - `page.subline`: `One quick signature covers you and your own kids for a full year of studio visits, workshops, and parties. Every adult signs their own.`
  - `page.partySubline`: `You’re invited to a party at Homegrown Studio! One quick signature covers you and your own kids for the event — and a full year of visits after. Every adult signs their own.`
  - `confirmation.partyLine`: `You’re RSVP’d — see you at the party! 🎉`
  - Add `confirmation.anotherAdultLine: 'Bringing another adult? Send them this page’s link — every adult signs their own agreement.'`
  - Add to `form`: `responsibleAdultLabel: 'Who will be with them at the party?'` and `responsibleAdultNote: 'Parties aren’t drop-off — every child needs a responsible adult with them. If that’s not you, tell us who it will be (e.g. “Riding with Grandma Sue — she’ll be there”).'` and a missing-list phrase constant is not needed (inline in component).
  - Delete the dead `handoff.hostLine` and `handoff.guestInviteLine` entries — **ONLY those two keys**: `handoff.hostCta` is live in `PartyModal.tsx:774` and `handoff.workshopCta` is live in the workshop confirmation (Task 16 modifies it). Run `grep -rn "handoff\." src/` first and keep every rendered key.
- [ ] **`invite-content.ts`:** `rsvp.body` → `Everyone coming signs our short participation agreement — about a minute, and it covers you and your own kids for a full year of visits. Every adult in your group signs their own, so forward this to anyone coming with you.` (keep the footnote).
- [ ] **`waiver.astro` meta description:** → `Sign the Homegrown Studio participation agreement — each adult signs for themselves and their own kids, good for a full year.`
- [ ] **NEEDS-FROM-KADEN:** add "attorney review of agreement v2 §4(c) supervision language before 9/1" and keep the existing `legalEntityName` TODO note (bumping to v3 when the LLC name lands).
- [ ] **Run:** `npx vitest run` → no new failures (`serializeAgreement` has no snapshot tests today; verify with grep).
- [ ] **Commit:** `feat(waiver): agreement v2 — party supervision clause, every-adult-signs-their-own copy, RSVP’d confirmation`

---

## Task 8: WaiverFlow — responsible adult, drop-off copy removal, returning-path fixes

**Files:** Modify `src/components/waiver/WaiverFlow.tsx`, `src/pages/api/waiver/sign.json.ts`

**Dependencies:** Task 7 (copy keys), Task 9 (both rewrite `sign.json.ts` — Task 9's rate-limit/token/party-validation scaffolding lands first).

- [ ] **Party attending section copy** (line ~639): delete `If you’re just dropping off, leave yourself unchecked.` New note: `Check everyone who’ll be there doing the craft.`
- [ ] **Responsible-adult field:** add state `const [responsibleAdult, setResponsibleAdult] = useState('')`. Compute `const kidsWithoutSigner = partyId && minors.length > 0 && formAttending['adult'] === false && minors.some((_, i) => formComing(\`child:${i}\`))`. When true, render below the checkboxes an input using `form.responsibleAdultLabel`/`form.responsibleAdultNote`, and add to `missing`: `if (kidsWithoutSigner && !responsibleAdult.trim()) m.push('the adult who’ll be with your child at the party')` (add `responsibleAdult` to the memo deps). Send `responsibleAdult: responsibleAdult.trim()` in the sign payload.
- [ ] **Returning path parity:** same rule in the returning card — when `partyId` is set, kids are checked and `attending['adult']` is false, show the same input; include `responsibleAdult` in the reuse payload; disable the RSVP button until filled.
- [ ] **Returning path without a party** (the `'✓ Check me in'` bug): when `mode === 'returning' && !partyId`, do NOT offer a submit at all (the old button minted a duplicate record and note-spammed Square). Replace button block with a static confirmation: `You’re already covered — valid through {validUntil}.` (lookup must return `validUntil`; it already does). Keep the "Update your agreement →" link.
- [ ] **Confirmation second-adult line:** in the `done` view, after `confirmation.subline`, render `confirmation.anotherAdultLine`.
- [ ] **Server (`sign.json.ts`):** accept `responsibleAdult` (string, trimmed, max 120 chars) on both fresh and reuse paths; when the record is party-scoped, minors are attending, and `'adult'` is NOT in the attending ids, require it: `return bad('Parties aren’t drop-off — tell us which adult will be with your child at the party.')`. Store as `responsibleAdult: string | null` on `WaiverRecord` (add the field in `waiver-store.ts`; normalize legacy records to `null` — records are parsed raw JSON, so just make it optional). Surface it in the STAFF roster payload (`api/staff/roster.json.ts`) as `responsibleAdult` and render in `StaffConsole` household meta when present: `<strong>With:</strong> {h.responsibleAdult}` (Task 12 touches the same file — coordinate).
- [ ] **Client age check** (small, same file): in `missing`, if `dob` is set and computes to under `waiverContent.adultAge` years: push `` `to be ${waiverContent.adultAge}+ to sign — ask a parent/guardian to sign and list you` `` (mirror of the server check so 18-year-olds don't dead-end after filling everything).
- [ ] **Run:** `npx vitest run`; then manual: `npm run dev`, walk `/waiver?party=test` — kids-without-adult requires the field; no-party returning shows read-only covered state.
- [ ] **Commit:** `feat(waiver): responsible-adult-at-party requirement, remove drop-off invitation copy, fix returning-path fake check-in`

---

## Task 9: Lookup/sign hardening — rate limit + reuse token + party validation

**Files:** Create `src/lib/rate-limit.ts`, `src/lib/reuse-token.ts`, `tests/lib/rate-limit.test.ts`, `tests/lib/reuse-token.test.ts`; Modify `src/pages/api/waiver/lookup.json.ts`, `src/pages/api/waiver/sign.json.ts`, `src/components/waiver/WaiverFlow.tsx`, `docs/NEEDS-FROM-KADEN.md` (add `LOOKUP_SIGNING_SECRET` as a required Netlify env var)

**Dependencies:** Task 7 (serial chain on `docs/NEEDS-FROM-KADEN.md`).

- [ ] **Write failing tests:** rate-limit — 10 hits/min/key allowed, 11th blocked, separate keys independent, window slides. reuse-token — round-trips a recordId, rejects tampered payload, rejects after expiry (inject a clock).
- [ ] **Implement `src/lib/rate-limit.ts`:**

```ts
/**
 * Per-IP sliding-window limiter. In-memory per serverless instance — not
 * airtight, but it turns "script the endpoint" into "script it slowly from
 * many IPs", which is the economic bar we need for a small venue.
 */
const hits = new Map<string, number[]>()

export function rateLimited(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (arr.length >= max) { hits.set(key, arr); return true }
  arr.push(now)
  hits.set(key, arr)
  if (hits.size > 10_000) hits.clear() // memory guard
  return false
}
```

- [ ] **Implement `src/lib/reuse-token.ts`** (HMAC over `recordId.expiry`, secret from `env.LOOKUP_SIGNING_SECRET` falling back to `STAFF_PASSCODE`). **Do NOT fall back to a per-module random:** `issueReuseToken` runs in the lookup route module and `verifyReuseToken` in the sign route module — separate module scopes (and possibly separate Lambda instances), so a per-boot random secret means tokens NEVER verify, silently breaking every returning-customer RSVP whenever both env vars are unset (which is the default in local dev). Instead: in dev (`import.meta.env.DEV`) fall back to the fixed string `'dev-only-not-a-secret'` (documented as non-security-bearing); in prod with neither env set, log an error and fall back to the same constant so the flow degrades insecurely-but-working rather than breaking — and add `LOOKUP_SIGNING_SECRET` to NEEDS-FROM-KADEN as a required Netlify env var:

```ts
import { createHmac } from 'node:crypto'
import { createLogger } from '@lib/logger'

const TTL_MS = 15 * 60 * 1000
const logger = createLogger('reuse-token')
let warned = false
function secret(): string {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const s = env.LOOKUP_SIGNING_SECRET || process.env.LOOKUP_SIGNING_SECRET || env.STAFF_PASSCODE || process.env.STAFF_PASSCODE
  if (s) return s
  // Fixed fallback so issue (lookup route) and verify (sign route) — separate
  // module scopes — always agree. Fine in dev; in prod this is a config error.
  if (env.PROD && !warned) { warned = true; logger.error('LOOKUP_SIGNING_SECRET unset in production — reuse tokens are not secret') }
  return 'dev-only-not-a-secret'
}
const sig = (payload: string) => createHmac('sha256', secret()).update(payload).digest('hex')

export function issueReuseToken(recordId: string, now = Date.now()): string {
  const exp = now + TTL_MS
  return `${exp}.${sig(`${recordId}.${exp}`)}`
}
export function verifyReuseToken(recordId: string, token: string, now = Date.now()): boolean {
  const [expStr, mac] = String(token).split('.')
  const exp = Number(expStr)
  if (!exp || exp < now || !mac) return false
  return mac === sig(`${recordId}.${exp}`)
}
```

- [ ] **`lookup.json.ts`:** at top of POST — `if (rateLimited(`lookup:${clientAddress}`, 10, 60_000)) return 429 {'error':'Too many lookups — give it a minute and try again.'}` (add `clientAddress` to the APIRoute destructure). In the found-response, add `reuseToken: issueReuseToken(h.recordId)`.
- [ ] **`sign.json.ts`:** rate limit (`sign:${clientAddress}`, 10/min → same 429 shape). In `handleReuse`, require `verifyReuseToken(reuseId, body.reuseToken)` — on failure: `bad('That session expired — look yourself up again to RSVP.', 401)`. **Party validation** (both paths, before persist): if `partyId` is set, `getPartyRecord(partyId)`; missing → `bad('This party link doesn’t look right — ask your host to re-share the invitation.', 404)`; if `new Date(party.startIso).getTime() + 24*3600_000 < Date.now()` → `bad('This party has already happened — nothing to RSVP to, but thanks for checking!', 410)`.
- [ ] **`WaiverFlow.tsx`:** store `reuseToken` from the lookup response alongside `recordId`, send it in `handleReturningRsvp`; surface 429 error messages as-is (they're written for humans). **On a 401 from `handleReturningRsvp`** (token expired — e.g. a tab left open 16+ minutes): clear `returning`/`reuseToken` state, `setMode('lookup')`, and show `'Your session expired — enter your email or phone again to continue.'` above the lookup form (reuse the `error` state), so the guest has a path forward instead of a dead card.
- [ ] **Run:** new lib tests + full suite.
- [ ] **Commit:** `feat(security): rate-limit waiver lookup/sign, bind reuse to fresh lookup, validate party links`

---

## Task 10: RSVP dedup by household + duplicate-kid flags

**Files:** Modify `src/lib/waiver-store.ts`, `src/pages/api/waiver/sign.json.ts` (imports + call site of the renamed index function + checkin migration — do not miss this file), `src/pages/api/staff/roster.json.ts`, `src/pages/api/party/roster.json.ts`, `src/components/staff/StaffConsole.tsx`; Create `tests/lib/waiver-store.test.ts`

**Dependencies:** Task 1 (kv), Task 9 (both touch sign.json.ts — 9 first), Task 11 (checkin-store shape + exported `normalize` land first).

**Design:** dedup is **same-contact replacement** — the same person re-RSVPing replaces their previous entry (re-RSVP == edit RSVP). Two different adults (mom and dad, each their own email) legitimately coexist; if both list the same kids, the kids are flagged and counted once.

- [ ] **Write failing tests** (`tests/lib/waiver-store.test.ts`, fs mode): (a) upserting two records with the same normalized email into one party index leaves ONE entry (the newer recordId); (b) different emails → two entries; (c) a legacy index of bare string ids still reads correctly; (d) `markDuplicateChildren` flags the second occurrence of "Emma Rivera" (case/space-insensitive) across households and leaves distinct names unflagged.
- [ ] **Index format upgrade** in `waiver-store.ts`: entries become `{ recordId: string, contactKey: string }`; normalize legacy bare-string entries to `{ recordId: s, contactKey: '' }` on read. Replace `addWaiverToPartyIndex(partyId, recordId)` with:

```ts
function contactKeyOf(r: WaiverRecord): string {
  const email = r.adult.email.trim().toLowerCase()
  if (email) return `e:${email}`
  const digits = r.adult.phone.replace(/\D/g, '').slice(-10)
  return digits ? `p:${digits}` : `r:${r.id}`
}

/** Add-or-replace this household's entry in the party index (re-RSVP = edit). */
export async function upsertWaiverInPartyIndex(partyId: string, record: WaiverRecord): Promise<{ replacedRecordId: string | null }> {
  const key = partyIndexKey(partyId)
  const raw = await kv.get(key)
  const entries: { recordId: string; contactKey: string }[] = raw
    ? JSON.parse(raw).map((e: any) => (typeof e === 'string' ? { recordId: e, contactKey: '' } : e))
    : []
  const ck = contactKeyOf(record)
  const prev = entries.find((e) => e.contactKey === ck && e.recordId !== record.id)
  const next = entries.filter((e) => e.contactKey !== ck && e.recordId !== record.id)
  next.push({ recordId: record.id, contactKey: ck })
  await kv.set(key, JSON.stringify(next))
  return { replacedRecordId: prev?.recordId ?? null }
}
```

  **`listWaiversByParty` MUST get the same legacy/object normalization** — it currently does `JSON.parse(existing)` straight into `string[]` and `ids.map(getWaiverRecord)`; once the index holds objects, that calls `getWaiverRecord({recordId,...})` → key `[object Object]` → every roster silently empties. Extract the normalizer into a shared `readIndexEntries(key)` used by BOTH `upsertWaiverInPartyIndex` and `listWaiversByParty`:

```ts
async function readIndexEntries(key: string): Promise<{ recordId: string; contactKey: string }[]> {
  const raw = await kv.get(key)
  return raw ? JSON.parse(raw).map((e: any) => (typeof e === 'string' ? { recordId: e, contactKey: '' } : e)) : []
}
```

  and add the test: an index blob containing a MIX of legacy strings and new objects lists all records correctly.
- [ ] **Migrate check-in state on replacement** in `sign.json.ts` `persistWaiver`: it now calls `upsertWaiverInPartyIndex(record.partyId, record)`; when `replacedRecordId` is returned, copy live state so a mid-party re-sign doesn't orphan presence/pickup codes:

```ts
if (replacedRecordId) {
  try {
    const old = await getCheckin(record.partyId, replacedRecordId)
    if (Object.keys(old.presence).length > 0 || old.pickupCodeHash) {
      await setCheckin(record.partyId, record.id, old) // setCheckin normalizes on write (Task 11)
    }
  } catch (err) { logger.error('Checkin migration failed on re-RSVP', { error: String(err) }) }
}
```

  (import `getCheckin`/`setCheckin` from `@lib/checkin-store`; Task 11 makes `setCheckin` normalize + cap `events` on EVERY write, so legacy-shaped states are safe to pass through. Person ids `adult`/`child:{i}` remain positional — if the household edited its kid list the mapping can shift; acceptable, staff verify at the door. The old `{partyId}__{oldRecordId}` check-in blob is orphaned but harmless — its recordId is gone from the index so no roster ever reads it.)
- [ ] **Duplicate-kid flags:** add to `waiver-store.ts`:

```ts
/** Flag children whose normalized name appears in an EARLIER household too. */
export function markDuplicateChildren<T extends { signer: string; children: { name: string; duplicateOf?: string }[] }>(households: T[]): number {
  const seen = new Map<string, string>() // normalized name -> first signer
  let duplicates = 0
  for (const h of households) {
    for (const c of h.children) {
      const k = c.name.trim().toLowerCase().replace(/\s+/g, ' ')
      if (!k) continue
      const first = seen.get(k)
      if (first) { c.duplicateOf = first; duplicates++ } else seen.set(k, h.signer)
    }
  }
  return duplicates
}
```

  Apply in **staff** `roster.json.ts` after building households (sorted by signedAt first so "first" is the earlier RSVP — sort by `signedAt` for marking, then re-sort by signer for display); subtract `duplicates` from the `people` summary. Apply the same count-correction in **host** `roster.json.ts` (`summary.people`). StaffConsole: when `c.duplicateOf` is set on a child row, render `<Badge tone="muted">also on {duplicateOf}’s RSVP</Badge>` and exclude them from the default check-in selection.
- [ ] **Run:** lib tests + full suite.
- [ ] **Commit:** `feat(rsvp): household upsert (re-RSVP edits instead of duplicating), duplicate-kid flags + corrected headcounts`

---

## Task 11: Check-in — audit log, reissue/issue fixes, honest errors

**Files:** Modify `src/lib/checkin-store.ts`, `src/pages/api/staff/checkin.json.ts`; Create `tests/lib/checkin-events.test.ts`

**Dependencies:** Task 1.

- [ ] **Write failing tests:** `appendEvent` grows `events`; `normalize` defaults `events: []` on legacy blobs; after simulating checkin → undo-checkin the events array still contains both entries (history survives even though presence was cleared).
- [ ] **`checkin-store.ts`:** add to `CheckinState`:

```ts
export interface CheckinEvent {
  at: string // ISO
  action: 'checkin' | 'undo-checkin' | 'pickup' | 'pickup-denied' | 'undo-pickup' | 'reissue-code' | 'set-pickup'
  personIds: string[]
  pickedUpBy?: string
  note?: string
}
// CheckinState gains: events: CheckinEvent[]
```

  `emptyState()` and `normalize()` include `events: []` (normalize: `Array.isArray(raw?.events) ? raw.events : []`). **Export `normalize`** (Task 10's migration and tests use it). **`toPublicCheckin` must explicitly NOT include `events`** — keep it building an object field-by-field (as today), never a spread of `CheckinState`, so the custody log can't leak into host/staff roster payloads. **`setCheckin` normalizes + caps on EVERY write**: first line becomes `state = normalize(state); state.events = state.events.slice(-500)` — this keeps direct callers (`setExpected` legacy path, Task 10's migration) consistent with `mutateCheckin`.
  Also add a **read-modify-write retry** wrapper used by the checkin endpoint:

```ts
/** Apply a mutation with optimistic concurrency (3 attempts). */
export async function mutateCheckin(partyId: string, recordId: string, fn: (s: CheckinState) => void | Promise<void>): Promise<CheckinState> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(key(partyId, recordId))
    const state = value ? normalize(JSON.parse(value)) : emptyState()
    await fn(state)
    state.events = state.events.slice(-500)
    if (await kv.setIfMatch(key(partyId, recordId), JSON.stringify(state), etag)) return state
  }
  throw new Error('Concurrent update — please retry')
}
```

- [ ] **`checkin.json.ts`:** restructure the handler to run inside `mutateCheckin` (the switch mutates `state`; results captured via closure variables declared BEFORE the `mutateCheckin` call: `let oneTimeCode: string | null = null` and `let denyReason: string | null = null` — the retry loop may re-run the callback, so the callback must only assign, and only the final committed attempt's values survive; the endpoint reads them after `mutateCheckin` resolves to decide 200 vs 400). Every branch appends an event (`state.events.push({ at: nowIso, action, personIds: ids, ... })`). Specifics:
  - `checkin`: unchanged logic + event.
  - `undo-checkin`: keep clearing presence BUT record what was cleared: `note: 'cleared: ' + JSON.stringify(prevPresence)`.
  - `pickup` code mismatch: **persist a `pickup-denied` event and set `denyReason`** — the callback appends the event and RETURNS (no throw), the write commits (that's the audit record), then the endpoint sees `denyReason` and responds 400. Distinguish errors: `if (!state.pickupCodeHash)` → `denyReason = 'No pickup code was ever issued for this family — use “Issue pickup code” first.'`; else mismatch → the existing "doesn't match" message.
  - `reissue-code`: guard — `if (!dropOff) return 400 'Pickup codes only apply to drop-off events.'`; allowed whether or not a code already exists (this is also how staff ISSUE a first code when drop-off was toggled after check-in — the C1 dead-end fix); event `note: state.pickupCodeHash ? 'rotated' : 'first issue'`. (Note: toggling drop-off OFF leaves any `pickupCodeHash` in place — harmless, since the pickup code gate is `dropOff &&`-scoped and the "code issued" UI only renders when dropOff is true. Document with a one-line comment; no cleanup needed.)
  - Wrap the whole thing: on `mutateCheckin` throwing the concurrency error → 409 `'Another device just updated this family — refresh and try again.'`; on transient store errors (anything else) → 503 `'Couldn’t reach storage — check wifi and try again.'`.
  - `setExpected` in `checkin-store.ts` switches to `mutateCheckin` too (sets only `expected`).
- [ ] **Run:** tests + full suite.
- [ ] **Commit:** `feat(checkin): append-only custody audit log, optimistic concurrency, issue-code path for late drop-off toggle`

---

## Task 12: StaffConsole — refresh/search/error handling/Reset guard/copy

**Files:** Modify `src/components/staff/StaffConsole.tsx`

**Dependencies:** Tasks 2, 8 (responsibleAdult in roster), 10 (duplicate badges), 11 (issue-code semantics).

- [ ] **Studio time:** replace local `when`/`timeOnly` with `formatWhen`/`formatTime` from `@lib/studio-time`.
- [ ] **Fetch error handling:** wrap `loadParties` and `openParty` bodies in try/catch → `const [netError, setNetError] = useState<string | null>(null)`; on catch set `'Couldn’t reach the studio server — check wifi and tap Retry.'` and render a Retry button (calls the same fn). `post()` wraps its `fetch` in try/catch returning `{ error: 'Couldn’t save — check wifi and try again.' }`.
- [ ] **Roster refresh + poll:** add `refreshRoster()` (re-fetch, `setRoster`) with a `↻ Refresh` button next to "← All parties"; `useEffect` polling every 30s while `phase === 'roster'` (clear on phase change/unmount). Cards are keyed by `recordId`, so local `oneTimeCode` display state survives a refresh.
- [ ] **Search:** `const [query, setQuery] = useState('')`; input above the household list (`placeholder="Find a family or kid…"`); filter households where signer or any child name includes the query case-insensitively. Clear on party change.
- [ ] **Reset two-tap guard** (no `window.confirm` — owner rule): replace the Reset button with a small two-state control: first tap → renders inline `Really reset? Clears this family’s arrival times.` + `[Reset] [Keep]`; confirm fires `act({ action: 'undo-checkin' })`; auto-revert after 5s.
- [ ] **Issue-code affordance (C1 fix):** change the condition at line ~245 from `…&& h.checkin.hasPickupCode` to `dropOff && status === 'in' && !oneTimeCode`; label: `h.checkin.hasPickupCode ? 'Re-issue code' : 'Issue pickup code'`; the `🔒 Pickup code issued (hidden)` span only when `hasPickupCode`.
- [ ] **Summary fixes:** allergy count includes adults — `const allergyPeople = roster.households.reduce((n, h) => n + (h.adultAllergies ? 1 : 0) + h.children.filter((c) => c.allergies).length, 0)`; badge `⚠ {allergyPeople} with allergies`. Replace the confusing `🗓 {coming} of {summary.people} coming` with `🗓 {coming} expected` (summary.people is already duplicate-corrected server-side per Task 10).
- [ ] **Badge wrap:** `Badge` gains optional `wrap` prop → `whiteSpace: wrap ? 'normal' : 'nowrap'`; allergy badges pass `wrap` so long notes ("carries EpiPen in blue bag") don't overflow phones. Drop the per-row `🚫 Photos` badge (household-level flag already shown once in the scan strip at line ~199).
- [ ] **Drop-off toggle copy:** label → `Drop-off event (studio-run only — camps/PNO; parties are not drop-off)`.
- [ ] **Responsible adult:** render `With: {h.responsibleAdult}` in card meta when present (from Task 8's roster field).
- [ ] **Verify manually:** `npm run dev`, seed a dev party, walk check-in/pickup/reset/search on a narrow viewport.
- [ ] **Commit:** `feat(staff): roster refresh+search, network error states, reset guard, issue-code fix, adult allergies in summary`

---

## Task 13: Host dashboard — PII/token fixes, copy, refresh

**Files:** Modify `src/pages/api/party/roster.json.ts`, `src/components/party/PartyDashboard.tsx`, `src/components/party/PartyModal.tsx`

**Dependencies:** Tasks 2, 10.

- [ ] **Host roster payload:** remove `email`, `phone`, `emergency`, `signedAt` from each household object (keep server-side `signedAt` sort before mapping). Update `PartyDashboard.tsx`'s `Household` interface to match.
- [ ] **Token out of calendars:** in `PartyDashboard.tsx` `calEvent.details` → `` `Your private party at Homegrown Studio.\n\nInvitation link for guests: ${inviteUrl}` `` (inviteUrl is token-free). Same fix in `PartyModal.tsx` `renderConfirmation` — its `calendarEvent.details` currently embeds `hostPageUrl`; replace with the invite URL built from `partyInviteUrl(...)` (already imported).
- [ ] **Copy/perspective:** in `PartyDashboard.tsx`:
  - `'family'/'families'` → `'group'/'groups'`.
  - Empty state → `No RSVPs yet — share your invitation above and guests will appear here as they sign.`
  - Row summary (line ~222): `` const first = h.signer.split(' ')[0] `` then `comingKids.length > 0 ? `${adultComing ? `${first} + ` : ''}${comingKids.length} ${comingKids.length === 1 ? 'kid' : 'kids'}` : adultComing ? `just ${first}` : '—'`.
  - Denied state: `Use the link from your booking confirmation email. Lost it? Text us at (256) 464-1710 and we’ll re-send it.` (pull number from `partyContent.textNumber`).
- [ ] **Headcount reconciliation:** under the "Who's coming" header add `Booked for {party.guestCount} · {summary.people} RSVP’d so far` (guestCount is already in the payload).
- [ ] **Refresh:** add a `↻ Refresh` chip calling `load()`, plus a 30s poll while mounted.
- [ ] **Studio time:** replace local `formatWhen` with `@lib/studio-time` `formatWhen` (fixes the invite `when=` label being built in the host's device TZ — the label feeds `partyInviteUrl`).
- [ ] **Run:** full suite + `npm run build`.
- [ ] **Commit:** `fix(host): strip PII from host roster, token-free calendar events, group copy, refresh + headcount reconciliation`

---

## Task 14: PartyModal — discard guard, dialog semantics, dates retry, emailSent

**Files:** Modify `src/components/party/PartyModal.tsx`

**Dependencies:** Task 2 (studio-time), Task 4 (emailSent — already wired there), Task 6 (placeholder edit), Task 13 (calendar-details edit) — all four tasks touch `PartyModal.tsx`; this one goes last.

- [ ] **Studio time:** replace local `formatTime`/`formatSlotLabel` with the `@lib/studio-time` versions (slot pills gain the `CT` suffix via `formatSlotLabel`; keep `formatTime` for pill buttons and append ` CT` only in the summary chip label to avoid clutter on the grid — use `formatSlotLabel` where the full label renders). `formatDateLabel` stays (pure Y-M-D, already local-safe).
- [ ] **Discard guard:** add `const [confirmDiscard, setConfirmDiscard] = useState(false)` and `const dirty = !!selectedCraft || !!selectedSlot || !!firstName.trim() || !!email.trim()`. New close request handler:

```ts
function requestClose() {
  if (completed || !dirty) return onClose()
  setConfirmDiscard(true)
}
```

  Backdrop `onClick` and the header ✕ both call `requestClose()`. Add an Escape handler (`useEffect` keydown → `requestClose()`). When `confirmDiscard`, render an in-card bar above the step content: `Close and lose your progress?` with `[Keep booking]` (primary, `setConfirmDiscard(false)`) and `[Close]` (`onClose()`). Also clear the bar when the booking completes: `useEffect(() => { if (completed) setConfirmDiscard(false) }, [completed])` — otherwise a backdrop click racing the confirmation leaves the discard bar over the success screen.
- [ ] **Dialog semantics:** on the card div: `role="dialog" aria-modal="true" aria-label="Book a Party"`; on open, focus the card (`tabIndex={-1}` + ref focus in a mount effect). (Full focus trap is out of scope — note as follow-up.)
- [ ] **`available-dates` retry:** where `datesError` renders (line ~1080), add a `Try again` button that re-runs the dates fetch (extract the effect body into `loadAvailableDates()` so both the effect and the button call it).
- [ ] **`slotMissed` banner:** make conditional — when `availableSlots.length === 0` show `That time was just booked and this date is now full — pick another date.`; clear `slotMissed` inside `handleDateChange`.
- [ ] **Last-name hack removal:** `lastName: lastName.trim() || firstName.trim()` → `lastName: lastName.trim()`; server-side in `book.json.ts` relax the validation to require only `firstName` + `email` (customer provider `familyName` accepts empty string — verify `findOrCreate` tolerates it; if Square requires non-empty, send `familyName: body.customer.lastName || '—'` in the PROVIDER layer, not fake data in the customer record… simplest verified-safe approach: keep requiring firstName+email in the API, pass lastName through as-is, and confirm `providers/square/customer.ts` handles empty `familyName`; if it errors, omit the field when empty).
- [ ] **Verify manually:** dev walk-through — backdrop click mid-payment shows the guard; Escape works; a deeplinked dead date shows the corrected banner.
- [ ] **Commit:** `fix(party-modal): discard guard + dialog semantics, dates retry, studio-local slot labels, drop last-name duplication hack`

---

## Task 15: Invite + waiver pages resolve the party server-side

**Files:** Modify `src/pages/invite.astro`, `src/pages/waiver.astro`, `src/components/waiver/WaiverFlow.tsx`

**Dependencies:** Tasks 2, 9, 8 (WaiverFlow is rewritten in Task 8 — this task layers on top).

- [ ] **`invite.astro`:** when `party` param is present, `const record = await getPartyRecord(partyId)`. If found, derive `craft = record.craftName`, `when = formatWhen(record.startIso) + ' CT'`, `start = record.startIso`, `title = record.title ?? params.get('title') ?? ''` — server data beats (possibly mangled) query params; query params remain the fallback when the record is missing (blob hiccup) so old links keep working. If the party is >24h past, render a friendly `This party has already happened` state: replace the RSVP CTA with static text `Hope it was a good one! Come craft with us any time — homegrowncraftstudio.com/book` and NO waiver link (a dead `?party=` link would just bounce off waiver.astro's own past-party notice).
- [ ] **`waiver.astro`:** when `party` is present, resolve it — and distinguish the three outcomes:
  - **found** → pass `partyLabel={\`${record.title ?? record.craftName + ' Party'} · ${formatWhen(record.startIso)} CT\`}` to `WaiverFlow` and keep `partyId`;
  - **`getPartyRecord` returned `null`** (genuinely unknown id) → render the notice `That party link wasn’t recognized — ask your host for a fresh invitation. You can still sign the general agreement below.` and pass NO partyId (prevents ghost RSVPs);
  - **`getPartyRecord` THREW** (transient Blobs error — a real guest with a valid link mid-outage) → keep the `partyId` and proceed WITHOUT the partyLabel chip; do not strip a valid RSVP linkage because of a storage blip (sign.json re-validates the party anyway);
  - **>24h past** → notice `This party has already happened.` and no partyId.
- [ ] **`WaiverFlow.tsx`:** accept optional `partyLabel?: string`; when present render a context chip above the flow: `RSVP’ing to: {partyLabel}` — so a guest can SEE which party their signature attaches to.
- [ ] **Verify manually:** invite link with `craft`/`when` params stripped still renders full details; `/waiver?party=garbage` shows the notice and signs generically.
- [ ] **Commit:** `fix(invite): resolve party server-side — no more ghost RSVPs or mangled-link blank invites`

---

## Task 16: Event context + workshop linking + coverage endpoint + events lib

**Files:** Modify `src/lib/waiver-store.ts`, `src/pages/api/waiver/sign.json.ts`, `src/pages/waiver.astro`, workshop confirmation component (grep `handoff.workshopCta` for the render site); Create `src/lib/events.ts`, `src/pages/api/staff/coverage.json.ts`

**Dependencies:** Tasks 9, 10 (sign.json / waiver-store stability), 15 (waiver.astro is rewritten there — this task layers the `?workshop=` reading on top). Do this LAST of the API tasks.

- [ ] **`WaiverRecord` context:** add `context: { kind: 'party' | 'workshop' | 'open-studio'; id: string } | null`, keep `partyId` as a legacy-compat field. Normalization helper `contextOf(record)` → `record.context ?? (record.partyId ? { kind: 'party', id: record.partyId } : null)`; new writes set BOTH (`partyId` mirrors `context.id` when kind === 'party', else null) so nothing downstream breaks. **Index keys — be precise, this is where existing data lives:** `indexKeyFor('party', id)` returns the EXISTING `party-index-{id}` (byte-identical to today's `partyIndexKey` — existing party rosters must keep reading their current blobs with zero migration); only NEW kinds (`workshop`, `open-studio`) get the `event-index-{kind}:{id}` namespace. `upsertWaiverInEventIndex(kind, id, record)` and `listWaiversByEvent(kind, id)` both dispatch through `indexKeyFor`; `upsertWaiverInPartyIndex`/`listWaiversByParty` remain as thin party-kind wrappers. Add a test: after Task 16, `listWaiversByParty` still reads an index blob written before Task 16.
- [ ] **`sign.json.ts`:** accept `workshopId` alongside `partyId` (mutually exclusive; both optional) → build `context`. Workshop context skips party-record validation (workshop bookings live in Square) — validate only shape (`/^[\w-]{4,64}$/`).
- [ ] **`waiver.astro`:** read `?workshop=` → pass a `workshopId` prop through (WaiverFlow gains `workshopId?: string`, included in both sign payloads). No attendance checkboxes for workshops (seat-based); the party-only UI stays gated on `partyId`.
- [ ] **Workshop CTA linking:** find where `waiverContent.handoff.workshopCta` renders in the workshop booking confirmation (grep) and append `?workshop={bookingId}` to its `/waiver` href.
- [ ] **`src/lib/events.ts`:**

```ts
/** Uniform event view for staff surfaces. Parties come from the party store;
 *  workshops (Square Classes) and open-studio days plug in here later. */
import { getPartyRecord, listParties } from '@lib/party-store'

export type EventKind = 'party' | 'workshop' | 'open-studio'
export interface StudioEvent {
  kind: EventKind
  id: string
  title: string
  startIso: string
  dropOff: boolean
}

export async function getEvent(kind: EventKind, id: string): Promise<StudioEvent | null> {
  if (kind === 'party') {
    const p = await getPartyRecord(id)
    return p ? { kind, id, title: p.title ?? `${p.craftName} Party`, startIso: p.startIso, dropOff: p.dropOff } : null
  }
  return null // workshop/open-studio resolvers land with those features
}

export async function listEvents(): Promise<StudioEvent[]> {
  const parties = await listParties()
  return parties.map((p) => ({ kind: 'party' as const, id: p.bookingId, title: p.title ?? `${p.craftName} Party`, startIso: p.startIso, dropOff: p.dropOff }))
}
```

  Switch `api/staff/checkin.json.ts`'s `getPartyRecord(party)` dropOff lookup and `api/staff/roster.json.ts`'s party fetch to `getEvent('party', id)` where only `{title,startIso,dropOff}` are needed (roster also needs craftName/hostName/guestCount — keep `getPartyRecord` there and use getEvent only in checkin; don't force it).
- [ ] **Coverage endpoint** `src/pages/api/staff/coverage.json.ts` (staff-authed — the door check for workshops/open studio):

```ts
import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { lookupHouseholdEntry } from '@lib/waiver-store'

export const prerender = false

/** GET ?contact=email-or-phone → { covered, firstName?, validUntil?, kids? } */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const contact = url.searchParams.get('contact')?.trim() ?? ''
  if (!contact) return new Response(JSON.stringify({ error: 'Missing contact' }), { status: 400 })
  const h = await lookupHouseholdEntry(contact)
  const covered = !!h && new Date(h.validUntil).getTime() > Date.now()
  return new Response(
    JSON.stringify({ data: covered
      ? { covered: true, firstName: h!.firstName, validUntil: h!.validUntil, kids: h!.minors.map((m) => m.name.split(' ')[0]) }
      : { covered: false } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
```

- [ ] **Tests:** extend `tests/lib/waiver-store.test.ts` — context normalization (legacy record with only partyId → contextOf yields party context), event index key for workshop kind.
- [ ] **Run:** full suite.
- [ ] **Commit:** `feat(waiver): event context (party/workshop/open-studio), workshop waiver linking, staff coverage check`

---

## Verification (after all tasks)

- [ ] `npx vitest run` — zero failures beyond the 2 pre-existing `square/booking.test.ts` custom-attribute tests (fix them too if trivial, but don't block on them).
- [ ] `npm run build` — clean production build (this also exercises the mock-in-prod guard: build locally with `PROVIDER_MODE=square` set or expect/verify the intentional throw without it — confirm netlify env has PROVIDER_MODE before merging to main).
- [ ] Manual dev pass (`npm run dev`, payment bypass on): book a party end-to-end → confirmation shows no-email variant (Gmail env unset locally) → open host page → RSVP as a guest household with kids-only attendance (responsible-adult required) → staff console: check in, toggle drop-off, ISSUE code (post-toggle), pickup with code, wrong code (denied + still works after), reset guard, search, refresh.
- [ ] Grep gates: `grep -rn "birthday" src/ --include='*.ts' --include='*.tsx' --include='*.astro' | grep -vi 'Birthdays ·\|Birthdays at any age\|Maya'` → review every hit; `grep -rn "dropping off\|drop off" src/components src/config` → only studio-decision copy remains; `grep -rn "Your card was not charged" src/pages/api` → only on provably-uncharged paths.

## Out of scope (explicitly deferred, per Kaden)
- Staff auth hardening beyond current shared passcode ("no problem for now").
- Email-verification loop on lookup (rate limit + reuse token now; revisit once Gmail email is proven in prod).
- Full focus trap in PartyModal; photo-consent per-person granularity; host-editable party title endpoint (worth doing soon — flagged in audit as Major #3 — but not approved in this batch).
