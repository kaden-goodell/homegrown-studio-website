import type { APIRoute } from 'astro'

export const prerender = false

/**
 * Answers the keep-warm knock (netlify/functions/keep-warm.ts). Touches
 * nothing — no Square, no stores — it only keeps the page server awake so a
 * real visitor isn't the one who waits for it to start.
 */
export const GET: APIRoute = () =>
  new Response('{"ok":true}', {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
