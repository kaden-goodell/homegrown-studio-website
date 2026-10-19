import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { toWorkshopData, withSignupInfo } from '@components/workshops/workshop-view-model'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'
import { getEventMeta } from '@lib/event-meta'
import type { CutoffSettings } from '@lib/seat-options'
import { resolvedPrice, type TicketType } from '@lib/ticket-types'
import { createLogger } from '@lib/logger'
import { remember } from '@lib/short-memory'
import { publicListHeaders } from '@lib/cache-headers'
import { listClasses } from '@lib/classes/class-store'
import { getLedger } from '@lib/classes/seat-ledger'
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
    return { ok: true, settings: { options: meta?.options ?? [], signupCutoffHours: meta?.signupCutoffHours ?? null, madeToOrder: meta?.madeToOrder ?? false }, tickets: meta?.tickets ?? null }
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
  const classes = (await listClasses({ fromIso: now.toISOString(), toIso: new Date(now.getTime() + OWN_AHEAD_MS).toISOString() })).filter(listedPublicly)
  let failed = false
  const list = await Promise.all(
    classes.map(async (cls) => {
      try {
        return toPublicClass(cls, await getLedger(cls.id), now)
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
  try {
    const list = await remember('workshops:list', 30_000, () => providers.workshop.listWorkshops())
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
  return new Response(JSON.stringify({ workshops, ...(failed ? { incomplete: true } : {}), ...(settingsErrors.length ? { settingsErrors } : {}) }), {
    status: 200,
    // A failed lookup is never cached: it must not read as "no workshops", nor
    // keep a class listed without its questions.
    headers: publicListHeaders(request, { failed }),
  })
}
