/**
 * Wraps a booking endpoint so a failure on OUR side texts Kaden at once
 * (src/lib/booking-alarms.ts). Card declines, typos, sold-out classes, taken party
 * times and closed booking all answer 4xx and stay quiet; anything 5xx, or a
 * crash, is ours.
 *
 * One incident per kind and failure code, so twenty customers hitting the
 * same broken step is one text that says "20 times". A booking of the same
 * kind that goes through afterwards clears it with a "Fixed" text, except a
 * payment that may have gone through: that one waits for "Got it".
 *
 * Server only.
 */
import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { alertsLiveFor, raiseIncident, resolveIncidentsLike } from '@lib/booking-alarms'

const logger = createLogger('booking-watch')

export type WatchedKind = 'class' | 'party' | 'shop'

const KIND_WORDS: Record<WatchedKind, string> = { class: 'class', party: 'party', shop: 'shop order' }

export interface BookingFacts {
  who?: string
  phone?: string
  what?: string
  when?: string
  amount?: string
}

/** What the request says about the customer, never trusting it beyond a text. */
export type Describe = (body: any) => Promise<BookingFacts> | BookingFacts

const clean = (v: unknown, max = 60) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** What happened to their money, from the answer the customer got. */
export function moneyWords(code: string | undefined, detail: string | undefined, crashed: boolean): { line: string; moneyUnclear: boolean } {
  const d = (detail ?? '').toLowerCase()
  if (crashed) return { line: 'The site crashed partway, so it may have charged them. Check Square first.', moneyUnclear: true }
  if (code === 'unknown_outcome') return { line: 'Their card MAY have been charged. Check Square first.', moneyUnclear: true }
  if (/card was charged|you were charged/.test(d) && !/not charged/.test(d)) return { line: 'Their card WAS charged but the booking did not save.', moneyUnclear: true }
  return { line: 'Nothing was charged.', moneyUnclear: false }
}

export function failureText(kind: WatchedKind, facts: BookingFacts, code: string | undefined, detail: string | undefined, crashed: boolean): string {
  const { line } = moneyWords(code, detail, crashed)
  const who = [facts.who, facts.phone ? `(${facts.phone})` : ''].filter(Boolean).join(' ') || 'Someone'
  const what = [facts.what, facts.when ? `on ${facts.when}` : '', facts.amount].filter(Boolean).join(', ')
  const why = crashed ? 'The site crashed.' : `${clean(detail, 140) || 'Our side failed'}${code ? ` [${code}]` : ''}`
  return `BOOKING FAILED (${KIND_WORDS[kind]}): ${who} tried ${what || `a ${KIND_WORDS[kind]}`}. ${line} Why: ${why}${/call/i.test(line) ? '' : ' Call them.'}`
}

export function watchBooking(kind: WatchedKind, handler: APIRoute, describe: Describe): APIRoute {
  return async (ctx) => {
    const live = alertsLiveFor(ctx.request.url)
    let body: any = null
    if (live) body = await ctx.request.clone().json().catch(() => null)

    let res: Response
    try {
      res = await handler(ctx)
    } catch (err) {
      logger.error('Booking endpoint crashed', { kind, error: err instanceof Error ? err.message : String(err) })
      if (live) await report(kind, body, describe, 'crash', undefined, true)
      return new Response(
        JSON.stringify({ error: 'Something went wrong', code: 'unknown_outcome', detail: 'Something went wrong on our side. Please don’t book again yet: text us at (256) 464-1710 and we’ll check whether it went through.' }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
      )
    }
    if (!live) return res
    if (res.status >= 500) {
      const answer = await res.clone().json().catch(() => ({} as any))
      await report(kind, body, describe, String(answer?.code ?? res.status), String(answer?.detail ?? answer?.error ?? ''), false)
    } else if (res.status >= 200 && res.status < 300) {
      // A booking went through: earlier "nothing charged" failures of this kind are over.
      await resolveIncidentsLike(`booking:${kind}:`, (inc) => `Fixed: ${KIND_WORDS[kind]} bookings are going through again (${inc.count} failed before this one).`)
    }
    return res
  }
}

async function report(kind: WatchedKind, body: any, describe: Describe, code: string, detail: string | undefined, crashed: boolean): Promise<void> {
  let facts: BookingFacts = {}
  try {
    facts = body ? await Promise.race([Promise.resolve(describe(body)), new Promise<BookingFacts>((r) => setTimeout(() => r({}), 3000))]) : {}
  } catch {
    facts = {}
  }
  const { moneyUnclear } = moneyWords(code, detail, crashed)
  await raiseIncident({
    // A payment that may have gone through is about one person: its own incident.
    key: moneyUnclear ? `money:${kind}:${code}:${clean(facts.phone || facts.who, 30) || Date.now()}` : `booking:${kind}:${code}`,
    text: failureText(kind, facts, code === 'crash' ? undefined : code, detail, crashed),
    urgent: true,
    autoResolve: !moneyUnclear,
  })
}
