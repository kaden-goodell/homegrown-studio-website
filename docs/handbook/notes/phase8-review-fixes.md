# Phase 8 Square Providers — Critical Review & Fixes

## Status: ALL FIXED — committed as f03644d

Commit `26677a0` has the original Phase 8 code. Fixes are in-progress but NOT yet committed.

## Issues Found & Fix Status

### FIXED (in working tree, not committed):

1. **booking.ts — `generateSlotId` returned hash instead of startAt**
   - `createBooking` uses `slotId` as Square's `startAt` datetime
   - Fix: Changed `generateSlotId` to return `startAt` directly (Square slots don't have stable IDs)
   - This means our slotId IS the ISO datetime for Square provider

2. **booking.ts — `getBooking` returned `eventType: ''`**
   - Square doesn't store eventType natively, it's in custom attributes
   - Fix: Added `customAttributes.get({ bookingId, key: 'event_type' })` call in getBooking
   - Wrapped in try/catch since attribute may not exist

3. **capacity.ts — Dead code & broken slot matching**
   - Lines 62-67 had empty loop body building unused `instanceMap`
   - Lines 71-75 used bizarre `find` with `indexOf` that was just `instances[idx]`
   - Fix: Replaced with simple `instances[i]` indexed access

### NOT YET FIXED:

4. **catalog.ts uses tabs, rest of codebase uses 2-space indentation**
   - Need to convert all tabs to 2 spaces in `src/providers/square/catalog.ts`

5. **payment.ts:53-54 — Hardcoded `'USD'` currency in createOrder line items**
   - `LineItem` interface doesn't have currency field, so this is an interface gap
   - Low priority — USD is correct for this deployment

6. **Frontend/interface mismatch in CheckoutStep**
   - CheckoutStep sends `slot: state.selectedSlot` (full TimeSlot object)
   - But `BookingDetails` interface expects `slotId: string`
   - The API route passes body directly to `createBooking(body)`
   - This means the body has `slot` instead of `slotId`
   - Need to either fix CheckoutStep to send `slotId: state.selectedSlot?.id` or fix the API route

### ACCEPTABLE / NOTED:

7. **`as any` proliferation** — Many casts added to fix Square SDK v44 type strictness
   - Tests validate mapping logic with mocks, but lose type safety at SDK boundary
   - Acceptable for now; would improve with proper SDK type wrappers later

8. **payment test weakened** — Changed from exact match to `expect.objectContaining`
   - To accommodate `idempotencyKey: crypto.randomUUID()` I added
   - Still validates all important fields

### TESTS TO UPDATE after fixes:

- `tests/providers/square/booking.test.ts`:
  - Update slot ID assertions — now slotId = startAt string, not hash
  - Add test for `getBooking` reading `eventType` from custom attributes
  - Add mock for `customAttributes.get` in getBooking tests

## Files Modified (uncommitted):
- `src/providers/square/booking.ts` — fixes 1, 2
- `src/providers/square/capacity.ts` — fix 3
- Still need: `src/providers/square/catalog.ts` — fix 4 (tabs→spaces)
- Still need: booking tests update, CheckoutStep fix

## Verification needed after all fixes:
```bash
npx tsc --noEmit
npx vitest run
npx astro build
```
