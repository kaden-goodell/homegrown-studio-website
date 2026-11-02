/**
 * More › Register setup (fix round 3, the bus-factor rule): which Square tax
 * is the 9% class tax and which category is "Classes", picked by an owner in
 * /admin instead of set as site config.
 *
 * Stored in the studio-settings store under its own key ('register'), written
 * compare-and-set with the last 50 changes kept, so a save here never freezes
 * the café hours from config (they live under 'settings'). Every reader asks
 * registerIds(): the saved pick first, then the site's built-in value
 * (SQUARE_CLASS_TAX_ID / SQUARE_CLASSES_CATEGORY_ID), so production behaves
 * exactly as before until an owner saves here.
 *
 * Square calls: reading taxes and categories (catalog list, read-only), and
 * making the 9% tax or the Classes category when none exists — only through
 * the guarded catalog write rules (R41: never from a test site without its own
 * store; N3/R39: the live Square only from the live site, the sandbox from
 * the test site). Creating is idempotent: it re-reads first and returns the
 * one already there.
 *
 * Server only.
 */
import { createHash } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import type { By } from '@lib/staff-auth'
import { chicagoYmd } from './chicago-day'
import { squareFetch, squareSettings } from './square-api'
import { assertClassWritesAllowed, assertSquareCatalogWriteAllowed } from './test-site-guard'
import { REGISTER_TAX_PERCENT } from './register-words'

const logger = createLogger('classes:register-setup')
const kv = makeKvStore('studio-settings', 'studio-settings')
const KEY = 'register'
const ATTEMPTS = 3
export const REGISTER_CACHE_MS = 60_000
export const REGISTER_HISTORY_CAP = 50
export const TAX_NAME = 'Sales tax'
export const CATEGORY_NAME = 'Classes'

export interface RegisterIds { classTaxId: string; classesCategoryId: string }

export interface RegisterChange { at: string; by: By; changed: string[]; before: RegisterIds }
export interface RegisterSetupDoc extends RegisterIds { updatedAt: string; by: By; history: RegisterChange[] }

/** What /admin shows: the ids in force and where each comes from. */
export interface RegisterSetupView extends RegisterIds {
  updatedAt: string | null
  by: By | null
  history: RegisterChange[]
  /** 'saved' = picked in /admin; 'site' = the site's built-in value; 'none' = nothing set. */
  source: { tax: 'saved' | 'site' | 'none'; category: 'saved' | 'site' | 'none' }
}

export interface TaxChoice { id: string; name: string; percent: string; enabled: boolean; additive: boolean; usable: boolean; why: string }
export interface CategoryChoice { id: string; name: string }
export interface RegisterChoices { taxes: TaxChoice[]; categories: CategoryChoice[] }
/** An upcoming class that should be on the register and isn't. */
export interface NotOnRegisterRow { id: string; name: string; startIso: string }

export class RegisterSetupError extends Error {
  constructor(public status: number, message: string, public field?: 'tax' | 'category') { super(message) }
}
export class StaleRegisterSetupError extends RegisterSetupError {
  constructor(public current: RegisterSetupView) { super(409, 'Someone else changed the register setup just now. Check it and save again.') }
}

/** Square's access token is expired, revoked or lacks a permission: nothing in /admin can fix that. */
export function isSquareConnectionError(e: unknown): boolean {
  const err = e as { status?: number; errors?: { code?: string; category?: string }[] } | null
  if (!err || typeof err !== 'object') return false
  if (err.status === 401 || err.status === 403) return true
  return (err.errors ?? []).some((x) => x?.category === 'AUTHENTICATION_ERROR'
    || ['UNAUTHORIZED', 'ACCESS_TOKEN_EXPIRED', 'ACCESS_TOKEN_REVOKED', 'INSUFFICIENT_SCOPES'].includes(String(x?.code)))
}

// ---------------------------------------------------------------- reading

const envIds = (): RegisterIds => {
  const cfg = squareSettings()
  return { classTaxId: cfg.classTaxId || '', classesCategoryId: cfg.classesCategoryId || '' }
}

function parse(json: string): RegisterSetupDoc {
  const d = JSON.parse(json) as RegisterSetupDoc
  return { ...d, classTaxId: d.classTaxId ?? '', classesCategoryId: d.classesCategoryId ?? '', history: d.history ?? [] }
}

/** Saved pick first (when it names one), then the site's value. */
function effective(doc: RegisterSetupDoc | null): RegisterIds {
  const env = envIds()
  return { classTaxId: doc?.classTaxId || env.classTaxId, classesCategoryId: doc?.classesCategoryId || env.classesCategoryId }
}

/** The saved document as last read (the site's values are read fresh each time, so they never go stale here). */
let cached: { at: number; doc: RegisterSetupDoc | null } | null = null

