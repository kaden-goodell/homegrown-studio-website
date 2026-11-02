/**
 * Work that should run after the reply is sent (stage 4 waitlist, M7): a
 * class save that raised capacity, or a refund that freed a seat, must not
 * wait for up to three saved-card charges. The middleware runs every request
 * inside `withAfterReply`, carrying Netlify's `waitUntil`; `afterReply(work)`
 * hands the work to it. With no `waitUntil` (tests, a local dev server, a
 * scheduled job) the work is simply awaited, so nothing is ever dropped.
 *
 * Server only.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

type WaitUntil = (p: Promise<unknown>) => void
const store = new AsyncLocalStorage<{ waitUntil: WaitUntil | null }>()

/** The `waitUntil` Netlify puts on Astro's locals, if any. */
export function waitUntilOf(locals: unknown): WaitUntil | null {
  const ctx = (locals as { netlify?: { context?: { waitUntil?: WaitUntil } } } | undefined)?.netlify?.context
  return typeof ctx?.waitUntil === 'function' ? ctx.waitUntil.bind(ctx) : null
}

/** Runs `fn` with `waitUntil` available to afterReply (the middleware wraps each request). */
export function withAfterReply<T>(waitUntil: WaitUntil | null, fn: () => T): T {
  return store.run({ waitUntil }, fn)
}

/**
 * Runs `work` after the reply when the platform allows it, otherwise now.
 * Never throws: a failure is the work's own business (it logs).
 */
export async function afterReply(work: () => Promise<unknown>): Promise<void> {
  const waitUntil = store.getStore()?.waitUntil ?? null
  const p = Promise.resolve().then(work).catch(() => undefined)
  if (waitUntil) waitUntil(p)
  else await p
}
