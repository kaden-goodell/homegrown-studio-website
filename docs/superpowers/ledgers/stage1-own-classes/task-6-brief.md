### Task 6: Square catalog sync (POS items) and sandbox seed

**Files:**
- Create: `src/lib/classes/square-catalog.ts`
- Create: `scripts/seed-sandbox.ts` (sandbox only: refuses unless `SQUARE_ENVIRONMENT=sandbox`)
- Modify: `src/config/site.config.ts` — add `square.classesCategoryId` and `square.classTaxId` read from env `SQUARE_CLASSES_CATEGORY_ID`, `SQUARE_CLASS_TAX_ID` (prod values set by Kaden later; sandbox values set by the seed script's printed commands)
- Test: `tests/lib/classes/square-catalog.test.ts`

**Interfaces:**

```ts
export function variationPlan(cls: ScheduledClass): { key: string; name: string; cents: Cents }[] // seat cells + add-ons
export async function syncClassToSquare(cls: ScheduledClass): Promise<ScheduledClass['square']> // upsert ITEM (REGULAR) in Classes category, tax_ids [classTaxId] when taxable, one variation per plan key, item name `${content.name} · ${first session date label}`; removes variations no longer in the plan; uploads image when imageUrl changed (CreateCatalogImage via fetch of imageUrl)
export async function archiveClassInSquare(cls: ScheduledClass): Promise<void> // marks variations sold out / item hidden from POS (visibility PRIVATE / available_for_pickup false; never deletes — past orders reference it)
export function classIdFromVariation(variationId: string, classes: ScheduledClass[]): { classId: string; key: string } | null
```

Use raw REST `POST /v2/catalog/batch-upsert` (Square-Version 2025-01-23) as `scripts/create-class.ts` does, with the client's base URL chosen by environment (sandbox → `connect.squareupsandbox.com`).

- [ ] **Step 1: Failing tests** with mocked `fetch`: plan has one variation per filled cell + add-on; request body shape (product_type REGULAR, category, tax ids only when taxable, prices); re-sync keeps existing variation ids by key and drops removed ones; non-2xx throws a plain error; `classIdFromVariation` finds and misses.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5:** Write `scripts/seed-sandbox.ts`: ensure a "Classes" category and a 9% "Sales tax" (`applies_to_custom_amounts: true`, inclusion ADDITIVE) exist in the sandbox; print the two ids and the exact `! npx netlify env:set … --context branch:kaden/own-booking-system` lines for Kaden (they are not secrets; the agent may set these two itself).
- [ ] **Step 6: Commit** `feat(classes): Square catalog sync for POS items; sandbox seed script`.

