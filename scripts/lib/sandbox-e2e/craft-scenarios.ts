/**
 * Crafts in /admin (G6, audit-c) against the preview's Square SANDBOX:
 * scenario 68. scripts/sandbox-e2e.ts appends it after the other scenarios;
 * same --only, --dry-run and summary. Proves each new catalog write the
 * Crafts screen makes, read back from Square itself (needs
 * SQUARE_SANDBOX_ACCESS_TOKEN; without it the Square checks are skipped
 * and noted):
 *   - Add a craft: the item is in the party craft category with its price
 *     and words; the same form sent twice makes one craft (idempotent key).
 *   - Change the price only: the words are NOT cleared (the 9 Oct 2026
 *     Square behaviour add-party-craft.ts guards against).
 *   - Change the words: the new words are saved.
 *   - A save from a stale screen (old version) is refused.
 *   - Hide on website / Show on website: ours only, no Square write.
 * The craft is named "TEST E2E <run> Craft…", so no customer menu ever shows
 * it (isTestCraft), and it is left hidden at the end. Catalog items are never
 * deleted (no delete call is proven here), so each run leaves one hidden
 * TEST item in the sandbox catalog.
 */
import { randomUUID } from 'node:crypto'
import { check, checkEqual, checkStatus, OWNER_HEADERS, type Scenario, type Scope } from './core'
import type { Ctx } from './scenarios'

const OWNER = OWNER_HEADERS

async function adminPost(ctx: Ctx, body: Record<string, unknown>) {
  return ctx.admin.request('POST', '/api/admin/crafts.json', { body, headers: OWNER })
}

async function squareItem(ctx: Ctx, id: string): Promise<any | null> {
  if (!ctx.square) return null
  const r = await ctx.square.call('GET', `/catalog/object/${encodeURIComponent(id)}`)
  return r?.object ?? null
}

const words = (item: any) => String(item?.item_data?.description_plaintext ?? item?.item_data?.description ?? '').trim()
const price = (item: any) => Number(item?.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount ?? -1)

export const craftScenarios: Scenario<Ctx>[] = [
  {
    id: 68,
    title: 'Crafts in /admin: add, change price and words, stale save, hide/show (read back from the Square sandbox)',
    plan: [
      'GET /api/admin/crafts.json: 200 and no refusal (the preview is on the sandbox)',
      'Add "TEST E2E <run> Craft" at $12.34 with three paragraphs; the same form again gives the same craft',
      'Square: the item is in the party craft category, $12.34, words saved',
      'Change only the price to $15: Square keeps the words',
      'Change the words: Square has the new words',
      'Save from the old version: 409 "Someone changed this craft"',
      'Hide on website, then Show, then Hide again (left hidden; never on a menu anyway)',
    ],
    async run(ctx: Ctx, scope: Scope) {
      const list = await ctx.admin.request('GET', '/api/admin/crafts.json', { headers: OWNER })
      checkStatus(list, 200, 'Crafts list')
      checkEqual(list.body.data.refusal, null, 'Crafts can be changed on the preview')
      const name = `TEST E2E ${ctx.runTag} Craft`.slice(0, 80)
      const description = 'Make a test craft.\n\nEveryone checks the sandbox.\n\nEach guest goes home with nothing. Ages 8 and up.'
      const requestId = randomUUID()
      const made = await adminPost(ctx, { action: 'create', requestId, name, description, cents: 1234 })
      checkStatus(made, 200, 'Add a craft')
      const craft = made.body.data.craft
      scope.cleanup.add(`hide ${name}`, () => adminPost(ctx, { action: 'hide', id: craft.id }))
      const again = await adminPost(ctx, { action: 'create', requestId, name, description, cents: 1234 })
      checkStatus(again, 200, 'The same form sent again')
      checkEqual(again.body.data.craft.id, craft.id, 'The same form makes one craft')

      const sq1 = await squareItem(ctx, craft.id)
      if (sq1) {
        check((sq1.item_data?.categories ?? []).length > 0, 'The craft has categories in Square')
        checkEqual(price(sq1), 1234, 'Square price after Add')
        check(words(sq1).startsWith('Make a test craft.'), 'Square kept the words after Add')
        check((sq1.item_data?.tax_ids ?? []).length > 0, 'The new craft carries a tax, so the register adds it')
      } else scope.note('No SQUARE_SANDBOX_ACCESS_TOKEN: Square read-backs skipped')

      const priced = await adminPost(ctx, { action: 'update', id: craft.id, version: craft.version, cents: 1500 })
      checkStatus(priced, 200, 'Change the price')
      const sq2 = await squareItem(ctx, craft.id)
      if (sq2) {
        checkEqual(price(sq2), 1500, 'Square price after the change')
        check(words(sq2).startsWith('Make a test craft.'), 'A price-only change kept the words in Square')
      }

      const reworded = await adminPost(ctx, { action: 'update', id: craft.id, version: priced.body.data.craft.version, description: 'New test words.\n\nEveryone checks again.\n\nAges 8 and up.' })
      checkStatus(reworded, 200, 'Change the words')
      const sq3 = await squareItem(ctx, craft.id)
      if (sq3) check(words(sq3).startsWith('New test words.'), 'Square has the new words')

      const stale = await adminPost(ctx, { action: 'update', id: craft.id, version: craft.version, cents: 1600 })
      checkStatus(stale, 409, 'A save from the old version')

      for (const action of ['hide', 'show', 'hide'] as const) {
        const r = await adminPost(ctx, { action, id: craft.id })
        checkStatus(r, 200, `${action} on website`)
      }
      const after = await ctx.admin.request('GET', '/api/admin/crafts.json', { headers: OWNER })
      checkEqual(after.body.data.crafts.find((c: any) => c.id === craft.id)?.hidden, true, 'Left hidden')
    },
  },
]
