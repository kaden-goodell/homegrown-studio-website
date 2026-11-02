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
import { REGISTER_DOWN_SHORT } from '@lib/classes/register-words'
import { LiveSquareFromTestSiteError, TestSiteStoreError } from '@lib/classes/test-site-guard'

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

/** The Square side, in words when it can't be read. */
async function choices(): Promise<{ choices: RegisterChoices | null; choicesError?: string; connection?: boolean }> {
  try {
    return { choices: await listRegisterChoices() }
  } catch (e) {
    logger.warn('Register choices not read', { error: e instanceof Error ? e.message : String(e) })
    if (isSquareConnectionError(e)) return { choices: null, choicesError: REGISTER_DOWN_SHORT, connection: true }
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
  const [c, notOn] = await Promise.all([choices(), missing()])
  return json(200, { data: { setup, ...c, notOnRegister: notOn ?? [] } })
}

/**
 * POST (owners only):
 *   { action: 'save', classTaxId, classesCategoryId, expectedUpdatedAt } — checked against Square (on, added on top, 9%;
 *     the category exists), compare-and-set (409 `stale` with `current`), audited.
 *   { action: 'create-tax' } / { action: 'create-category' } — the 9% tax or the Classes category in Square when none
 *     is there (guarded catalog write: live site → live Square, test site → sandbox only); idempotent (re-reads first).
 *     Answers { id, made, choices }; the sheet then saves the pick.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  const by = adminActor(request)
  try {
    if (body?.action === 'create-tax' || body?.action === 'create-category') {
      const tax = body.action === 'create-tax'
      const { id, made } = tax ? await ensureClassTax() : await ensureClassesCategory()
      if (made) {
        await recordAudit({
          by: { ...by, role: 'owner' }, action: tax ? 'register-create-tax' : 'register-create-category',
          target: { kind: 'settings', id: 'register', label: tax ? 'Class tax made in Square' : 'Classes category made in Square' }, details: { squareId: id },
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
      return json(200, { data: { setup: await getRegisterSetupView().catch(() => saved), changed, notOnRegister: (await missing()) ?? [] } })
    }
    return json(400, { error: 'That is not something the register setup can do.' })
  } catch (e) {
    if (e instanceof StaleRegisterSetupError) return json(409, { error: e.message, stale: true, current: e.current })
    if (e instanceof RegisterSetupError) return json(e.status, { error: e.message, ...(e.field ? { field: e.field } : {}) })
    if (e instanceof TestSiteStoreError || e instanceof LiveSquareFromTestSiteError) return json(503, { error: e.message })
    if (isSquareConnectionError(e)) return json(503, { error: REGISTER_DOWN_SHORT, connection: true })
    logger.error('Register setup action failed', { action: body?.action, error: e instanceof Error ? e.message : String(e) })
    return json(502, { error: body?.action === 'save' ? 'Didn’t save. Try again.' : 'Square didn’t make it just now. Try again; nothing is made twice.' })
  }
}
