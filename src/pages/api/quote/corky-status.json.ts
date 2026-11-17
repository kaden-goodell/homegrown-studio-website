import type { APIRoute } from 'astro'
import { readPaid } from '@lib/quote/corky-visits'
import { createLogger } from '@lib/logger'

/**
 * GET /api/quote/corky-status.json → { paid, night, monogram, paidAt }
 *
 * Whether Jessyca's $1,500 deposit is paid, so /quote/corky-christmas locks
 * her night in on any device and after a reload. No contact details. 503 when
 * the store can't be read (the page then just stays as it is).
 */

export const prerender = false

const logger = createLogger('api:quote:corky-status')

export const GET: APIRoute = async () => {
  try {
    const p = await readPaid()
    return json(p ? { paid: true, night: p.night, monogram: p.monogram === true, paidAt: p.paidAt } : { paid: false, night: null, monogram: false, paidAt: null }, 200)
  } catch (err) {
    logger.warn('Status unreadable', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'unavailable' }, 503)
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
