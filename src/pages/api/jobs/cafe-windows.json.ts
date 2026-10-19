import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { rollCafeWindows } from '@lib/cafe-roll'

export const prerender = false

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** The key the scheduled function sends: made from a secret only the site holds (as the other jobs). */
export function cafeWindowsJobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:cafe-windows').digest('hex')
}

function allowed(request: Request): boolean {
  const secret = env('LOOKUP_SIGNING_SECRET')
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(cafeWindowsJobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/**
 * Run each night by netlify/functions/cafe-windows.ts (R38): roll Craft
 * Café's windows in Square forward from the owners' saved settings. Writes
 * only when they differ from Square's, only on the live site.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Unauthorized' }, 401)
  const r = await rollCafeWindows(new Date(), { request })
  return json({ data: r }, 200)
}
