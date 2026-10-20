# Task 10 additions (from Task 2 review, binding)
- FIRST: move RefundError, shared messages, refundKey/refundKeyRaw and RefundPlan into src/lib/booking-core/refund-words.ts; classes/refunds re-exports them (no test changes); the runner stops importing classRefundBook.
- Static src/lib/booking-core/refund-books.ts imports the class and party refund books by name and holds claimSquareRefund; an unknown scope throws; square-events imports refund-books directly (never via classes/refunds).
- Party refund book implements EVERY field of the RefundBook interface (kind, logTag, unreachable, current, describe, canEmail, auditCheck, …); comment refundBookFor that scope-only writers can't plan.
- Webhook path passes the class name from its list (old order); keep one scoped getByRole per distinct element in the sped-up sheet tests.
