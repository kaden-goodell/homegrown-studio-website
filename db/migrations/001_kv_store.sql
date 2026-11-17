-- The race-critical records of the own booking system (seat ledger, party
-- times, waitlists, refund requests, promo uses, cancels, locks, party
-- payments/checkouts, card-reader sales, Square refund bookkeeping).
--
-- Why Postgres (Kaden, 16 Nov 2026): Netlify Blobs' "write only if unchanged"
-- (onlyIfMatch / onlyIfNew) let two simultaneous writes from two servers BOTH
-- succeed (reproduced 1 in 16 to 4 in 12 races). Here the compare-and-set is a
-- single UPDATE ... WHERE version = $n (or INSERT ... ON CONFLICT DO NOTHING):
-- Postgres takes the row lock, so exactly one of two racing writers wins.
--
-- One row per (store, key). `store` is the namespaced store name (preview
-- deploys carry STORE_NAMESPACE), `value` the same JSON text the blob held,
-- `version` the compare-and-set token (it replaces the blob etag).
CREATE TABLE IF NOT EXISTS kv_store (
  store      text        NOT NULL,
  key        text        NOT NULL,
  value      text        NOT NULL,
  version    bigint      NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store, key)
);
