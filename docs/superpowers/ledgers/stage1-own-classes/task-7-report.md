# Task 7 report
Added `createClassOrder` to PaymentProvider interface, Square provider (raw POST /orders via squareFetch; pricing_options.auto_apply_taxes, no taxes, customer_id omitted when null, note truncated to 500, optional ORDER-scoped FIXED_AMOUNT discount) and Mock provider (`prices` map, 9% via @lib/tax, `classOrderCalls` recorded).
Returns { orderId, totalCents, lineUids, lineTotals } in input order.
Tests: tests/providers/square/payment-class-order.test.ts (6). tsc 0; full suite 3075 passed.

## Fix round 1
Change: request lines carry uid l0,l1,...; response mapped by uid to input index; throws plain Error on missing order.id, line count mismatch, or missing uid.
Tests added: reordered response, short line_items, unknown uid, missing id.
Command: npx vitest run tests/providers/square/payment-class-order.test.ts; npx tsc --noEmit -p .
Output: [2m      Tests [22m [1m[32m8 passed[39m[22m[90m (8)[39m  tsc 0
