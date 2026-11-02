---
name: square-sdk-v44-shapes
description: "Square Node SDK v44 catalog API response shapes — the project uses unwrapping wrong in places, and there's a latent bug in catalog.ts that hasn't bitten yet"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ced43d0-929a-442d-9103-4625987a7953
---

# Square SDK v44 catalog response shapes

The `square@44` Node SDK changed the catalog API surface and response shapes from older versions. This caused `/api/reservations/service-info.json` to 500 on first run-through 2026-05-25.

## The correct v44 API surface

| What you want | OLD (broken) | NEW v44 |
|---|---|---|
| Get one catalog object | `client.catalog.retrieveCatalogObject({...})` | `client.catalog.object.get({ objectId })` |
| Get many by ID | `client.catalog.batchRetrieveCatalogObjects(...)` | `client.catalog.batchGet({ objectIds })` |
| List items | `client.catalog.listCatalog(...)` | `for await (const obj of await client.catalog.list({ types: 'ITEM' }))` |
| `includeRelatedObjects: true` | supported on retrieve | **gone** — must do a separate `batchGet` for modifier list IDs |

## Response shape (the gotcha that cost an hour)

- `client.catalog.object.get(...)` returns **`{ object: {...} }`**, NOT the bare item.
- `client.catalog.batchGet(...)` returns **`{ objects: [...] }`**.
- Always unwrap: `const item = (response?.object ?? response) as any` — the `?? response` is the cheap fallback in case the SDK is updated later.

## Places to copy the pattern

The unwrap fix is applied in three spots; if you add another `object.get` call, mirror it:

- `src/pages/api/reservations/service-info.json.ts` — full pattern (object.get + batchGet for modifier lists)
- `src/providers/square/catalog.ts` — `getAddOns` and `getPricing`

Smoke-tested 2026-05-25 against production Square: `/api/reservations/service-info`, `/api/catalog/add-ons` both return real catalog data; `/api/catalog/pricing` returns a real "variation not found" error for fake IDs (i.e. the unwrap works, code reaches the variation lookup).

`getEventTypes` is fine without the fix because it uses `catalog.list()` async iterator, which has a different shape entirely.

## Related

- [[square-class-bookings]] — different Square pain point (buyer-facing classes API, totally separate code path)
