/**
 * The one Postgres connection for the own booking system's race-critical
 * records (see db/migrations and src/lib/db/pg-kv.ts).
 *
 * Neon's HTTP driver (@neondatabase/serverless `neon()`): every statement is
 * its own request, so a Netlify function never holds a connection open and
 * none can leak. Every write here is ONE atomic statement (a conditional
 * UPDATE / INSERT ... ON CONFLICT), so no multi-statement transaction is
 * needed for correctness: Postgres' row lock decides which writer wins.
 *
 * DATABASE_URL comes from the site's settings (Kaden sets it; never in code).
 * With no URL: off Netlify (local dev, tests) the stores keep their files; ON
 * a Netlify deploy every race-critical read and write fails (closed): a
 * booking is refused, never taken without the guard.
 *
 * Server only.
 */
import { neon } from '@neondatabase/serverless'

export type Row = Record<string, unknown>
/** Runs one parameterised statement and returns its rows. */
export type Query = (text: string, params?: unknown[]) => Promise<Row[]>

export class DatabaseUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseUnavailableError'
  }
}

/** How long one statement may take before it's given up on (throws). */
export const STATEMENT_TIMEOUT_MS = 8_000

let injected: Query | null = null
let cachedUrl = ''
let cachedQuery: Query | null = null

function env(name: string): string {
  return (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** True on a deployed Netlify build or function. */
export function onNetlify(): boolean {
  return env('NETLIFY') === 'true' && env('NETLIFY_DEV') !== 'true'
}

/** Is there a database to talk to (a URL, or a test's injected one)? */
export function databaseConfigured(): boolean {
  return injected !== null || env('DATABASE_URL') !== ''
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DatabaseUnavailableError(`Database didn't answer within ${ms} ms`)), ms)
  })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}

/** The query function, or a DatabaseUnavailableError when there is none. */
export function db(): Query {
  if (injected) return injected
  const url = env('DATABASE_URL')
  if (!url) throw new DatabaseUnavailableError('DATABASE_URL is not set')
  if (url !== cachedUrl || !cachedQuery) {
    const sql = neon(url)
    cachedUrl = url
    cachedQuery = async (text, params = []) => {
      try {
        return (await withTimeout(sql.query(text, params as any[]), STATEMENT_TIMEOUT_MS)) as Row[]
      } catch (err) {
        if (err instanceof DatabaseUnavailableError) throw err
        // Postgres errors carry a code; anything else (network, DNS, auth) is "unavailable".
        if ((err as { code?: string })?.code && /^[0-9A-Z]{5}$/.test(String((err as { code?: string }).code))) throw err
        throw new DatabaseUnavailableError(err instanceof Error ? err.message : String(err))
      }
    }
  }
  return cachedQuery
}

/** Tests (and the race/import scripts): use this query function instead of DATABASE_URL. null = back to normal. */
export function _setDatabaseForTests(q: Query | null): void {
  injected = q
}
