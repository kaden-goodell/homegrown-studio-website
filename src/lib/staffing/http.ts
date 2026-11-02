/**
 * One way every staffing route answers (stage 3): `{ data, warning? }` on
 * success; on a refusal `{ error }` with a sentence a person can act on.
 *   StaleError          → 409 `{ error, stale: true, current }` (show what is saved now)
 *   StaffingError       → its status
 *   TestSiteStoreError  → 503 with the plain R41 sentence (a test site with no store of its own)
 *   anything else       → 503 "We couldn't reach the staffing records. Try again." (logged)
 * Server only.
 */
import { createLogger } from '@lib/logger'
import { TestSiteStoreError } from '@lib/classes/test-site-guard'
import { StaffingError, StaleError } from './errors'

const logger = createLogger('api:staffing')

export const STORE_DOWN = "We couldn't reach the staffing records. Try again."

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })

export async function staffingReply(fn: () => Promise<{ data: unknown; warning?: string }>): Promise<Response> {
  try {
    const { data, warning } = await fn()
    return json(200, { data, ...(warning ? { warning } : {}) })
  } catch (e) {
    return staffingFailure(e)
  }
}

export function staffingFailure(e: unknown): Response {
  if (e instanceof StaleError) return json(409, { error: e.message, stale: true, current: e.current })
  if (e instanceof StaffingError) return json(e.status, { error: e.message })
  if (e instanceof TestSiteStoreError) return json(503, { error: e.message })
  logger.error('Staffing request failed', { error: e instanceof Error ? e.message : String(e) })
  return json(503, { error: STORE_DOWN })
}
