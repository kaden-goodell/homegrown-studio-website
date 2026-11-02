import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { recordAudit } from '@lib/audit'
import { listParties, partyEndIso } from '@lib/party-store'
import { CraftError, createCraft, craftWritesRefusal, listAdminCrafts, setHidden, updateCraft, type AdminCraft, type CraftInput } from '@lib/crafts/craft-admin'

export const prerender = false

const LOAD_FAILED = 'The crafts couldn’t be loaded from Square. Try again in a minute.'

/** Parties still to come that picked this craft (by id, or by name for parties booked in Square). */
async function upcomingWith(craft: Pick<AdminCraft, 'id' | 'name'>, now = Date.now()): Promise<{ count: number; first: string | null }> {
  const parties = await listParties().catch(() => [])
  const coming = parties
    .filter((p) => p.status !== 'cancelled')
    .filter((p) => Date.parse(partyEndIso(p) ?? p.startIso) > now)
    .filter((p) => (p.craftId ? p.craftId === craft.id : p.craftName === craft.name))
    .sort((a, b) => a.startIso.localeCompare(b.startIso))
  return { count: coming.length, first: coming[0]?.startIso ?? null }
}

function input(body: any): CraftInput {
  const out: CraftInput = {}
  if (typeof body?.name === 'string') out.name = body.name
  if (typeof body?.description === 'string') out.description = body.description
  if (body?.cents !== undefined) out.cents = body.cents
  if (Array.isArray(body?.sizes)) out.sizes = body.sizes
  if (typeof body?.personalized === 'boolean') out.personalized = body.personalized
  if (typeof body?.popular === 'boolean') out.popular = body.popular
  if (typeof body?.where === 'string') out.where = body.where
  if (typeof body?.photoUrl === 'string' && body.photoUrl) out.photoUrl = body.photoUrl
  return out
}

/**
 * /admin › More › Crafts (G6), owners only.
 *
 * GET → { data: { crafts, markers, refusal } }: every craft in the party craft
 *   category (hidden ones too), which badges this Square has, and why this
 *   site can't change them (a test site on the live Square), or null.
 * POST { action }:
 *   create { requestId, name, description, cents, personalized?, popular?, where?, photoUrl? }
 *   update { id, version, ...only what changed }
 *   hide / show { id }: on the website only; the register keeps it.
 * Every change is audited.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  try {
    const { crafts, markers } = await listAdminCrafts()
    return json(200, { data: { crafts, markers, refusal: craftWritesRefusal(request) } })
  } catch (e) {
    console.error(`[admin/crafts] ${e instanceof Error ? e.message : e}`)
    return json(503, { error: LOAD_FAILED })
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => ({}))
  const by = adminActor(request)
  const who = { ...by, role: 'owner' as const }
  try {
    switch (body?.action) {
      case 'create': {
        const r = await createCraft(String(body.requestId ?? ''), input(body), request)
        if (!r.replayed) {
          await recordAudit({ by: who, action: 'craft-create', target: { kind: 'craft', id: r.craft.id, label: r.craft.name }, details: { cents: r.craft.sizes[0]?.cents ?? 0, photo: !!body.photoUrl } })
        }
        return json(200, { data: { craft: r.craft, message: `Added ${r.craft.name}. The website shows it within a minute.` }, ...(r.warning ? { warning: r.warning } : {}) })
      }
      case 'update': {
        if (typeof body.id !== 'string' || typeof body.version !== 'number') return json(400, { error: 'Close this and open the craft again.' })
        const r = await updateCraft(body.id, body.version, input(body), request)
        if (r.message !== 'Nothing changed.') {
          const details: Record<string, string | number | boolean | null> = {}
          for (const k of ['name', 'cents', 'personalized', 'popular', 'where'] as const) if (body[k] !== undefined) details[k] = body[k]
          if (typeof body.description === 'string') details.description = body.description.slice(0, 200)
          if (body.photoUrl) details.photo = true
          await recordAudit({ by: who, action: 'craft-update', target: { kind: 'craft', id: r.craft.id, label: r.craft.name }, details })
        }
        return json(200, { data: { craft: r.craft, message: r.message }, ...(r.warning ? { warning: r.warning } : {}) })
      }
      case 'hide':
      case 'show': {
        if (typeof body.id !== 'string' || !body.id) return json(400, { error: 'Pick a craft.' })
        const hidden = body.action === 'hide'
        const { crafts } = await listAdminCrafts().catch(() => ({ crafts: [] as AdminCraft[] }))
        const craft = crafts.find((c) => c.id === body.id)
        if (!craft) return json(404, { error: 'That craft isn’t in the craft list any more.' })
        await setHidden(craft.id, hidden, by.name, request)
        await recordAudit({ by: who, action: hidden ? 'craft-hide' : 'craft-show', target: { kind: 'craft', id: craft.id, label: craft.name } })
        const coming = hidden ? await upcomingWith(craft) : { count: 0, first: null }
        const keep = coming.count ? ` ${coming.count === 1 ? '1 party still to come picked it. It keeps it' : `${coming.count} parties still to come picked it. They keep it`}, and it stays on the register.` : ' It stays on the register.'
        return json(200, { data: { craft: { ...craft, hidden }, message: hidden ? `${craft.name} is off the website.${keep}` : `${craft.name} is back on the website.`, upcoming: coming.count } })
      }
    }
    return json(400, { error: 'That didn’t work. Try again.' })
  } catch (e) {
    if (e instanceof CraftError) return json(e.status, { error: e.message, ...e.extra })
    if (e instanceof Error && (e.name === 'TestSiteStoreError' || e.name === 'LiveSquareFromTestSiteError')) return json(403, { error: e.message })
    console.error(`[admin/crafts] ${e instanceof Error ? e.message : e}`)
    return json(503, { error: 'That didn’t save. Try again.' })
  }
}
