/**
 * D4 (Kaden, 1 Nov): the door honours the early-bird. Each class's POS item
 * carries the CURRENT seat prices: the early-bird price while it runs, the
 * regular price once it ends. Saving a class sets them (admin-actions syncPos
 * → syncClassToSquare); this keeps them right when the early-bird ends at
 * Chicago midnight with nobody saving anything.
 *
 * Run by the scheduled job (/api/jobs/class-prices.json, hourly). Idempotent:
 * it writes to Square only for a class whose POS prices differ from today's,
 * and records the prices it sent on the class. Square writes go through
 * syncClassToSquare, so the test-site guards (R39/R41) apply as on any save.
 *
 * Fix 2:
 * - M2: each class is read again just before its Square write, and the record
 *   is saved only if nobody saved the class meanwhile (an owner's save wins;
 *   the next run looks again).
 * - I2: a class whose POS price couldn't be put right texts the owners, at
 *   most once per class per Chicago day ("Open it in /admin and Save"). The
 *   daily warnings carry a line for it until it is fixed (warnings.ts).
 *
 * Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import { alertOwners } from '@lib/owner-alert'
import type { By } from '@lib/staff-auth'
import { chicagoYmd } from './chicago-day'
import { getClass, listClasses, StaleClassError, updateClass } from './class-store'
import { earlyBirdRunning } from './early-bird'
import { posPricesStale, syncClassToSquare } from './square-catalog'
import { notOnRegister, registerSetupStale, wantedTaxId } from './pos-plan'
import { assertInForceUsable, isSquareConnectionError, listRegisterChoices, registerInForce, type RegisterChoices } from './register-setup'
import type { ScheduledClass } from './types'

const logger = createLogger('classes:pos-prices')
export const PRICES_BY: By = { id: 'system', name: 'Early-bird prices' }
const YEAR_MS = 400 * 86_400_000
const alerts = makeKvStore('pos-price-alerts', 'pos-price-alerts')

/** What the owners' text says the POS is doing wrong. */
function wrongNow(cls: ScheduledClass, now: Date): string {
  return earlyBirdRunning(cls.content, now) ? "doesn't have the early-bird price yet" : 'still rings the early-bird price'
}

/** I2: one text per class per Chicago day, whoever runs the job (a create-only marker). */
async function tellOwnersOnce(cls: ScheduledClass, now: Date): Promise<void> {
  const k = `alert-${cls.id}-${chicagoYmd(now)}`
  try {
    if (!(await alerts.setIfMatch(k, JSON.stringify({ at: now.toISOString() }), null, false))) return
  } catch (err) {
    logger.error('POS price alert marker not written — not texting (the warnings line still shows it)', { classId: cls.id, error: String(err) })
    return
  }
  await alertOwners(
    `The register price for ${cls.content.name} didn't update: it ${wrongNow(cls, now)}. Open the class in /admin and tap Fix the register price now. We'll keep trying every hour.`,
  ).catch(() => undefined)
}

/** What the owner reads when "Fix the register price" can't finish. */
export const FIX_FAILED = 'Square didn’t take the new price just now. Nothing else changed. Try again in a few minutes.'

/**
 * "Fix the register price" (an owner's button on the class sheet, next to the
 * "register still rings the early-bird price" line): the same safe write the
 * hourly job makes, for one class, now. Safety rules: only a class on the POS
 * that isn't over; it re-reads the class first; it writes only the seat
 * prices and names the class already has (through syncClassToSquare, with the
 * test-site guards); it saves the record only if nobody saved the class
 * meanwhile; nothing about any booking changes. 'already' = nothing to fix.
 */
export async function fixPosPrices(classId: string, by: By, now = new Date()): Promise<{ result: 'fixed' | 'already'; cls: ScheduledClass }> {
  const cls = await getClass(classId)
  if (!cls) throw new ClassGoneError()
  if (!posPricesStale(cls, now)) return { result: 'already', cls }
  const square = await syncClassToSquare(cls, now)
  const saved = await updateClass(cls.id, { square }, by, 'Register price fixed', { expectedUpdatedAt: cls.updatedAt })
  return { result: 'fixed', cls: saved }
}

