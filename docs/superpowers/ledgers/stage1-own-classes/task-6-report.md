# Task 6 report — Square catalog sync (POS items) and sandbox seed

Status: DONE. Commit 093cefd `feat(classes): Square catalog sync for POS items; sandbox seed route` on kaden/own-booking-system (not pushed).

## Files
- `src/lib/classes/square-api.ts` (new, R13): `SQUARE_API_VERSION = '2026-01-22'`, `squareBaseUrl(env)`, `squareSettings()` (reads `siteConfig.providers.catalog.config` at call time), `squareFetch(path, init)` — Bearer token, Square-Version, JSON content type (skipped for FormData), throws plain `Error("Square said: <first detail>")` or `"Square answered with an error (<status>)."`, with `status` attached (used to treat 404 as "item gone").
- `src/lib/classes/square-catalog.ts` (new): `variationPlan`, `syncClassToSquare`, `archiveClassInSquare`, `classIdFromVariation`.
- `src/pages/api/admin/classes/seed-sandbox.json.ts` (new, R12; replaces the brief's scripts/seed-sandbox.ts): POST, `adminAuthorized` → 401; environment !== 'sandbox' → 409; lists CATEGORY,TAX (paged), creates only the missing "Classes" category / "Sales tax" (percentage '9', ADDITIVE, TAX_SUBTOTAL_PHASE, applies_to_custom_amounts, enabled) in one batch-upsert; returns `{ data: { classesCategoryId, classTaxId, commands: [2 netlify env:set lines, --context branch:kaden/own-booking-system] } }`. Square errors → 502 with the plain message.
- `src/config/site.config.ts`: `SquareConfig.classesCategoryId?` / `classTaxId?` (optional in the interface to avoid churn), filled from `SQUARE_CLASSES_CATEGORY_ID` / `SQUARE_CLASS_TAX_ID` ('' when unset).
- `src/lib/classes/types.ts`: `ScheduledClass.square.imageUrl?: string | null`.

## Behaviour
- Plan: one variation per sellable cell (`sellableCells` order) keyed `${passId}:${ticketTypeId}`, then `addon:${id}` — same keys as pricing.ts. Names "<Pass> · <Ticket>", or just "<Ticket>" when the class has exactly one pass (I read "single pass called the default" as "only one pass"); add-ons "<Label> (add-on)".
- Sync: throws "Classes category isn't set up yet." before any call when the category id is empty. If `itemId` is set, GETs `/catalog/object/{id}` for versions and existing variations (404 → builds a fresh item with temp ids). One batch-upsert: ITEM, product_type REGULAR, name "<name> · Sat Oct 17" (first session, Chicago, via formatDay minus comma), categories + reporting_category = classes category, `tax_ids: [classTaxId]` only when taxable AND a tax id is set, keeps existing `image_ids`, present_at_all_locations true, variations FIXED_PRICING with `price_money.amount` as a number of cents, reusing ids+versions by key; temp ids `#v<i>` mapped from `id_mappings`. Dropped keys are simply left out of the item's variations list and out of the returned map.
- Image: uploaded (multipart POST /catalog/images, `object_id` = item, `is_primary: true`; relative URLs resolved against siteConfig.url) only when `content.imageUrl` differs from `square.imageUrl`. An image failure only `console.warn`s — the item ids are still returned (so no duplicate item next save) and `imageUrl` stays old so the next save retries.
- Archive: GETs the item and upserts it back with `present_at_all_locations: false, present_at_location_ids: []` on the item and every variation (absent_at_location_ids dropped). Never deletes. No-op when there's no itemId or the item is gone.
- `classIdFromVariation`: linear scan of `square.variations`.

## Tests
- `tests/lib/classes/square-catalog.test.ts` (16) and `tests/api/admin-classes-seed-sandbox.test.ts` (4), all on mocked global fetch + mocked site config. Cover: base URL / version header / auth, plain errors, plan keys and names, exact create body, tax rules (non-taxable, unset tax id), unset category refusal, id+version reuse and dropped variation on re-sync, gone item → fresh create, image upload once and skipped on same URL, image failure tolerance, archive body (no deletes), classIdFromVariation hit/miss, seed auth 401, production 409, create-once idempotency, add-only-missing.
- `npx tsc --noEmit -p .` = 0. Full suite: 248 files, 3064 tests passed.

## Concerns (not verified against a live sandbox — no live calls were made)
1. Dropped variations rely on Square's documented rule that upserting an ITEM whose `variations` list omits an existing variation removes it. No separate batch-delete is sent. Worth one check in the sandbox.
2. Archive round-trips the retrieved item object (includes read-only fields such as updated_at / is_deleted); Square normally ignores these on upsert, but confirm in the sandbox.
3. Upsert idempotency keys are random UUIDs, so a network failure after Square created a NEW item and a retry could create a second item. Low risk; a deterministic key would need a stable body.
4. Re-sync with an emptied description sends no description (JSON drops undefined), so Square keeps the old one.
5. The seed route matches existing category/tax by name only (case-insensitive), per the ruling; an existing "Sales tax" with a different percentage would be reused.

## Fix round 1

Commit: see `git log` (fix(classes): a retried POS create never makes a second item; ...).

Changes in `src/lib/classes/square-catalog.ts`:
1. No second POS item. (a) The create path (no current item) uses a deterministic idempotency key `cls-create:${cls.id}:${sha256(JSON.stringify(itemObject)).slice(0,32)}` (61 chars); updates keep a random key. (b) Every variation now carries `sku: cls.id`. When the class has no itemId (or its item is gone), sync first POSTs `/catalog/search` `{ object_types: ['ITEM_VARIATION'], query: { exact_query: { attribute_name: 'sku', attribute_value: cls.id } } }`; if a variation is found, its item is fetched and adopted (upserted with its id/version, never created again). The adopted item's variations are matched to our keys by variation name (names are derived deterministically from the plan); unmatched ones get new ids and stale ones are dropped.
2. A class with status 'cancelled' syncs with `present_at_all_locations: false, present_at_location_ids: []` on the item and every variation.
3. `description` is always sent ('' when empty) so Square clears it.
4. An empty plan throws "Add a price before putting this class on the POS." before any network call.

Tests (`tests/lib/classes/square-catalog.test.ts`, now 21): existing tests updated for the search-before-create call; new: deterministic key (same on retry, ≤128, changes when the body changes) + sku marker on every variation; search body and adoption of a found item (id/version reused, ids matched by name, new cell gets a fresh id); cancelled sync is off the POS; empty description sent as ''; empty plan refused with zero fetch calls.

Command: `npx vitest run tests/lib/classes/square-catalog.test.ts tests/api/admin-classes-seed-sandbox.test.ts` → 2 files, 25 tests passed. `npx tsc --noEmit -p .` → exit 0.

Remaining notes: the search-by-sku relies on Square indexing a new variation's sku promptly (search is eventually consistent); the deterministic key covers the immediate-retry window. Sku is visible in the POS as the variation's SKU (the class id).
