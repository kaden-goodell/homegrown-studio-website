import type { APIRoute } from 'astro'
import { timingSafeEqual } from 'node:crypto'
import { guestSeatJobKey, readGuestSeatTicket, runGuestSeat } from '@lib/guest-seat-job'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:jobs:guest-seat')

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

function allowed(request: Request): boolean {
  const secret = env('LOOKUP_SIGNING_SECRET')
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(guestSeatJobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/**
 * One guest seat of an online booking (src/lib/guest-seat-job.ts), called by
 * netlify/functions/guest-seats-background.ts once per seat. Needs the job key
 * AND a ticket the booking route signed. Safe to repeat.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Not allowed' }, 403)
  const body = await request.json().catch(() => ({}))
  const ticket = readGuestSeatTicket(body?.ticket)
  if (!ticket) return json({ error: 'Bad ticket' }, 400)
  const seat = Number(body?.seat)
  try {
    const run = await runGuestSeat(ticket, seat)
    return json(run, run.ok ? 200 : run.kind === 'bad_seat' ? 400 : 409)
  } catch (err) {
    logger.error('Guest seat job failed', { paidBookingId: ticket.paidBookingId, seat, error: err instanceof Error ? err.message : String(err) })
    return json({ ok: false, kind: 'error' }, 500)
  }
}
