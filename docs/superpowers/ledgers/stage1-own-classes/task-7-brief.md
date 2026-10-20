### Task 7: Order + payment for a class booking

**Files:**
- Modify: `src/providers/interfaces/payment.ts`, `src/providers/square/payment.ts`, `src/providers/mock/payment.ts`
- Test: `tests/providers/square/payment-class-order.test.ts`

**Interfaces:**

```ts
// added to PaymentProvider
createClassOrder(params: {
  locationId: string; customerId: string | null; idempotencyKey: string
  lines: { catalogObjectId: string; quantity: 1; note: string }[]  // one per seat/add-on line
  discount?: { name: string; cents: Cents } // stage 4 promo
  referenceId: string // our bookingId
}): Promise<{ orderId: string; totalCents: number; lineUids: string[] }>
```

Square body: `order: { location_id, customer_id?, reference_id, line_items: [{ catalog_object_id, quantity: '1', note }], pricing_options: { auto_apply_taxes: true } }` and **no** `taxes`. Payment reuses `processPayment` (`amount` = returned `totalCents`; the server compares it with its own quote and refuses to charge when they differ by more than 0 cents, releasing the hold).

- [ ] **Step 1: Failing tests** (mock fetch/SDK): body has pricing_options and no taxes; returns line uids in order; mismatch handling lives in Task 8.
- [ ] **Step 2–4:** run, implement (raw REST, environment-aware base URL), pass.
- [ ] **Step 5: Commit** `feat(payments): class orders from catalog lines with auto-applied tax`.