/** The stored setup, or null when an owner has never saved one. Throws when the store can't be read. */
export async function readRegisterSetup(): Promise<RegisterSetupDoc | null> {
  const json = await kv.get(KEY)
  return json ? parse(json) : null
}

/**
 * The class tax and Classes category in force, for every Square write and
 * read. The saved document is remembered for a minute. When the store can't
 * be read: the last saved answer, or the site's values (logged).
 */
export async function registerIds(opts: { fresh?: boolean } = {}): Promise<RegisterIds> {
  const now = Date.now()
  if (cached && !opts.fresh && now - cached.at < REGISTER_CACHE_MS) return effective(cached.doc)
  try {
    const doc = await readRegisterSetup()
    cached = { at: now, doc }
    return effective(doc)
  } catch (e) {
    logger.error('Register setup could not be read — using the last answer or the site values', { error: e instanceof Error ? e.message : String(e) })
    return effective(cached?.doc ?? null)
  }
}

export function resetRegisterCache(): void {
  cached = null
}

export async function getRegisterSetupView(): Promise<RegisterSetupView> {
  const doc = await readRegisterSetup()
  const env = envIds()
  const ids = effective(doc)
  const src = (saved: string | undefined, site: string) => (saved ? 'saved' : site ? 'site' : 'none') as 'saved' | 'site' | 'none'
  return {
    ...ids,
    updatedAt: doc?.updatedAt ?? null,
    by: doc?.by ?? null,
    history: doc?.history ?? [],
    source: { tax: src(doc?.classTaxId, env.classTaxId), category: src(doc?.classesCategoryId, env.classesCategoryId) },
  }
}

// ---------------------------------------------------------------- Square

async function listCatalog(types: string): Promise<any[]> {
  const out: any[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const q = new URLSearchParams({ types })
    if (cursor) q.set('cursor', cursor)
    const res = await squareFetch(`/catalog/list?${q}`, { method: 'GET' })
    out.push(...(res?.objects ?? []))
    cursor = res?.cursor || undefined
  } while (cursor && ++pages < 20)
  return out.filter((o) => !o?.is_deleted)
}

const percentOf = (p: unknown): number => Number(String(p ?? '').trim())

/** Why a tax can't be the class tax, in Catherine's words ('' = it can). */
function whyNot(t: { enabled: boolean; additive: boolean; percent: string }): string {
  if (!t.enabled) return 'This tax is turned off.'
  if (percentOf(t.percent) !== REGISTER_TAX_PERCENT) return `This tax isn’t ${REGISTER_TAX_PERCENT}%, so online prices wouldn’t match the register.`
  if (!t.additive) return 'This tax is already inside the prices, so online prices wouldn’t match the register.'
  return ''
}

