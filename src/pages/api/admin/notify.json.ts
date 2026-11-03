import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { recordAudit } from '@lib/audit'
import { classWritesRefusal, TestSiteStoreError } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import { NOTIFY_MESSAGES, NotifyError, notifyView, ROW_LABEL, saveNotify } from '@lib/notify-settings'
import { json } from '@lib/staffing/http'
import { noticeNotifyChange } from '@lib/owner-change-notice'
import { deviceSaid, ownersSnapshot, studioWhen, tellOwners } from '@lib/owner-notice'
import { getTaxExtra, saveTaxExtra, TaxExtraError, taxExtraStarts } from '@lib/tax-extra'

export const prerender = false

const logger = createLogger('api:notify')

/**
 * Owners only: /admin › More › Notifications (G5).
 * GET  → NotifyView + { readOnly }: each row, who's picked, where it goes now and whether that is set here or the site setup.
 * GET also carries `taxExtra` { email, startsAt }: the "Also send the monthly tax split to" address (I7).
 * POST { action: 'tax-extra', email } → saves that address ('' removes it); a new one starts a day later;
 *   audited; every owner is emailed and texted (at their own addresses).
 * POST { rows: { [row]: staffId[] }, expectedUpdatedAt } → { updatedAt, changed: [labels] }
 *   Owners only, at least one per row, an email for the email rows. Someone
 *   else saved first → 409. Audited (which rows, never contact details). The
 *   other owners are emailed and texted which rows changed (M1).
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  try {
    const extra = await getTaxExtra()
    return json(200, { data: { ...(await notifyView()), readOnly: !!classWritesRefusal(), taxExtra: { email: extra.email, startsAt: taxExtraStarts(extra) } } })
  } catch (e) {
    logger.error('Notification settings could not be read', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: NOTIFY_MESSAGES.unreadable })
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json(400, { error: "We couldn't read that. Try again." })
  const by = await adminActor(request)
  if (body.action === 'tax-extra') return saveExtra(body.email, by)
  try {
    const expected = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null
    const saved = await saveNotify(body.rows, by, expected)
    const changed = saved.changed.map((r) => ROW_LABEL[r])
    await recordAudit({ by: { ...by, role: 'owner' }, action: 'notify.saved', target: { kind: 'settings', id: 'notify', label: 'Notifications' }, details: { changed: changed.join(', ') } })
    // M1: the other owners hear which rows now go to whom (at their own addresses, not through these picks).
    try {
      const owners = await ownersSnapshot()
      const view = await notifyView()
      const names = new Map(view.owners.map((o) => [o.id, o.name]))
      const rows = view.rows.filter((r) => saved.changed.includes(r.row)).map((r) => ({ label: r.label, to: r.picked.map((id) => names.get(id) ?? 'someone') }))
      await noticeNotifyChange(by, owners, rows)
    } catch (err) {
      logger.warn('Could not tell the other owners about a Notifications change', { error: err instanceof Error ? err.message : String(err) })
    }
    return json(200, { data: { updatedAt: saved.updatedAt, changed } })
  } catch (e) {
    if (e instanceof NotifyError) return json(e.status, { error: e.message, ...(e.message === NOTIFY_MESSAGES.stale ? { stale: true } : {}) })
    if (e instanceof TestSiteStoreError) return json(503, { error: e.message })
    logger.error('Notification settings could not be saved', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: NOTIFY_MESSAGES.unreadable })
  }
}

/** "Also send the monthly tax split to" (I7): save, audit, tell every owner. */
async function saveExtra(email: unknown, by: Awaited<ReturnType<typeof adminActor>>): Promise<Response> {
  try {
    const { before, after } = await saveTaxExtra(email, by)
    if (before.email === after.email) return json(200, { data: { taxExtra: { email: after.email, startsAt: taxExtraStarts(after) }, changed: false } })
    await recordAudit({
      by: { ...by, role: 'owner' }, action: 'notify.tax-extra', target: { kind: 'settings', id: 'notify', label: 'Notifications' },
      details: { from: before.email || 'nobody', to: after.email || 'nobody' },
    })
    const starts = taxExtraStarts(after)
    const line = after.email
      ? `${deviceSaid(by)} set the monthly tax split to also go to ${after.email} (${studioWhen()}). It starts${starts ? ` ${studioWhen(new Date(starts))}` : ' now'}.${before.email ? ` It no longer goes to ${before.email}.` : ''} If that was you, there’s nothing to do. If not, check /admin › More › Notifications and change the admin passcode.`
      : `${deviceSaid(by)} stopped sending the monthly tax split to ${before.email} (${studioWhen()}). If that was you, there’s nothing to do. If not, check /admin › More › Notifications.`
    await tellOwners({ subject: 'Where the studio’s tax split goes changed in /admin', line }).catch(() => undefined)
    return json(200, { data: { taxExtra: { email: after.email, startsAt: starts }, changed: true } })
  } catch (e) {
    if (e instanceof TaxExtraError) return json(e.status, { error: e.message, field: 'taxExtra' })
    if (e instanceof TestSiteStoreError) return json(503, { error: e.message })
    logger.error('Tax split address could not be saved', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: NOTIFY_MESSAGES.unreadable })
  }
}