/** The class was deleted (or never existed) between the sheet loading and the button. */
export class ClassGoneError extends Error {
  constructor() { super('That class is gone. Reload the page.'); this.name = 'ClassGoneError' }
}

/** Why "Put it on the register" can't run for this class ('' = it can). */
export function putOnRegisterRefusal(cls: ScheduledClass, now: Date): string {
  if (cls.status === 'draft') return 'Drafts stay off the register. Open the class first.'
  if (cls.status === 'cancelled') return 'A cancelled class doesn’t go on the register.'
  if (!cls.sessions.some((s) => Date.parse(s.endIso) > now.getTime())) return 'This class is over, so it doesn’t go on the register.'
  return ''
}

/**
 * "Put it on the register" (fix round 3): an owner's button on the class
 * sheet for a class that should be on the register but isn't (or is missing
 * a seat it now sells). The same safety as "Fix the register price now":
 * owners only (the route), re-reads the class, the guarded write
 * (syncClassToSquare: R41/N3, tax and category checks), the record saved only
 * on the version read, and 'already' writes nothing. A replay after a lost
 * reply finds the item by SKU, so nothing is made twice.
 */
export async function putOnRegister(classId: string, by: By, now = new Date()): Promise<{ result: 'put' | 'already'; cls: ScheduledClass }> {
  const cls = await getClass(classId)
  if (!cls) throw new ClassGoneError()
  const refusal = putOnRegisterRefusal(cls, now)
  if (refusal) throw Object.assign(new Error(refusal), { refusal: true })
  if (!notOnRegister(cls, now)) return { result: 'already', cls }
  const square = await syncClassToSquare(cls, now)
  const saved = await updateClass(cls.id, { square }, by, 'Put on the register', { expectedUpdatedAt: cls.updatedAt })
  return { result: 'put', cls: saved }
}

/**
 * "Update the register" (fix round 4): send the class to the register again
 * with the tax and Classes category in More › Register setup now (and its
 * current prices). Shown on the class sheet when the class carries an old tax
 * or category, and as a small link on any class on the register. The same
 * safety as "Fix the register price now": owners only (the route), re-reads
 * the class, checks the tax and category in force are still right in Square
 * (else a setup refusal with the Register setup button), the guarded write
 * (syncClassToSquare: R41/N3), the record saved only on the version read.
 * Sending the same thing twice changes nothing, so a double tap is harmless.
 */
export async function updateRegister(classId: string, by: By, now = new Date(), choices?: RegisterChoices): Promise<{ result: 'updated'; cls: ScheduledClass }> {
  const cls = await getClass(classId)
  if (!cls) throw new ClassGoneError()
  const refusal = putOnRegisterRefusal(cls, now)
  if (refusal) throw Object.assign(new Error(refusal), { refusal: true })
  const reg = await registerInForce({ fresh: true })
  await assertInForceUsable(reg, wantedTaxId(cls, { classTaxId: reg.classTaxId }) !== null, choices)
  const square = await syncClassToSquare(cls, now)
  const saved = await updateClass(cls.id, { square }, by, 'Register updated (tax and category)', { expectedUpdatedAt: cls.updatedAt })
  return { result: 'updated', cls: saved }
}

/** A row in Register setup's "still use the old tax" list. */
export interface OldSetupRow { id: string; name: string; startIso: string }

const firstStart = (c: ScheduledClass) => [...c.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))[0]?.startIso ?? ''

