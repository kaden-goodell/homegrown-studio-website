import type { APIRoute } from 'astro'
import { ackIncident } from '@lib/booking-alarms'

export const prerender = false

const page = (title: string, line: string, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="font-family:-apple-system,system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#3d3630">` +
      `<h1 style="font-size:1.4rem">${title}</h1><p>${line}</p></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )

/**
 * The "Got it" link at the end of an alert text: stops the repeats for that
 * problem. It still counts new failures and sends one note an hour if they
 * keep coming. The link is signed per problem, so it can't silence another one.
 */
export const GET: APIRoute = async ({ url }) => {
  const key = url.searchParams.get('k') ?? ''
  const sig = url.searchParams.get('s') ?? ''
  if (!key || !sig) return page('Link not complete', 'Open the link from the text again.', 400)
  const ok = await ackIncident(key, sig)
  return ok
    ? page('Got it', 'No more repeats for this one. If it keeps happening you’ll get one text an hour, and a “Fixed” text when it clears.')
    : page('Nothing to stop', 'That problem has already cleared, or the link is from an older one.')
}
