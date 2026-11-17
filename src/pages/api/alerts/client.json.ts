import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { alertsLiveFor, raiseIncident } from '@lib/booking-alarms'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:alerts:client')

/** What a booking pop-up can report. Anything else is ignored. */
export const CLIENT_PROBLEMS = {
  payment_form: 'The card form would not load',
  booking_network: 'The booking request never reached the site (or got no answer)',
  booking_bad_answer: 'The booking request got a broken answer (not from our code)',
  crash: 'The booking pop-up crashed',
} as const
export type ClientProblem = keyof typeof CLIENT_PROBLEMS

const KINDS = new Set(['class', 'party', 'shop', 'kit'])
const quiet = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })

/** Error text from browser add-ons and other sites' scripts, not our booking code. */
export function isNoise(detail: string): boolean {
  return /chrome-extension:|moz-extension:|safari-extension:|safari-web-extension:|iabjs:|Script error\.?$|ResizeObserver loop|instagram|fbq|webkit-masked-url/i.test(detail)
}

/**
 * A booking pop-up tells us it broke on the customer's phone: the payment form
 * didn't load, the booking request never got an answer, or the pop-up
 * crashed. The server never sees those, so the page has to say so. One
 * incident per kind and problem (a storm is one text with a count).
 * Small, rate-limited, and nothing about the customer beyond what they chose.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`client-alert:${clientAddress}`, 3, 10 * 60_000)) return quiet()
  const raw = await request.text().catch(() => '')
  if (raw.length > 2000) return quiet()
  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return quiet()
  }
  const problem = String(body?.problem ?? '') as ClientProblem
  const kind = String(body?.kind ?? '')
  if (!(problem in CLIENT_PROBLEMS) || !KINDS.has(kind)) return quiet()
  const detail = String(body?.detail ?? '').replace(/\s+/g, ' ').slice(0, 160)
  if (isNoise(detail)) return quiet()
  const page = String(body?.page ?? '').slice(0, 80)
  logger.error('Booking broke in a browser', { kind, problem, detail, page })
  if (!alertsLiveFor(request.url)) return quiet()
  await raiseIncident({
    key: `booking:${kind}:browser-${problem}`,
    text: `BOOKING BROKE on a customer's phone (${kind}): ${CLIENT_PROBLEMS[problem]}.${detail ? ` "${detail}"` : ''}${page ? ` Page: ${page}.` : ''} They could not book. Nothing was charged by this step.`,
    urgent: true,
    autoResolve: true,
  })
  return quiet()
}