/** Fix round 4: upcoming classes on the register with a different tax or category than Register setup has now. */
export async function classesOnOldSetup(now = new Date()): Promise<OldSetupRow[]> {
  const reg = await registerInForce({ fresh: true })
  const list = await listClasses({ fromIso: now.toISOString(), toIso: new Date(now.getTime() + YEAR_MS).toISOString() })
  return list.filter((c) => registerSetupStale(c, reg, now)).map((c) => ({ id: c.id, name: c.content.name, startIso: firstStart(c) }))
}

/** How long "Update them all" works per tap before answering (a Netlify function has ~10 s). */
export const UPDATE_ALL_BUDGET_MS = 4_000

/**
 * "Update them all" (fix round 4, More › Register setup): updateRegister for
 * every class still on the old tax or category, one at a time, until the time
 * budget runs out. `left` > 0 means tap again (the sheet does it by itself):
 * each run lists afresh, so a class already updated is never sent twice and a
 * class an owner saved meanwhile is skipped (their save sent the new setup).
 * Stops before any write when the setup itself isn't right in Square.
 */
export async function updateAllToSetup(by: By, opts: { now?: Date; budgetMs?: number } = {}): Promise<{ updated: OldSetupRow[]; failed: OldSetupRow[]; left: OldSetupRow[] }> {
  const started = Date.now()
  const now = opts.now ?? new Date()
  const budget = opts.budgetMs ?? UPDATE_ALL_BUDGET_MS
  const rows = await classesOnOldSetup(now)
  if (!rows.length) return { updated: [], failed: [], left: [] }
  const choices = await listRegisterChoices()
  const reg = await registerInForce()
  // One check for all: a wrong tax stops the run with the Register setup message, before any class is touched.
  await assertInForceUsable(reg, true, choices)
  const updated: OldSetupRow[] = []
  const failed: OldSetupRow[] = []
  let i = 0
  for (; i < rows.length; i++) {
    if (Date.now() - started > budget) break
    const row = rows[i]
    try {
      const fresh = await getClass(row.id)
      if (!fresh || !registerSetupStale(fresh, reg, now)) continue
      await updateRegister(row.id, by, now, choices)
      updated.push(row)
    } catch (err) {
      if (err instanceof StaleClassError) continue // an owner saved it meanwhile: that save sent the new setup
      logger.error('Class not updated to the register setup', { classId: row.id, error: err instanceof Error ? err.message : String(err) })
      if (isSquareConnectionError(err)) throw err // the website can't reach Square: nothing more will go through
      failed.push(row)
    }
  }
  return { updated, failed, left: rows.slice(i) }
}

export async function followCurrentPricesOnPos(now = new Date()): Promise<{ checked: number; updated: string[]; failed: string[] }> {
  const upcoming = await listClasses({ fromIso: now.toISOString(), toIso: new Date(now.getTime() + YEAR_MS).toISOString() })
  const stale = upcoming.filter((c) => posPricesStale(c, now))
  const updated: string[] = []
  const failed: string[] = []
  for (const listed of stale) {
    let cls: ScheduledClass = listed
    try {
      // M2: the class as it is now, not as it was listed a few seconds ago.
      const fresh = await getClass(listed.id)
      if (!fresh || !posPricesStale(fresh, now)) continue
      cls = fresh
      const square = await syncClassToSquare(fresh, now)
      await updateClass(fresh.id, { square }, PRICES_BY, 'POS prices follow the early-bird', { expectedUpdatedAt: fresh.updatedAt })
      updated.push(fresh.id)
    } catch (err) {
      if (err instanceof StaleClassError) {
        // An owner saved it meanwhile: their save put its prices on the POS. The next run looks again.
        logger.info('Class saved while its POS prices were being updated — leaving it to the next run', { classId: listed.id })
        continue
      }
      // The next run tries again; a save in /admin does the same.
      logger.error('POS prices not updated for a class — will try again next run', { classId: cls.id, error: err instanceof Error ? err.message : String(err) })
      failed.push(cls.id)
      await tellOwnersOnce(cls, now)
    }
  }
  return { checked: upcoming.length, updated, failed }
}
