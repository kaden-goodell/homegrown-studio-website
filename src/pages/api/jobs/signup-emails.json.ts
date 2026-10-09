import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { partyConfig } from '@config/party.config'
import { SITE_URL } from '@config/site-url'
import { envBookingsOpen } from '@lib/bookings-gate'
import { createLogger } from '@lib/logger'
import { alertOwners } from '@lib/owner-alert'
import { emailReady, sendSignupNewsEmail } from '@lib/email'
import { openPartyStartsInWindow } from '@lib/party-open-dates'
import { emailedLine, failedLine, openSignups } from '@lib/signup-ledger'
import { judge, type DueItem, type StudioFacts, type WorkshopFact } from '@lib/signup-due'
import { getEventMeta } from '@lib/event-meta'
import type { CutoffSettings } from '@lib/seat-options'

export const prerender = false
const logger = createLogger('api:jobs:signup-emails')

/** People emailed per call. The scheduled function calls again while any are left. */
const DEFAULT_BATCH = 5
const MAX_BATCH = 10

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** The key the scheduled function sends: made from a secret only the site holds. */
export function jobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:signup-emails').digest('hex')
}

function allowed(request: Request): boolean {
  const secret = env('LOOKUP_SIGNING_SECRET')
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(jobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

interface Due {
  customerId: string
  email: string
  /** What they signed up for, as stored, one per item. */
  interests: string[]
  items: DueItem[]
}

/** A class's cutoff settings; null when unreadable (nothing is said about it then). */
async function cutoffFor(scheduleId: string): Promise<CutoffSettings | null> {
  try {
    const meta = await getEventMeta('workshop', scheduleId)
    return { options: meta?.options ?? [], signupCutoffHours: meta?.signupCutoffHours ?? null }
  } catch (err) {
    logger.error('Event settings unreadable: no email about this workshop this time', { scheduleId, error: String(err) })
    return null
  }
}

async function gatherFacts(now: Date): Promise<StudioFacts> {
  const bookingOpen = envBookingsOpen()
  const partiesOpen = envBookingsOpen('parties')
  const [workshops, openPartyStarts] = await Promise.all([
    providers.workshop.listWorkshops().catch((err) => {
      logger.error('Workshop list failed: no workshop email this time', { error: String(err) })
      return []
    }),
    // A failed lookup means nothing is said about party dates this time round.
    (partiesOpen ? openPartyStartsInWindow(now) : Promise.resolve([])).catch((err) => {
      logger.error('Party dates lookup failed: no party email this time', { error: String(err) })
      return [] as string[]
    }),
  ])
  return {
    now,
    bookingOpen,
    workshopsOpen: envBookingsOpen('workshops'),
    openPartyStarts,
    workshops: await Promise.all(
      workshops.map(
        async (w): Promise<WorkshopFact> => ({
          id: w.id,
          name: w.name,
          startAt: w.startAt,
          durationMinutes: w.durationMinutes,
          priceCents: w.priceCents,
          seatsLeft: w.availableCapacity,
          cutoff: await cutoffFor(w.scheduleId),
        }),
      ),
    ),
    kitsOpen: envBookingsOpen('kits') && siteConfig.features.kits.enabled,
    bookingWindowDays: partyConfig.bookingWindowDays,
    timeZone: partyConfig.timezone,
  }
}

/** The same button twice in one email helps nobody: keep the first of each. */
function withoutRepeats(found: { interest: string; item: DueItem }[]): { interest: string; item: DueItem }[] {
  const seen = new Set<string>()
  return found.filter(({ item }) => {
    const key = `${item.headline}|${item.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Sends the email each "tell me when…" sign-up was promised, once the thing
 * they asked about has happened. Called by the scheduled function
 * (netlify/functions/signup-emails.ts); nobody else holds the key.
 *
 * Each person is marked as emailed BEFORE the email goes, so a failure can
 * never turn into the same email again and again. If the email then fails,
 * the record says so and the owners are texted to follow up by hand.
 *
 * `{ "dry": true }` reports what would be sent and changes nothing.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Not allowed' }, 401)

  const body = await request.json().catch(() => ({}))
  const dry = body?.dry === true
  const batch = Math.min(Math.max(Number(body?.limit) || DEFAULT_BATCH, 1), MAX_BATCH)
  const now = new Date()
  const today = now.toLocaleDateString('en-CA', { timeZone: partyConfig.timezone })

  // Nothing can be due while booking is closed and kits are off: ask nobody anything.
  if (!envBookingsOpen()) return json({ data: { bookingOpen: false, sent: 0, failed: 0, left: 0, waiting: null, dry } }, 200)
  if (!dry && !emailReady()) return json({ error: 'Email is not set up' }, 503)

  let facts: StudioFacts
  let customers: Awaited<ReturnType<typeof providers.customer.listWithNotes>>
  try {
    ;[facts, customers] = await Promise.all([gatherFacts(now), providers.customer.listWithNotes()])
  } catch (err) {
    logger.error('Sign-up emails could not start', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Could not read the sign-ups' }, 502)
  }

  const due: Due[] = []
  let waiting = 0
  const kinds: Record<string, number> = {}
  for (const c of customers) {
    const found: { interest: string; item: DueItem }[] = []
    for (const signup of openSignups(c.note)) {
      const verdict = judge(signup.interest, facts)
      if (verdict.state === 'wait') waiting++
      if (verdict.state !== 'due') continue
      found.push({ interest: signup.interest, item: verdict.item })
      const kind = signup.interest.split(':')[0] || 'party'
      kinds[kind] = (kinds[kind] ?? 0) + 1
    }
    if (found.length === 0) continue
    due.push({
      customerId: c.id,
      email: c.email,
      // Every due sign-up is marked answered, including one whose button was a repeat.
      interests: found.map((f) => f.interest),
      items: withoutRepeats(found).map((f) => f.item),
    })
  }

  // A dry run says how many and of what kind. Never who.
  if (dry) return json({ data: { bookingOpen: true, dry: true, wouldEmail: due.length, kinds, waiting } }, 200)

  const thisTime = due.slice(0, batch)
  const results = await Promise.all(
    thisTime.map(async (person) => {
      try {
        await providers.customer.appendNote(
          person.customerId,
          person.interests.map((i) => emailedLine(today, i)).join('\n'),
        )
      } catch (err) {
        // Not marked, so not sent: it comes round again next time.
        logger.error('Could not mark a sign-up as emailed: not sending', { customerId: person.customerId, error: String(err) })
        return 'skipped' as const
      }
      let sent = false
      for (let attempt = 0; attempt < 2 && !sent; attempt++) {
        sent = (await sendSignupNewsEmail({ to: person.email, items: person.items, siteUrl: SITE_URL }).catch(() => ({ sent: false }))).sent
      }
      if (sent) {
        logger.info('Sign-up email sent', { customerId: person.customerId, items: person.items.length })
        return 'sent' as const
      }
      logger.error('SIGN-UP EMAIL FAILED: needs a person', { customerId: person.customerId })
      await providers.customer
        .appendNote(person.customerId, person.interests.map((i) => failedLine(today, i)).join('\n'))
        .catch(() => undefined)
      return 'failed' as const
    }),
  )

  const sent = results.filter((r) => r === 'sent').length
  const failed = results.filter((r) => r === 'failed').length
  if (failed > 0) {
    const who = thisTime.filter((_, i) => results[i] === 'failed').map((p) => p.email)
    await alertOwners(
      `Site: couldn't email ${failed === 1 ? 'someone' : `${failed} people`} who asked to be told when something opened. Please write to them: ${who.join(', ')}`,
    )
  }
  return json({ data: { bookingOpen: true, sent, failed, left: due.length - thisTime.length, waiting, dry: false } }, 200)
}
