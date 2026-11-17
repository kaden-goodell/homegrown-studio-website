/**
 * Quotes (kv `quotes`, Postgres: pick, pay, save and withdraw race). Keys:
 *   q-<id>          the quote
 *   t-<token>       → id (the customer's link)
 *   r-<requestId>   → the request's current quote id
 * Written in that order; a missing r- is found again by scanning q- keys, a
 * missing t- means the link reads "no longer available" until the next save.
 * Every quote write runs inside withQuoteLock (the party lock of the party
 * the quote becomes). Server only.
 */
import { randomBytes } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { casRetry } from '@lib/cas-retry'
import { assertClassWritesAllowed } from '@lib/classes/test-site-guard'
import { idFor } from '@lib/booking-core/ids'
import { withPartyLock } from '@lib/parties/party-lock'
import type { Quote } from './types'

const kv = makeKvStore('quotes', 'quotes')

export const newToken = (): string => randomBytes(16).toString('hex')
export const newQuoteId = (): string => `qt_${randomBytes(8).toString('hex')}`
export const partyIdForQuote = (quoteId: string): string => idFor('pty', `quote-${quoteId}`)

const parse = (json: string | null): Quote | null => (json ? (JSON.parse(json) as Quote) : null)

export async function getQuote(id: string): Promise<Quote | null> {
  return parse(await kv.get(`q-${id}`))
}

export async function getQuoteByToken(token: string): Promise<Quote | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null
  const id = await kv.get(`t-${token}`)
  const q = id ? await getQuote(id) : null
  return q && q.token === token ? q : null
}

export async function listQuotes(): Promise<Quote[]> {
  const keys = await kv.list('q-')
  const all = await Promise.all(keys.map((k) => kv.get(k).then(parse)))
  return all.filter((q): q is Quote => q !== null)
}

export async function getQuoteForRequest(requestId: string): Promise<Quote | null> {
  const id = await kv.get(`r-${requestId}`)
  if (id) {
    const q = await getQuote(id)
    if (q) return q
  }
  const mine = (await listQuotes()).filter((q) => q.requestId === requestId)
  mine.sort((a, b) => (a.history[0]?.at ?? '').localeCompare(b.history[0]?.at ?? ''))
  return mine.at(-1) ?? null
}

export async function findQuoteByPartyId(partyId: string): Promise<Quote | null> {
  return (await listQuotes()).find((q) => q.partyId === partyId) ?? null
}

/** Create-only. */
export async function createQuote(q: Quote): Promise<Quote> {
  assertClassWritesAllowed()
  const ok = await kv.setIfMatch(`q-${q.id}`, JSON.stringify(q), null, false)
  if (!ok) throw new Error(`Quote ${q.id} already exists`)
  await kv.set(`t-${q.token}`, q.id)
  await kv.set(`r-${q.requestId}`, q.id)
  return q
}

/** Compare-and-set update; `fn` returning null writes nothing. Re-points the token key. */
export async function updateQuote(id: string, fn: (q: Quote) => Quote | null): Promise<Quote> {
  assertClassWritesAllowed()
  const saved = await casRetry<Quote>(async () => {
    const { value, etag } = await kv.getWithMeta(`q-${id}`)
    const cur = parse(value)
    if (!cur) throw new Error(`Quote ${id} not found`)
    const next = fn(cur)
    if (next === null) return { done: true, value: cur }
    const ok = await kv.setIfMatch(`q-${id}`, JSON.stringify(next), etag, true)
    return ok ? { done: true, value: next } : { done: false }
  })
  if ((await kv.get(`t-${saved.token}`)) !== saved.id) await kv.set(`t-${saved.token}`, saved.id)
  return saved
}

/** Point the request at this quote (a new quote after a withdrawn or expired one). */
export async function pointRequestAt(requestId: string, quoteId: string): Promise<void> {
  await kv.set(`r-${requestId}`, quoteId)
}

/** Runs `fn` holding the lock of the party this quote becomes. */
export function withQuoteLock<T>(q: Pick<Quote, 'partyId'>, fn: () => Promise<T>): Promise<T> {
  return withPartyLock(q.partyId, fn)
}
