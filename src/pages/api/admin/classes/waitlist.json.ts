import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { createLogger } from '@lib/logger'
import { getClass } from '@lib/classes/class-store'
import { getWaitlist } from '@lib/classes/waitlist-store'
import { cardOffAndNote, removeFromWaitlist, waitlistRows, WaitlistError } from '@lib/classes/waitlist'
import { askAboutEntry, runWaitlist } from '@lib/classes/waitlist-runner'
import { fitsNow, waitlistOpen } from '@lib/classes/waitlist-rules'
import { waitlistStop } from '@lib/classes/waitlist-items'
import { getLedger } from '@lib/classes/seat-ledger'
import { recordAudit } from '@lib/audit'
import type { ScheduledClass } from '@lib/classes/types'
import { TestSiteStoreError } from '@lib/classes/test-site-guard'

export const prerender = false
const logger = createLogger('api:admin:waitlist')
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const UNREACHABLE = 'The waitlist couldn’t be reached. Try again.'

/** The list, whether "Run the waitlist now" would add someone (a waiting group fits a free seat), and why it stopped, if it did. */
async function view(cls: ScheduledClass) {
  const [list, ledger] = await Promise.all([getWaitlist(cls.id), getLedger(cls.id)])
  const now = new Date()
  const fits = (e: (typeof list.entries)[number]) => e.state === 'waiting' && waitlistOpen(cls, e.sessionIds, now) && fitsNow(cls, ledger, e.sessionIds, e.seats, now)
  const canRun = cls.status === 'open' && list.entries.some(fits)
  const unsettled = list.entries.some((e) => e.state === 'charging')
  return { rows: waitlistRows(cls, list), canRun: canRun || unsettled, stopped: waitlistStop(cls, list, ledger, now) }
}

/**
 * GET ?id=cls_…: the class's waitlist in order, with what happened to each person. Owners only.
 * GET ?id=cls_…&ask=wle_…: I5, what Square shows for that person's unclear charge, in words, and the
 * choices that fit (read only; asking never charges or changes anything).
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  try {
    const cls = await getClass(url.searchParams.get('id') ?? '')
    if (!cls) return json(404, { error: 'That class is gone. Reload the page.' })
    const ask = url.searchParams.get('ask')
    if (ask) return json(200, { data: { answer: await askAboutEntry(cls.id, ask) } })
    return json(200, { data: await view(cls) })
  } catch (err) {
    logger.error('Waitlist read failed', { error: err instanceof Error ? err.message : String(err) })
    return json(503, { error: UNREACHABLE })
  }
}

/**
 * POST { action: 'remove', classId, entryId }: take someone off (card off
 * file, they're emailed, nothing charged). The sheet asks first.
 * POST { action: 'run', classId }: run the waitlist now (the same run a freed
 * seat starts: asks Square about anything unclear, then adds who fits).
 * POST { action: 'card-off', classId, entryId }: Task 12, "Take the card off
 * now" for someone off the list whose saved card Square hasn't confirmed off
 * (the 10-minute sweep keeps trying too). Never charges or emails anyone.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  try {
    if (body?.action === 'remove') {
      const cls = await getClass(str(body.classId))
      if (!cls) return json(404, { error: 'That class is gone. Reload the page.' })
      await removeFromWaitlist(cls.id, str(body.entryId), adminActor(request))
      return json(200, { data: await view(cls) })
    }
    if (body?.action === 'run') {
      const cls = await getClass(str(body.classId))
      if (!cls) return json(404, { error: 'That class is gone. Reload the page.' })
      const by = adminActor(request)
      const run = await runWaitlist(cls.id, { reason: 'owner', by, origin: new URL(request.url).origin })
      await recordAudit({ by: { ...by, role: 'owner' }, action: 'waitlist-run', target: { kind: 'class', id: cls.id, label: cls.content.name }, details: { added: run.added, declined: run.declined, stopped: run.stopped } })
      return json(200, { data: { ...(await view(cls)), run } })
    }
    if (body?.action === 'card-off') {
      const cls = await getClass(str(body.classId))
      if (!cls) return json(404, { error: 'That class is gone. Reload the page.' })
      const entry = (await getWaitlist(cls.id)).entries.find((e) => e.id === str(body.entryId))
      if (!entry) return json(404, { error: 'They aren’t on this waitlist any more. Reload the page.' })
      if (entry.state === 'waiting' || entry.state === 'charging') return json(409, { error: 'They’re still on the waitlist, so their card stays on file. Remove them first if they shouldn’t be.' })
      const by = adminActor(request)
      const off = await cardOffAndNote(cls.id, entry)
      await recordAudit({ by: { ...by, role: 'owner' }, action: 'waitlist-card-off', target: { kind: 'class', id: cls.id, label: cls.content.name }, details: { entryId: entry.id, off } })
      if (!off) return json(502, { error: 'Square didn’t take the card off just now. Nothing was charged. Try again in a few minutes; it’s also retried every 10 minutes by itself.' })
      return json(200, { data: await view(cls) })
    }
    return json(400, { error: 'That isn’t something this page can do.' })
  } catch (err) {
    if (err instanceof WaitlistError) return json(err.status, { error: err.message })
    if (err instanceof TestSiteStoreError) return json(503, { error: err.message })
    logger.error('Waitlist action failed', { error: err instanceof Error ? err.message : String(err) })
    return json(503, { error: UNREACHABLE })
  }
}
