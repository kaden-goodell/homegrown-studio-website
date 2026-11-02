import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { recordAudit } from '@lib/audit'
import { createLogger } from '@lib/logger'
import { listClasses } from '@lib/classes/class-store'
import { notOnRegister } from '@lib/classes/pos-plan'
import {
  ensureClassesCategory, ensureClassTax, getRegisterSetupView, isSquareConnectionError, listRegisterChoices,
  RegisterSetupError, saveRegisterSetup, StaleRegisterSetupError, type NotOnRegisterRow, type RegisterChoices,
} from '@lib/classes/register-setup'
import { REGISTER_DOWN } from '@lib/classes/register-words'
import { LiveSquareFromTestSiteError, TestSiteStoreError } from '@lib/classes/test-site-guard'
import { classesOnOldSetup, updateAllToSetup, type OldSetupRow } from '@lib/classes/pos-prices'

export const prerender = false
const logger = createLogger('api:admin:register')
const YEAR_MS = 400 * 86_400_000

const UNREADABLE = 'The register setup couldn’t be reached. Try again.'
const SQUARE_UNREACHABLE = 'Square couldn’t be reached just now. Try again.'

/** Upcoming classes that should be on the register and aren't (open or closed, not over). Never throws. */
async function missing(now = new Date()): Promise<NotOnRegisterRow[] | null> {
  try {
    const list = await listClasses({ fromIso: now.toISOString(), toIso: new Date(now.getTime() + YEAR_MS).toISOString() })
    return list.filter((c) => notOnRegister(c, now)).map((c) => ({
      id: c.id, name: c.content.name,
      startIso: [...c.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))[0]?.startIso ?? '',
    }))
  } catch {
    return null
  }
}

/** Fix round 4: upcoming classes on the register with an old tax or category. Never throws. */
async function oldSetup(): Promise<OldSetupRow[]> {
  return classesOnOldSetup().catch(() => [])
}

/** The Square side, in words when it can't be read. */
async function choices(): Promise<{ choices: RegisterChoices | null; choicesError?: string; connection?: boolean }> {
  try {
    return { choices: await listRegisterChoices() }
  } catch (e) {
    logger.warn('Register choices not read', { error: e instanceof Error ? e.message : String(e) })
    if (isSquareConnectionError(e)) return { choices: null, choicesError: REGISTER_DOWN, connection: true }
    return { choices: null, choicesError: SQUARE_UNREACHABLE }
  }
}

/**
 * GET (owners only): the class tax and Classes category in force (and where
 * each comes from), the taxes and categories in Square to pick from, and the
 * upcoming classes not on the register yet.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  let setup
  try {
    setup = await getRegisterSetupView()
  } catch (e) {
    logger.error('Register setup read failed', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: UNREADABLE })
  }
  const [c, notOn, old] = await Promise.all([choices(), missing(), oldSetup()])
  return json(200, { data: { setup, ...c, notOnRegister: notOn ?? [], oldSetup: old } })
}

/**
 * POST (owners only):
 *   { action: 'save', classTaxId, classesCategoryId, expectedUpdatedAt } — checked against Square (on, added on top, 9%;
 *     the category exists), compare-and-set (409 `stale` with `current`), audited.
 *   { action: 'create-tax' } / { action: 'create-category' } — the 9% tax or the Classes category in Square when none
 *     is there (guarded catalog write: live site → live Square, test site → sandbox only); idempotent (re-reads first).
 *     Answers { id, made, choices }; the sheet then saves the pick. `seen` (the ids the sheet listed) lets a retry after a
 *     lost reply still audit the one it made (N9).
 *   { action: 'update-classes' } — "Update them all": every upcoming class on an old tax or category is sent again with
 *     the ones in force (batched by time; `left` > 0 → call again). Each class updated is audited. `skip` (ids): classes
 *     the sheet gave up on this run (M-e: 5 failures each), left for their own Update the register.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  const by = adminActor(request)
  try {
    if (body?.action === 'create-tax' || body?.action === 'create-category') {
      const tax = body.action === 'create-tax'
      const { id, made } = tax ? await ensureClassTax() : await ensureClassesCategory()
      // N9: a retry after a lost reply finds the one the first try made (made: false). It wasn't in what the sheet
      // listed, so it's audited then too.
      const seen = Array.isArray(body.seen) ? body.seen.filter((x: unknown) => typeof x === 'string') : null
      const foundUnseen = !made && seen !== null && !seen.includes(id)
      if (made || foundUnseen) {
        await recordAudit({
          by: { ...by, role: 'owner' }, action: tax ? 'register-create-tax' : 'register-create-category',
          target: { kind: 'settings', id: 'register', label: tax ? 'Class tax made in Square' : 'Classes category made in Square' },
          details: { squareId: id, ...(foundUnseen ? { note: 'found after a lost reply (or made in Square)' } : {}) },
        })
      }
      const c = await choices()
      return json(200, { data: { id, made, ...c } })
    }
    if (body?.action === 'save') {
      if (!('expectedUpdatedAt' in body) || (body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== 'string')) {
        return json(400, { error: 'Reload the page and try again.' })
      }
      const { saved, changed } = await saveRegisterSetup(body, { expectedUpdatedAt: body.expectedUpdatedAt, by })
      await recordAudit({
        by: { ...by, role: 'owner' }, action: 'register-setup', target: { kind: 'settings', id: 'register', label: 'Register setup' },
        details: { changed: changed.join('; ').slice(0, 500) || 'nothing' },
      })
      return json(200, { data: { setup: await getRegisterSetupView().catch(() => saved), changed, notOnRegister: (await missing()) ?? [], oldSetup: await oldSetup() } })
    }
    if (body?.action === 'update-classes') {
      const skip = Array.isArray(body.skip) ? body.skip.filter((x: unknown): x is string => typeof x === 'string').slice(0, 500) : []
      const r = await updateAllToSetup(by, { skip })
      for (const c of r.updated) {
        await recordAudit({ by: { ...by, role: 'owner' }, action: 'class-update-register', target: { kind: 'class', id: c.id, label: c.name }, details: { from: 'Register setup' } })
      }
      return json(200, { data: { updated: r.updated.length, failed: r.failed, left: r.left.length, oldSetup: await oldSetup() } })
    }
    return json(400, { error: 'That is not something the register setup can do.' })
  } catch (e) {
    if (e instanceof StaleRegisterSetupError) return json(409, { error: e.message, stale: true, current: e.current })
    if (e instanceof RegisterSetupError) return json(e.status, { error: e.message.replace(/ Open More › Register setup and pick (the [^.]+)\./, ' Pick $1 above.'), ...(e.field ? { field: e.field } : {}) })
    if (e instanceof TestSiteStoreError || e instanceof LiveSquareFromTestSiteError) return json(503, { error: e.message })
    if (isSquareConnectionError(e)) return json(503, { error: REGISTER_DOWN, connection: true })
    logger.error('Register setup action failed', { action: body?.action, error: e instanceof Error ? e.message : String(e) })
    return json(502, {
      error: body?.action === 'save' ? 'Didn’t save. Try again.'
        : body?.action === 'update-classes' ? 'Square didn’t take the update just now. Nothing else changed. Try again in a few minutes.'
          : 'Square didn’t make it just now. Try again; nothing is made twice.',
    })
  }
}
