/**
 * /admin › More › Crafts (G6): the party and Craft Café crafts, changed in the
 * app instead of by script or in Square. Server only.
 *
 * A craft is a Square catalog ITEM in the party craft category (the one the
 * site already reads: `partyCraftCategoryId()`), with one price per guest
 * (its variation), a description and a photo. The badges are marker
 * categories (party.config `square.*CategoryId`): Made to order, Most
 * popular, Parties only, Craft Café only. Only the calls already proven in
 * this codebase are used, with the same shapes:
 *   - read:   GET /catalog/list (tax-report.ts), GET /catalog/object/{id} (square-catalog.ts)
 *   - write:  POST /catalog/batch-upsert of the whole fetched item with only
 *             the changed fields (add-party-craft.ts, set-popular-craft.ts,
 *             set-party-only.ts; raw REST as square-catalog.ts), a new item
 *             shaped as add-party-craft.ts creates it
 *   - photo:  POST /catalog/images, multipart, is_primary (square-catalog.ts uploadImage)
 * The description follows add-party-craft.ts's rule: Square clears a
 * description re-sent unchanged, so it is only sent when it changed.
 *
 * Hide / Show is OURS, not Square's: a hidden craft drops off /book, the Craft
 * Café menu and new bookings, but stays on the register, because crafts are
 * paid at the studio after a party (D1) and a party already booked with it
 * still needs to be rung up.
 *
 * Guards on every write: R41 (a test site with no store of its own) and N3
 * (only the live site writes the live Square; a test site only the sandbox).
 * Creates carry an idempotency key from the form, so a double tap or a retry
 * after a lost answer never makes two crafts. Edits carry the version she
 * loaded: someone else's change in between is refused, never overwritten.
 */
import { createHash } from 'node:crypto'
import { partyConfig } from '@config/party.config'
import { makeKvStore } from '@lib/blob-store'
import { partyCraftCategoryId, isTestCraft, resetPartyCraftCache } from '@lib/craft-catalog'
import { squareFetch, squareSettings } from '@lib/classes/square-api'
import { assertClassWritesAllowed, assertSquareCatalogWriteAllowed, classWritesRefusal, squareCatalogRefusal } from '@lib/classes/test-site-guard'
import { deployContext } from '@lib/deploy-context'
import { getHiddenCraftIds, setCraftHidden } from './craft-settings'
import { readClassPhoto } from '@lib/classes/photo-store'

export type Where = 'both' | 'parties' | 'cafe'

export interface AdminCraftSize { id: string; name: string; cents: number }

export interface AdminCraft {
  id: string
  /** Square's version when read: sent back with an edit, so a change made in between is caught. */
  version: number
  name: string
  description: string
  sizes: AdminCraftSize[]
  imageUrl: string | null
  personalized: boolean
  popular: boolean
  where: Where
  /** Hidden on the website (ours); still on the register. */
  hidden: boolean
  /** A staff smoke-test item ("TEST — …"): never on the website anyway. */
  test: boolean
}

/** Which badge categories exist in this Square account (the sandbox has none until someone makes them). */
export interface CraftMarkers { personalized: boolean; popular: boolean; where: boolean }

export class CraftError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'CraftError'
  }
}

export const STALE = 'Someone changed this craft since you opened it. Close it and open it again to see the latest.'
export const GONE = 'That craft isn’t in the craft list any more.'
export const NAME_TAKEN = (name: string) => `There’s already a craft called ${name}.`

const createKeys = makeKvStore('craft-create-keys', 'craft-create-keys')

const markerIds = () => ({
  personalized: partyConfig.square.personalizedCategoryId,
  popular: partyConfig.square.popularCategoryId,
  partyOnly: partyConfig.square.partyOnlyCategoryId,
  cafeOnly: partyConfig.square.cafeOnlyCategoryId,
})

const catIds = (item: any): string[] => (item?.item_data?.categories ?? []).map((c: any) => c?.id).filter(Boolean)

