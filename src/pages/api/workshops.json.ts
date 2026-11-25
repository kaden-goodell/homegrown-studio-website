import type { APIRoute } from 'astro'
import { systemForEveryoneNow } from '@lib/bookings-gate'
import { providers } from '@config/providers'
import { toWorkshopData, withSignupInfo } from '@components/workshops/workshop-view-model'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'
import { getEventMeta } from '@lib/event-meta'
import type { CutoffSettings } from '@lib/seat-options'
import { resolvedPrice, type TicketType } from '@lib/ticket-types'
import { createLogger } from '@lib/logger'
import { movedToFor, withoutMoved } from '@lib/moved-classes'
import { publicWorkshopList } from '@lib/workshop-snapshot'
import { publicListHeaders } from '@lib/cache-headers'
import { listClasses } from '@lib/classes/class-store'
import { getLedgerForDisplay } from '@lib/classes/seat-ledger'
import { waitlistForDisplay } from '@lib/classes/waitlist-store'
import { listedPublicly, toPublicClass } from '@lib/classes/public-view'

export const prerender = false
const logger = createLogger('api:workshops')

/**
 * A class's questions and cutoff from event-meta — merged here, not in the
 * provider (spec B). Unreadable settings list the class as plain (`ok: false`,
 * so the list is never cached); the booking server reads them again and
 * refuses rather than sell seats without picks.
 */
async function settingsFor(scheduleId: string): Promise<{ ok: boolean; settings: CutoffSettings; tickets?: TicketType[] | null; error?: string }> {
  try {
    const meta = await getEventMeta('workshop', scheduleId)
    return { ok: true, settings: { options: meta?.options ?? [], signupCutoffHours: meta?.signupCutoffHours ?? null, optionsCloseHours: meta?.optionsCloseHours ?? null, madeToOrder: meta?.madeToOrder ?? false }, tickets: meta?.tickets ?? null }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    logger.error('Event settings unreadable for the workshop list', { scheduleId, error })
    return { ok: false, settings: { options: [], signupCutoffHours: null }, error }
  }
}

/** How far ahead our own classes are listed. */
const OWN_AHEAD_MS = 400 * 24 * 60 * 60 * 1000

/**
 * Our own classes that are on the public list (open or closed, not draft,
 * cancelled or link-only), with seats left counted from the ledger. A class
 * whose ledger can't be read is left out and the list marked incomplete.
 */
async function ownClasses(now: Date): Promise<{ list: WorkshopData[]; failed: boolean }> {
  // LEGACY FALLBACK — delete after 2027-01-15: while classes run on the old
  // Square booking, only Square's classes are listed.
  if ((await systemForEveryoneNow('classes')) !== 'own') return { list: [], failed: false }
  const classes = (await listClasses({ fromIso: now.toISOString(), toIso: new Date(now.getTime() + OWN_AHEAD_MS).toISOString() })).filter(listedPublicly)
  let failed = false
  const list = await Promise.all(
    classes.map(async (cls) => {
      try {
        return toPublicClass(cls, await getLedgerForDisplay(cls.id), now, {}, await waitlistForDisplay(cls.id))
      } catch (err) {
        failed = true
        logger.error('Seat ledger unreadable for the workshop list — class left out', { classId: cls.id, error: err instanceof Error ? err.message : String(err) })
        return null
      }
    }),
  )
  return { list: list.filter((w): w is WorkshopData => w !== null), failed }
}

/**
 * Returns the upcoming workshops. Fetched client-side by WorkshopExplorer so the
 * /workshops page shell renders instantly instead of blocking on the (sometimes
 * slow) Square Classes API during navigation.
 */
export const GET: APIRoute = async ({ request }) => {
  let workshops: WorkshopData[] = []
  let failed = false
  // Infrastructure messages only (no secrets): lets a broken preview say why.
  const settingsErrors: { scheduleId: string; error: string }[] = []
  const now = new Date()
  // Our own classes are read alongside Square's; either failing leaves the other listed.
  const ours = ownClasses(now).catch((err) => {
    logger.error('own classes fetch failed', { error: err instanceof Error ? err.message : String(err) })
    return { list: [] as WorkshopData[], failed: true }
  })
  // ?w=<id>: the page followed a link to a class its first list didn't have
  // (a class added in the last minute). Ask Square again rather than say
  // "finished". The CDN keys on the query, so this answer is fresh too.
  const wanted = new URL(request.url).searchParams.get('w') ?? ''
  let moved: { id: string; to: string } | null = null
  try {
    // The copy the 5-minute alerts job saves (fresh), else Square live: Square often takes 8+ seconds.
    let list = await publicWorkshopList()
    if (/^[A-Za-z0-9_-]{6,64}$/.test(wanted) && !list.some((w) => w.id === wanted)) {
      list = await providers.workshop.listWorkshops()
    }
    // A Square class whose seats moved to our own system is never listed twice:
    // a link to it says where it went instead.
    const wantedSquare = wanted ? list.find((w) => w.id === wanted) : undefined
    if (wantedSquare) {
      const to = await movedToFor(wantedSquare.scheduleId)
      if (to) moved = { id: wanted, to }
    }
    list = await withoutMoved(list, (w) => w.scheduleId)
    workshops = await Promise.all(
      list.map(async (w) => {
        const { ok, settings, tickets, error } = await settingsFor(w.scheduleId)
        if (!ok) {
          failed = true
          settingsErrors.push({ scheduleId: w.scheduleId, error: error ?? 'unknown' })
        }
        const data = withSignupInfo(toWorkshopData(w), settings, now)
        return tickets
          ? { ...data, tickets: tickets.map((t) => ({ id: t.id, label: t.label, priceCents: resolvedPrice(t, w.priceCents), min: t.min })) }
          : data
      }),
    )
  } catch (err) {
    failed = true
    logger.error('workshops fetch failed', { error: err instanceof Error ? err.message : String(err) })
  }
  const own = await ours
  if (own.failed) failed = true
  // One list, by first session start.
  workshops = [...workshops, ...own.list].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
  return new Response(JSON.stringify({ workshops, ...(moved ? { moved } : {}), ...(failed ? { incomplete: true } : {}), ...(settingsErrors.length ? { settingsErrors } : {}) }), {
    status: 200,
    // A failed lookup is never cached: it must not read as "no workshops", nor
    // keep a class listed without its questions.
    headers: publicListHeaders(request, { failed }),
  })
}
