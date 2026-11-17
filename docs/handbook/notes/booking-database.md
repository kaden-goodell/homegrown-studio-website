# The booking database (Postgres on Neon)

Since 16 Nov 2026 the own booking system keeps its race-critical records in
Postgres, not Netlify Blobs.

## Why

Two booking requests on two servers at the same instant could BOTH be told
"saved" by Netlify Blobs' "write only if unchanged" (`onlyIfMatch` /
`onlyIfNew`). Reproduced against real Netlify: 4 of 12 races on our party hold
code, 1 of 16 on Netlify's newest client. The sandbox run caught it as two
parties booked into one time (scenario 26). In Postgres the same check is one
statement (`UPDATE … WHERE version = $n`, `INSERT … ON CONFLICT DO NOTHING`);
the database locks the row, so exactly one wins.

## What lives where

- **Postgres, table `kv_store`** (one row per store + key; `version` replaces
  the blob etag): the stores listed in `src/lib/db/pg-stores.ts`: seat-ledger,
  party-book, party-locks, party-checkouts, party-payments, waitlists,
  refund-requests, promo-uses, class-cancels, reader-orders, reader-sales,
  paid-not-seated, paid-on-cancelled, refund-flags, refund-replacements.
- **Netlify Blobs**: everything else (classes, settings, waivers, RSVPs,
  incidents, party records, shop, staff…), unchanged.
- **Display copies** (`<store>-snapshot` blobs): every Postgres write also
  copies the record there. Public pages (seats left, open party times, the
  half-hourly sign-up emails) and the 10-minute waitlist sweep's first look
  read these copies, so page views don't wake the database. They can be a
  moment old; a booking, hold, charge or refund always reads Postgres. A copy
  older than 10 minutes (`SNAPSHOT_MAX_AGE_MS`) is re-read from Postgres on the
  next public read and refreshed, at most once per record per 10 minutes per
  server; if Postgres is down the old copy is shown (and logged), never an
  error page.

The code is `src/lib/db/` (client + the Postgres store) and the router in
`makeKvStore` (`src/lib/blob-store.ts`). Modules didn't change: their
read-modify-write loops were right; the write underneath now really is atomic.

## Settings

- `DATABASE_URL` (Netlify env, per context). Neon project `hometown-bookings`:
  branch `preview` for `branch:kaden/own-booking-system`; production gets its
  own branch at switch-on. Never in the repo.
- On a Netlify deploy with no `DATABASE_URL`, those stores refuse every read
  and write (bookings refused, never taken unguarded) and Kaden gets a text.
- Off Netlify (local dev, the test suite) with no `DATABASE_URL`, they use the
  `.data/` files as before.

## Commands (read the URL from Netlify; never print or save it)

```
U="$(npx netlify env:get DATABASE_URL --context <context>)"
DATABASE_URL="$U" npx tsx scripts/db-migrate.ts            # apply db/migrations (safe to repeat)
DATABASE_URL="$U" … npx tsx scripts/db-import-from-blobs.ts [--write]   # one-time copy, see its header
DATABASE_URL="$U" npx tsx scripts/db-race-test.ts --i-know-this-is-preview --rounds 200   # preview only
```

## Switch-on checklist additions

1. Kaden creates the production branch in Neon and sets `DATABASE_URL` for the
   production context.
2. `db-migrate.ts` against it.
3. `db-import-from-blobs.ts` (production's stores for the new system are empty
   today, so it copies nothing; run the dry run to confirm).
4. Deploy.

## Cost and limits to watch

Neon free plan: the database sleeps after 5 idle minutes. What wakes it:
bookings, owner and staff screens, the hourly crew/price jobs, the nightly
checks, a waitlist that has work. Public page views and the robot customer
don't. Check Neon's usage page after the first week.
