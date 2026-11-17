/**
 * A KvStore whose compare-and-set Postgres guarantees (see
 * db/migrations/001_kv_store.sql for why). Same interface as the blob store,
 * so the modules' read-modify-write loops are unchanged; what changes is that
 * `setIfMatch` is now one atomic statement:
 *
 *   etag (the row's version) → UPDATE … WHERE version = $etag RETURNING version
 *   no etag, key not there   → INSERT … ON CONFLICT DO NOTHING RETURNING version
 *
 * Postgres locks the row, so of two simultaneous writers exactly one gets a
 * row back; the other gets none (false) and its loop re-reads and re-decides.
 *
 * Snapshots, so public pages don't wake the database: after every write the
 * new value is also copied to a blob ("<store>-snapshot"). `getSnapshot` and
 * `listSnapshot` read those copies, for display only (seats left, open party
 * times, "is there any waitlist work"). They can be a moment old. Everything
 * that decides (a booking, a hold, a charge, a refund) reads Postgres.
 *
 * Without a database: off Netlify (local dev, the test suite) this falls back
 * to the plain blob/file store, exactly as before; on a Netlify deploy every
 * call throws (fail closed) and Kaden is alarmed once per server per 10 min.
 *
 * Server only.
 */
import type { KvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import { databaseConfigured, db, DatabaseUnavailableError, onNetlify } from './client'

export interface SnapshotKvStore extends KvStore {
  /** Display-only read (may be a moment old): the snapshot copy, else the database. */
  getSnapshot(key: string): Promise<string | null>
  /** Display-only key list (may be a moment old). */
  listSnapshot(prefix?: string): Promise<string[]>
}

const ALARM_EVERY_MS = 10 * 60_000
let lastAlarmAt = 0

async function alarmNoDatabase(why: string): Promise<void> {
  const now = Date.now()
  if (now - lastAlarmAt < ALARM_EVERY_MS) return
  lastAlarmAt = now
  try {
    const { alarmKaden } = await import('@lib/kaden-alarm')
    await alarmKaden(
      'db:unavailable',
      `BOOKINGS REFUSED: the booking database isn't answering (${why.slice(0, 120)}). Seats, party times, waitlists and refunds are refused until it's back. Check DATABASE_URL in Netlify and Neon.`,
      { autoResolve: true },
    )
  } catch {
    /* an alarm must never make it worse */
  }
}

/** LIKE pattern for "starts with prefix", with %, _ and \ escaped. */
function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/**
 * @param tableName the namespaced store name (the `store` column), worked out when first used
 * @param label     the plain store name, for logs
 * @param blob    the plain blob store of the same name (used only without a database, off Netlify)
 * @param mirror  the "<store>-snapshot" blob store for display reads
 */
export function makePgKvStore(tableName: () => string, label: string, blob: KvStore, mirror: KvStore): SnapshotKvStore {
  const logger = createLogger(`pg:${label}`)

  /** The database's query function, or null = use the blob store (off Netlify only). Throws on a deploy with none. */
  function q() {
    if (databaseConfigured()) return db()
    if (onNetlify()) {
      void alarmNoDatabase('DATABASE_URL is not set')
      throw new DatabaseUnavailableError(`No database for "${label}" on this deploy (DATABASE_URL is not set); refusing`)
    }
    return null
  }

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof DatabaseUnavailableError) {
        logger.error('DATABASE UNAVAILABLE — refusing', { error: err.message })
        void alarmNoDatabase(err.message)
      }
      throw err
    }
  }

  /** Best effort: keep the display copy in step. Never fails the write it follows. */
  async function mirrorWrite(key: string, version: number, value: string | null): Promise<void> {
    try {
      if (value === null) {
        await mirror.delete(key)
        return
      }
      const cur = await mirror.get(key)
      if (cur) {
        const v = Number((JSON.parse(cur) as { v?: number }).v)
        if (Number.isFinite(v) && v > version) return // a newer copy is already there
      }
      await mirror.set(key, JSON.stringify({ v: version, value }))
    } catch (err) {
      logger.warn('Snapshot copy not updated (display may lag until the next write)', { key, error: String(err) })
    }
  }

  const store: SnapshotKvStore = {
    async get(key) {
      const query = q()
      if (!query) return blob.get(key)
      return run(async () => {
        const rows = await query('SELECT value FROM kv_store WHERE store = $1 AND key = $2', [tableName(), key])
        return rows.length ? String(rows[0].value) : null
      })
    },

    async getWithMeta(key) {
      const query = q()
      if (!query) return blob.getWithMeta(key)
      return run(async () => {
        const rows = await query('SELECT value, version FROM kv_store WHERE store = $1 AND key = $2', [tableName(), key])
        return rows.length ? { value: String(rows[0].value), etag: String(rows[0].version) } : { value: null, etag: null }
      })
    },

    async setIfMatch(key, json, etag, exists) {
      const query = q()
      if (!query) return blob.setIfMatch(key, json, etag, exists)
      return run(async () => {
        let rows
        if (etag !== null) {
          rows = await query(
            'UPDATE kv_store SET value = $3, version = version + 1, updated_at = now() WHERE store = $1 AND key = $2 AND version = $4 RETURNING version',
            [tableName(), key, json, etag],
          )
        } else if (!exists) {
          rows = await query(
            'INSERT INTO kv_store (store, key, value, version) VALUES ($1, $2, $3, 1) ON CONFLICT (store, key) DO NOTHING RETURNING version',
            [tableName(), key, json],
          )
        } else {
          // A value with no version can't come from this store: refuse rather than write blind.
          logger.error('setIfMatch called with a value but no version — refusing', { key })
          return false
        }
        if (!rows.length) return false
        await mirrorWrite(key, Number(rows[0].version), json)
        return true
      })
    },

    async set(key, json) {
      const query = q()
      if (!query) return blob.set(key, json)
      await run(async () => {
        const rows = await query(
          'INSERT INTO kv_store (store, key, value, version) VALUES ($1, $2, $3, 1) ON CONFLICT (store, key) DO UPDATE SET value = EXCLUDED.value, version = kv_store.version + 1, updated_at = now() RETURNING version',
          [tableName(), key, json],
        )
        await mirrorWrite(key, Number(rows[0]?.version ?? 0), json)
      })
    },

    async list(prefix) {
      const query = q()
      if (!query) return blob.list(prefix)
      return run(async () => {
        const rows = prefix
          ? await query("SELECT key FROM kv_store WHERE store = $1 AND key LIKE $2 ESCAPE '\\' ORDER BY key", [tableName(), likePrefix(prefix)])
          : await query('SELECT key FROM kv_store WHERE store = $1 ORDER BY key', [tableName()])
        return rows.map((r) => String(r.key))
      })
    },

    async delete(key) {
      const query = q()
      if (!query) return blob.delete(key)
      await run(async () => {
        await query('DELETE FROM kv_store WHERE store = $1 AND key = $2', [tableName(), key])
        await mirrorWrite(key, Number.MAX_SAFE_INTEGER, null)
      })
    },

    async getSnapshot(key) {
      if (!databaseConfigured() && !onNetlify()) return blob.get(key)
      try {
        const copy = await mirror.get(key)
        if (copy) return (JSON.parse(copy) as { value: string }).value
      } catch (err) {
        logger.warn('Snapshot unreadable — reading the database', { key, error: String(err) })
      }
      // No copy yet (first read, or the store was imported): read the database once and copy it.
      const { value, etag } = await store.getWithMeta(key)
      if (value !== null && etag !== null) await mirrorWrite(key, Number(etag), value)
      return value
    },

    async listSnapshot(prefix) {
      if (!databaseConfigured() && !onNetlify()) return blob.list(prefix)
      return mirror.list(prefix)
    },
  }
  return store
}