/** Square's catalog item → what the Crafts screen shows. Pure. */
export function toAdminCraft(item: any, imageUrlById: Record<string, string>, hidden: Set<string>): AdminCraft {
  const d = item.item_data ?? {}
  const cats = new Set(catIds(item))
  const m = markerIds()
  const firstImage = (d.image_ids ?? [])[0]
  return {
    id: item.id,
    version: Number(item.version ?? 0),
    name: d.name ?? '',
    description: String(d.description_plaintext ?? d.description ?? ''),
    sizes: (d.variations ?? []).map((v: any) => ({ id: v.id, name: v.item_variation_data?.name ?? '', cents: Number(v.item_variation_data?.price_money?.amount ?? 0) })),
    imageUrl: firstImage ? imageUrlById[firstImage] ?? null : null,
    personalized: cats.has(m.personalized),
    popular: cats.has(m.popular),
    where: cats.has(m.partyOnly) ? 'parties' : cats.has(m.cafeOnly) ? 'cafe' : 'both',
    hidden: hidden.has(item.id),
    test: isTestCraft(d.name),
  }
}

/** Every catalog object of these types (read-only, paged). */
async function listCatalog(types: string): Promise<any[]> {
  const out: any[] = []
  let cursor: string | undefined
  do {
    const page: any = await squareFetch(`/catalog/list?types=${types}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { method: 'GET' })
    out.push(...(page?.objects ?? []))
    cursor = page?.cursor
  } while (cursor)
  return out
}

async function fetchItem(id: string): Promise<any | null> {
  try {
    const res: any = await squareFetch(`/catalog/object/${encodeURIComponent(id)}`, { method: 'GET' })
    const obj = res?.object
    return obj && obj.type === 'ITEM' && !obj.is_deleted ? obj : null
  } catch (e: any) {
    if (e?.status === 404) return null
    throw e
  }
}

/** The crafts, A to Z, and which badges this Square has. */
export async function listAdminCrafts(): Promise<{ crafts: AdminCraft[]; markers: CraftMarkers }> {
  const categoryId = partyCraftCategoryId()
  const [objects, hidden] = await Promise.all([listCatalog('ITEM,CATEGORY,IMAGE'), getHiddenCraftIds()])
  const categories = new Set(objects.filter((o) => o.type === 'CATEGORY').map((o) => o.id))
  const images: Record<string, string> = {}
  for (const o of objects) if (o.type === 'IMAGE') images[o.id] = o.image_data?.url ?? ''
  const crafts = objects
    .filter((o) => o.type === 'ITEM' && catIds(o).includes(categoryId))
    .map((o) => toAdminCraft(o, images, hidden))
    .sort((a, b) => a.name.localeCompare(b.name))
  const m = markerIds()
  return {
    crafts,
    markers: { personalized: categories.has(m.personalized), popular: categories.has(m.popular), where: categories.has(m.partyOnly) && categories.has(m.cafeOnly) },
  }
}

/** Why this site can't change crafts, or null (shown on the screen before she tries). */
export function craftWritesRefusal(request?: Request): string | null {
  return classWritesRefusal(request) ?? squareCatalogRefusal({ context: deployContext(request), squareEnvironment: squareSettings().environment })
}

function guard(request?: Request): void {
  assertClassWritesAllowed(request) // R41
  assertSquareCatalogWriteAllowed(squareSettings().environment, request) // N3
}

async function upsert(objects: any[], idempotencyKey: string): Promise<any> {
  return squareFetch('/catalog/batch-upsert', {
    method: 'POST',
    body: JSON.stringify({ idempotency_key: idempotencyKey, batches: [{ objects }] }),
  })
}

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24)

/** The fetched item, ready to send back: read-only timestamps dropped, version kept (compare-and-set). */
function forUpsert(item: any): any {
  const { updated_at: _u, created_at: _c, ...rest } = item
  return rest
}

/** Set or clear one category on a list of category refs. Pure. */
function withCategory(cats: { id: string }[], id: string, on: boolean): { id: string }[] {
  const without = cats.filter((c) => c.id !== id)
  return on ? [...without, { id }] : without
}

/** The badge categories asked for, applied where this Square has them. Pure. */
export function applyMarkers(cats: { id: string }[], want: { personalized?: boolean; popular?: boolean; where?: Where }, markers: CraftMarkers): { id: string }[] {
  const m = markerIds()
  let out = cats
  if (want.personalized !== undefined && markers.personalized) out = withCategory(out, m.personalized, want.personalized)
  if (want.popular !== undefined && markers.popular) out = withCategory(out, m.popular, want.popular)
  if (want.where !== undefined && markers.where) {
    out = withCategory(out, m.partyOnly, want.where === 'parties')
    out = withCategory(out, m.cafeOnly, want.where === 'cafe')
  }
  return out
}

/** Other crafts that carry Most popular: it moves to this one (one at a time). */
async function popularOthers(exceptId: string | null): Promise<any[]> {
  const categoryId = partyCraftCategoryId()
  const popularId = markerIds().popular
  const items = (await listCatalog('ITEM')).filter((o) => o.id !== exceptId && catIds(o).includes(categoryId) && catIds(o).includes(popularId))
  const out: any[] = []
  for (const o of items) {
    const fresh = await fetchItem(o.id)
    if (!fresh) continue
    const next = forUpsert(fresh)
    next.item_data = { ...next.item_data, categories: withCategory(next.item_data?.categories ?? [], popularId, false) }
    out.push(next)
  }
  return out
}

export interface CraftInput {
  name?: string
  description?: string
  /** One price for a single-size craft. */
  cents?: number
  /** Prices by size id, for a craft with sizes. */
  sizes?: { id: string; cents: number }[]
  personalized?: boolean
  popular?: boolean
  where?: Where
  /** A photo just uploaded to our photo store (its /api/admin/classes/photo.json?id= address). */
  photoUrl?: string
}

const MAX_CENTS = 100_000

/** The field errors for a craft's words and price, or null. Pure. */
export function craftInputRefusal(input: CraftInput, creating: boolean): { field: string; message: string } | null {
  if (creating || input.name !== undefined) {
    const name = (input.name ?? '').trim()
    if (!name) return { field: 'name', message: 'Give it a name.' }
    if (name.length > 80) return { field: 'name', message: 'Keep the name under 80 characters.' }
  }
  if (input.description !== undefined && input.description.length > 2000) return { field: 'description', message: 'Keep the words under 2,000 characters.' }
  const priceOk = (c: unknown) => typeof c === 'number' && Number.isInteger(c) && c > 0 && c <= MAX_CENTS
  if (creating && !priceOk(input.cents)) return { field: 'price', message: 'Type the price per guest, like 18.' }
  if (!creating && input.cents !== undefined && !priceOk(input.cents)) return { field: 'price', message: 'Type the price per guest, like 18.' }
  if (input.sizes !== undefined && !input.sizes.every((s) => typeof s?.id === 'string' && priceOk(s.cents))) return { field: 'price', message: 'Each size needs a price, like 18.' }
  if (input.where !== undefined && !['both', 'parties', 'cafe'].includes(input.where)) return { field: 'where', message: 'Pick where it’s offered.' }
  return null
}

/** The photo bytes from our own photo store, or a refusal: nothing from anywhere else is fetched. */
async function photoFrom(url: string): Promise<{ bytes: Buffer; type: string }> {
  let id = ''
  try {
    const u = new URL(url, 'https://x.invalid')
    if (u.pathname === '/api/admin/classes/photo.json') id = u.searchParams.get('id') ?? ''
  } catch { /* refused below */ }
  const photo = id ? await readClassPhoto(id) : null
  if (!photo) throw new CraftError(400, 'That photo didn’t upload. Choose it again.', { field: 'photo' })
  return photo
}

/** Upload the photo and make it the craft's first. */
async function uploadPhoto(itemId: string, name: string, url: string): Promise<void> {
  const { bytes, type } = await photoFrom(url)
  const form = new FormData()
  form.append('request', new Blob([JSON.stringify({
    idempotency_key: `craft-photo:${itemId}:${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}`,
    object_id: itemId,
    is_primary: true,
    image: { type: 'IMAGE', id: '#image', image_data: { name, caption: 'card' } },
  })], { type: 'application/json' }))
  form.append('image_file', new Blob([new Uint8Array(bytes)], { type }), type.includes('png') ? 'craft.png' : type.includes('webp') ? 'craft.webp' : 'craft.jpg')
  await squareFetch('/catalog/images', { method: 'POST', body: form })
}

const PHOTO_LATER = 'The craft is saved, but the photo didn’t go up. Open it and choose the photo again.'

function squareSaid(e: unknown): CraftError {
  if (e instanceof CraftError) return e
  const status = (e as any)?.status
  if (status === 409 || (e instanceof Error && /version/i.test(e.message))) return new CraftError(409, STALE, { stale: true })
  if (e instanceof Error && e.name === 'TestSiteStoreError') return new CraftError(403, e.message)
  if (e instanceof Error && e.name === 'LiveSquareFromTestSiteError') return new CraftError(403, e.message)
  const detail = e instanceof Error ? e.message : ''
  return new CraftError(502, `Square didn’t take it, so nothing changed. Try again in a minute.${detail ? ` (${detail})` : ''}`)
}

/**
 * Add a craft. `requestId` comes from the form when it opened: the same one
 * again (a double tap, a retry) answers with the craft already made.
 */
export async function createCraft(requestId: string, input: CraftInput, request?: Request): Promise<{ craft: AdminCraft; warning?: string; replayed?: boolean }> {
  guard(request)
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new CraftError(400, 'Close this and open Add a craft again.')
  const refused = craftInputRefusal(input, true)
  if (refused) throw new CraftError(400, refused.message, { field: refused.field })
  const already = await createKeys.get(requestId)
  if (already) {
    const item = await fetchItem(already)
    if (item) return { craft: toAdminCraft(item, {}, await getHiddenCraftIds()), replayed: true }
  }
  const categoryId = partyCraftCategoryId()
  const name = input.name!.trim()
  let markers: CraftMarkers
  let existing: AdminCraft[]
  try {
    ;({ crafts: existing, markers } = await listAdminCrafts())
  } catch (e) { throw squareSaid(e) }
  if (existing.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) throw new CraftError(409, NAME_TAKEN(name), { field: 'name' })
  const categories = applyMarkers([{ id: categoryId }], input, markers)
  const description = (input.description ?? '').trim()
  const object = {
    type: 'ITEM',
    id: '#craft',
    present_at_all_locations: true,
    item_data: {
      name,
      product_type: 'REGULAR',
      categories,
      reporting_category: { id: categoryId },
      ...(description ? { description } : {}),
      variations: [{
        type: 'ITEM_VARIATION',
        id: '#var',
        present_at_all_locations: true,
        item_variation_data: { item_id: '#craft', name: 'Per Guest', pricing_type: 'FIXED_PRICING', price_money: { amount: input.cents, currency: 'USD' } },
      }],
    },
  }
  let res: any
  try {
    const others = input.popular && markers.popular ? await popularOthers(null) : []
    res = await upsert([object, ...others], `craft-create:${requestId}:${hash(object)}`)
  } catch (e) { throw squareSaid(e) }
  const id: string | undefined = (res?.id_mappings ?? []).find((m: any) => m.client_object_id === '#craft')?.object_id
    ?? (res?.objects ?? []).find((o: any) => o.type === 'ITEM' && o.item_data?.name === name)?.id
  if (!id) throw new CraftError(502, 'Square didn’t say whether it saved the craft. Refresh the list before adding it again.')
  await createKeys.set(requestId, id).catch(() => undefined)
  resetPartyCraftCache()
  let warning: string | undefined
  const saved = (res?.objects ?? []).find((o: any) => o.id === id)
  if (description && saved && !String(saved.item_data?.description_plaintext ?? saved.item_data?.description ?? '').trim()) {
    warning = 'The craft is saved, but Square kept its words empty. Open it and save the words again.'
  }
  if (input.photoUrl) {
    try { await uploadPhoto(id, name, input.photoUrl) } catch (e) { console.warn(`[crafts] photo for ${id}: ${(e as Error)?.message}`); warning = PHOTO_LATER }
  }
  const after = await fetchItem(id).catch(() => null)
  return { craft: after ? await withImage(after) : toAdminCraft(saved ?? { ...object, id }, {}, new Set()), ...(warning ? { warning } : {}) }
}

/** One craft with its photo's address (a fresh read after a save). */
async function withImage(item: any): Promise<AdminCraft> {
  const imageId = item.item_data?.image_ids?.[0]
  const images: Record<string, string> = {}
  if (imageId) {
    const img: any = await squareFetch(`/catalog/object/${encodeURIComponent(imageId)}`, { method: 'GET' }).catch(() => null)
    if (img?.object?.image_data?.url) images[imageId] = img.object.image_data.url
  }
  return toAdminCraft(item, images, await getHiddenCraftIds())
}

/** Change a craft: only what's sent changes; `version` must be the one she loaded. */
export async function updateCraft(id: string, version: number, input: CraftInput, request?: Request): Promise<{ craft: AdminCraft; warning?: string; message: string }> {
  guard(request)
  const refused = craftInputRefusal(input, false)
  if (refused) throw new CraftError(400, refused.message, { field: refused.field })
  let item: any
  let list: { crafts: AdminCraft[]; markers: CraftMarkers }
  try {
    item = await fetchItem(id)
    if (!item || !catIds(item).includes(partyCraftCategoryId())) throw new CraftError(404, GONE)
    if (Number(item.version) !== Number(version)) throw new CraftError(409, STALE, { stale: true })
    list = await listAdminCrafts()
  } catch (e) { throw squareSaid(e) }
  const markers = list.markers

  const said: string[] = []
  const next = forUpsert(item)
  const d = { ...next.item_data }
  if (input.name !== undefined && input.name.trim() !== d.name) {
    const name = input.name.trim()
    const taken = list.crafts.some((c) => c.id !== id && c.name.trim().toLowerCase() === name.toLowerCase())
    if (taken) throw new CraftError(409, NAME_TAKEN(name), { field: 'name' })
    d.name = name
    said.push('name')
  }
  // Square clears a description re-sent unchanged (add-party-craft.ts, 9 Oct 2026): only send it when it changed.
  const current = String(d.description_plaintext ?? d.description ?? '').trim()
  if (input.description !== undefined && input.description.trim() !== current) {
    d.description = input.description.trim()
    delete d.description_html
    delete d.description_plaintext
    said.push('words')
  }
  const prices = new Map<string, number>()
  if (input.sizes) for (const s of input.sizes) prices.set(s.id, s.cents)
  if (input.cents !== undefined && (d.variations ?? []).length === 1) prices.set(d.variations[0].id, input.cents)
  let priceChanged = false
  d.variations = (d.variations ?? []).map((v: any) => {
    const want = prices.get(v.id)
    if (want === undefined || Number(v.item_variation_data?.price_money?.amount) === want) return v
    priceChanged = true
    const { updated_at: _u, created_at: _c, ...rest } = v
    return { ...rest, item_variation_data: { ...rest.item_variation_data, price_money: { amount: want, currency: 'USD' } } }
  })
  if (priceChanged) said.push('price')
  const before = catIds(item).join(',')
  d.categories = applyMarkers(d.categories ?? [], input, markers)
  if (d.categories.map((c: any) => c.id).join(',') !== before) said.push('badges')
  next.item_data = d

  let res: any = null
  if (said.length) {
    try {
      const others = input.popular && markers.popular && !catIds(item).includes(markerIds().popular) ? await popularOthers(id) : []
      res = await upsert([next, ...others], `craft-update:${id}:${version}:${hash(next)}`)
    } catch (e) { throw squareSaid(e) }
    resetPartyCraftCache()
  }
  let warning: string | undefined
  const saved = (res?.objects ?? []).find((o: any) => o.id === id)
  if (said.includes('words') && saved && d.description && !String(saved.item_data?.description_plaintext ?? saved.item_data?.description ?? '').trim()) {
    warning = 'Saved, but Square kept the words empty. Save the words again.'
  }
  if (input.photoUrl) {
    try {
      await uploadPhoto(id, d.name, input.photoUrl)
      said.push('photo')
      resetPartyCraftCache()
    } catch (e) { console.warn(`[crafts] photo for ${id}: ${(e as Error)?.message}`); warning = 'Saved, but the photo didn’t go up. Choose the photo again.' }
  }
  const after = await fetchItem(id).catch(() => null)
  const craft = after ? await withImage(after) : toAdminCraft(saved ?? item, {}, await getHiddenCraftIds())
  const message = said.length === 0 ? 'Nothing changed.' : priceChanged
    ? 'Saved. New bookings and the register use the new price. Crafts are paid at the studio, so nothing already booked changes.'
    : 'Saved. The website shows it within a minute.'
  return { craft, message, ...(warning ? { warning } : {}) }
}

/** Hide on (or show again on) the website. Ours only; the register keeps the craft. */
export async function setHidden(id: string, hidden: boolean, by: string, request?: Request): Promise<void> {
  assertClassWritesAllowed(request) // R41: our own store
  await setCraftHidden(id, hidden, by)
  resetPartyCraftCache()
}