/** The taxes and categories in Square, in words. Read-only. */
export async function listRegisterChoices(): Promise<RegisterChoices> {
  const objects = await listCatalog('TAX,CATEGORY')
  const taxes: TaxChoice[] = objects.filter((o) => o.type === 'TAX').map((o) => {
    const d = o.tax_data ?? {}
    const base = { id: String(o.id), name: String(d.name ?? 'Tax'), percent: String(d.percentage ?? ''), enabled: d.enabled !== false, additive: d.inclusion_type !== 'INCLUSIVE' }
    const why = whyNot(base)
    return { ...base, usable: !why, why }
  }).sort((a, b) => Number(b.usable) - Number(a.usable) || a.name.localeCompare(b.name))
  const categories: CategoryChoice[] = objects.filter((o) => o.type === 'CATEGORY')
    .map((o) => ({ id: String(o.id), name: String(o.category_data?.name ?? 'Category') }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { taxes, categories }
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.toLowerCase()

/** The guarded write, the same rules as putting a class on the register. */
function assertCatalogWrite(): void {
  assertClassWritesAllowed() // R41
  assertSquareCatalogWriteAllowed(squareSettings().environment) // N3 / R39
}

async function createOne(object: any, keyPart: string): Promise<string> {
  assertCatalogWrite()
  // One key per kind per Chicago day: a double tap (or a retry of a lost reply) makes one, never two.
  const key = `register-${keyPart}:${createHash('sha256').update(`${squareSettings().environment}:${chicagoYmd(new Date())}`).digest('hex').slice(0, 24)}`
  const res = await squareFetch('/catalog/batch-upsert', {
    method: 'POST',
    body: JSON.stringify({ idempotency_key: key, batches: [{ objects: [object] }] }),
  })
  const id = (res?.id_mappings ?? []).find((m: any) => m.client_object_id === object.id)?.object_id
    ?? res?.objects?.find((o: any) => o.type === object.type)?.id
  if (!id) throw new RegisterSetupError(502, 'Square didn’t send back what it made. Tap Try again; nothing is made twice.')
  return String(id)
}

/**
 * "Make the 9% class tax": the one usable 9% tax already there, or a new
 * "Sales tax" 9%, added on top of prices, on. NOT proven against Square yet
 * (Task 12 sandbox proof list) beyond the sandbox seed's identical create.
 */
export async function ensureClassTax(): Promise<{ id: string; made: boolean }> {
  const there = (await listRegisterChoices()).taxes.find((t) => t.usable)
  if (there) return { id: there.id, made: false }
  const id = await createOne({
    type: 'TAX', id: '#tax',
    tax_data: { name: TAX_NAME, calculation_phase: 'TAX_SUBTOTAL_PHASE', inclusion_type: 'ADDITIVE', percentage: String(REGISTER_TAX_PERCENT), applies_to_custom_amounts: true, enabled: true },
  }, 'class-tax')
  return { id, made: true }
}

/** "Make the Classes category": the one named Classes already there, or a new one. Same proof status as above. */
export async function ensureClassesCategory(): Promise<{ id: string; made: boolean }> {
  const there = (await listRegisterChoices()).categories.find((c) => sameName(c.name, CATEGORY_NAME))
  if (there) return { id: there.id, made: false }
  const id = await createOne({ type: 'CATEGORY', id: '#classes', category_data: { name: CATEGORY_NAME } }, 'classes-category')
  return { id, made: true }
}

// ---------------------------------------------------------------- writing

/** What changed, in words, for the history and the audit log. */
function describe(before: RegisterIds, after: RegisterIds, names: { tax?: string; category?: string }): string[] {
  const out: string[] = []
  if (before.classTaxId !== after.classTaxId) out.push(`Class tax: ${names.tax ?? after.classTaxId}`)
  if (before.classesCategoryId !== after.classesCategoryId) out.push(`Classes category: ${names.category ?? after.classesCategoryId}`)
  return out
}

/**
 * Save the picks (owners). Both are checked against Square first: the tax must
 * be on, added on top, and 9%; the category must exist. `expectedUpdatedAt` is
 * what the sheet loaded (null before the first save): anything newer → stale.
 */
export async function saveRegisterSetup(
  input: { classTaxId?: unknown; classesCategoryId?: unknown },
  opts: { expectedUpdatedAt: string | null; by: By; now?: Date; choices?: RegisterChoices },
): Promise<{ saved: RegisterSetupDoc; changed: string[] }> {
  assertClassWritesAllowed() // R41
  const classTaxId = typeof input.classTaxId === 'string' ? input.classTaxId.trim() : ''
  const classesCategoryId = typeof input.classesCategoryId === 'string' ? input.classesCategoryId.trim() : ''
  if (!classTaxId) throw new RegisterSetupError(400, `Pick the ${REGISTER_TAX_PERCENT}% class tax.`, 'tax')
  if (!classesCategoryId) throw new RegisterSetupError(400, 'Pick the Classes category.', 'category')
  const choices = opts.choices ?? await listRegisterChoices()
  const tax = choices.taxes.find((t) => t.id === classTaxId)
  if (!tax) throw new RegisterSetupError(400, 'That tax isn’t on the register any more. Pick another.', 'tax')
  if (!tax.usable) throw new RegisterSetupError(400, tax.why, 'tax')
  const cat = choices.categories.find((c) => c.id === classesCategoryId)
  if (!cat) throw new RegisterSetupError(400, 'That category isn’t on the register any more. Pick another.', 'category')

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { value, etag } = await kv.getWithMeta(KEY)
    const cur = value ? parse(value) : null
    if ((cur?.updatedAt ?? null) !== (opts.expectedUpdatedAt ?? null)) {
      throw new StaleRegisterSetupError(await getRegisterSetupView())
    }
    const before = effective(cur)
    const after = { classTaxId, classesCategoryId }
    const changed = describe(before, after, { tax: `${tax.name} ${tax.percent}%`, category: cat.name })
    const now = opts.now ?? new Date()
    const stamp = cur && now.toISOString() <= cur.updatedAt ? new Date(Date.parse(cur.updatedAt) + 1).toISOString() : now.toISOString()
    const history = [{ at: stamp, by: opts.by, changed, before }, ...(cur?.history ?? [])].slice(0, REGISTER_HISTORY_CAP)
    const saved: RegisterSetupDoc = { ...after, updatedAt: stamp, by: opts.by, history }
    if (await kv.setIfMatch(KEY, JSON.stringify(saved), etag, value !== null)) {
      cached = { at: Date.now(), doc: saved }
      return { saved, changed }
    }
  }
  throw new RegisterSetupError(503, 'Someone else is saving at the same moment. Try again.')
}
