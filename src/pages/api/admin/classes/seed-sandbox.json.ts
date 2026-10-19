import type { APIRoute } from 'astro'
import { randomUUID } from 'node:crypto'
import { adminAuthorized } from '@lib/admin-auth'
import { squareFetch, squareSettings } from '@lib/classes/square-api'

export const prerender = false
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const CATEGORY_NAME = 'Classes'
const TAX_NAME = 'Sales tax'
const BRANCH = 'kaden/own-booking-system'

async function listAll(types: string): Promise<any[]> {
  const out: any[] = []
  let cursor: string | undefined
  do {
    const q = new URLSearchParams({ types })
    if (cursor) q.set('cursor', cursor)
    const res = await squareFetch(`/catalog/list?${q}`, { method: 'GET' })
    out.push(...(res?.objects ?? []))
    cursor = res?.cursor || undefined
  } while (cursor)
  return out
}

const sameName = (a: unknown, b: string) => typeof a === 'string' && a.trim().toLowerCase() === b.toLowerCase()

/**
 * GET (owners only): `{ data: { sandbox } }`, true only when this site talks
 * to the Square sandbox. /admin shows "Set up sandbox" only then.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return json(200, { data: { sandbox: squareSettings().environment === 'sandbox' } })
}

/**
 * POST (owners only, sandbox only): make sure the sandbox has a "Classes"
 * category and a 9% "Sales tax", creating whichever is missing. Safe to run
 * again. Returns both ids and the commands that set them for the branch.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  if (squareSettings().environment !== 'sandbox') {
    return json(409, { error: 'This only runs against the Square sandbox.' })
  }
  try {
    const existing = await listAll('CATEGORY,TAX')
    let classesCategoryId: string | undefined = existing.find((o) => o.type === 'CATEGORY' && sameName(o.category_data?.name, CATEGORY_NAME))?.id
    let classTaxId: string | undefined = existing.find((o) => o.type === 'TAX' && sameName(o.tax_data?.name, TAX_NAME))?.id

    const objects: any[] = []
    if (!classesCategoryId) objects.push({ type: 'CATEGORY', id: '#classes', category_data: { name: CATEGORY_NAME } })
    if (!classTaxId) {
      objects.push({
        type: 'TAX', id: '#tax',
        tax_data: {
          name: TAX_NAME, calculation_phase: 'TAX_SUBTOTAL_PHASE', inclusion_type: 'ADDITIVE',
          percentage: '9', applies_to_custom_amounts: true, enabled: true,
        },
      })
    }
    if (objects.length) {
      const res = await squareFetch('/catalog/batch-upsert', {
        method: 'POST',
        body: JSON.stringify({ idempotency_key: randomUUID(), batches: [{ objects }] }),
      })
      const ids = new Map<string, string>((res?.id_mappings ?? []).map((m: any) => [m.client_object_id, m.object_id]))
      classesCategoryId ??= ids.get('#classes')
      classTaxId ??= ids.get('#tax')
    }
    if (!classesCategoryId || !classTaxId) return json(502, { error: "Square didn't return the new category or tax." })
    return json(200, {
      data: {
        classesCategoryId,
        classTaxId,
        commands: [
          `npx netlify env:set SQUARE_CLASSES_CATEGORY_ID ${classesCategoryId} --context branch:${BRANCH}`,
          `npx netlify env:set SQUARE_CLASS_TAX_ID ${classTaxId} --context branch:${BRANCH}`,
        ],
      },
    })
  } catch (e: any) {
    return json(502, { error: e?.message || 'Square could not be reached.' })
  }
}
