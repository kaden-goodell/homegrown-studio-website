/**
 * Resolves the deploy context from the very first request a function
 * instance serves, so request-less code (the blob-backed stores deciding
 * whether simulated records are visible) never sees a cold 'unknown' on a
 * Netlify preview that lacks the runtime global. See src/lib/deploy-context.ts.
 *
 * Plain `MiddlewareHandler` rather than `defineMiddleware` from
 * `astro:middleware`: that virtual module doesn't resolve under vitest.
 */
import type { MiddlewareHandler } from 'astro'
import { deployContext } from '@lib/deploy-context'
import { waitUntilOf, withAfterReply } from '@lib/after-reply'

export const onRequest: MiddlewareHandler = (context, next) => {
  deployContext(context.request)
  // Stage 4 (M7): lets library code hand slow follow-up work (a waitlist run) to Netlify's waitUntil.
  return withAfterReply(waitUntilOf(context.locals), () => next())
}
