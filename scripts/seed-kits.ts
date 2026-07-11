/**
 * Seed the Square Catalog with the take-home-kit product objects.
 *
 * Creates (or idempotently updates) one category and three items:
 *   - category  "Take-Home Kits"
 *   - ITEM      "Kit Assembly"    — one variation (assembly fee)
 *   - ITEM      "Party Package"   — one variation per stocked-theme × tier
 *                                   ("The Gilded Table — serves 10", …)
 *   - ITEM      "Rental Deposit"  — one variation per tier ("Deposit — serves 10", …)
 *
 * Idempotency (net-new here — do NOT copy seed-catalog.ts's always-create logic):
 * we list the existing catalog, match the category, each ITEM, AND each variation
 * BY NAME, and reuse the real object id + version on update (the add-party-craft.ts
 * pattern, extended to multi-variation items). imageIds already attached to an ITEM
 * are preserved so re-running never drops a photo. Only genuinely-new objects get a
 * `#temp` client id.
 *
 * Usage:
 *   npx tsx scripts/seed-kits.ts --dry-run      # prints the batch + config block, no writes
 *   npx tsx scripts/seed-kits.ts                # live upsert (refuses if already seeded)
 *   npx tsx scripts/seed-kits.ts --force        # live upsert even if kitConfig is already filled
 *
 * After a live run, paste the printed `kitConfig.square` block into
 * src/config/kit.config.ts and commit.
 *
 * Env: SQUARE_ACCESS_TOKEN (required for live), SQUARE_ENVIRONMENT ('production' | 'sandbox').
 */

import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'
import { kitConfig } from '../src/config/kit.config'
import { kitThemes } from '../src/config/kit-content'

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const force = argv.includes('--force')

const token = process.env.SQUARE_ACCESS_TOKEN
const environment =
  process.env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox

// Safety: never clobber an already-seeded catalog on a live run without --force.
if (!dryRun && kitConfig.square.packageItemId && !force) {
  console.error(
    'REFUSING: kitConfig.square.packageItemId is already set — the kit catalog looks seeded.\n' +
      'Re-run with --force to update it anyway, or use --dry-run to preview.',
  )
  process.exit(1)
}
if (!dryRun && !token) {
  console.error('Missing SQUARE_ACCESS_TOKEN — required for a live run. Use --dry-run to preview without it.')
  process.exit(1)
}

const client = token ? new SquareClient({ token, environment }) : null

const CATEGORY_NAME = 'Take-Home Kits'
const ASSEMBLY_VARIATION_NAME = 'Assembly'

let counter = 0
const tempId = (prefix: string) => `#${prefix}-${++counter}`

const jsonReplacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)

// ---------------------------------------------------------------------------
// Desired objects (declarative)
// ---------------------------------------------------------------------------
interface DesiredVariation {
  name: string
  priceCents: number
}
interface DesiredItem {
  key: 'assembly' | 'package' | 'deposit'
  name: string
  variations: DesiredVariation[]
}

const stockedThemes = kitThemes.filter((t) => t.stocked)

const desiredItems: DesiredItem[] = [
  {
    key: 'assembly',
    name: 'Kit Assembly',
    variations: [{ name: ASSEMBLY_VARIATION_NAME, priceCents: kitConfig.assemblyFeeCents }],
  },
  {
    key: 'package',
    name: 'Party Package',
    // Sweet Sixteen sells under its own variations even though its ledger collapses
    // onto Gilded — the SELLABLE identity is distinct, so it gets real variations here.
    variations: stockedThemes.flatMap((theme) =>
      kitConfig.tiers.map((tier) => ({
        name: `${theme.displayName} — serves ${tier.serves}`,
        priceCents: tier.packagePriceCents,
      })),
    ),
  },
  {
    key: 'deposit',
    name: 'Rental Deposit',
    variations: kitConfig.tiers.map((tier) => ({
      name: `Deposit — serves ${tier.serves}`,
      priceCents: tier.depositCents,
    })),
  },
]

// ---------------------------------------------------------------------------
// Existing catalog (for by-name idempotency)
// ---------------------------------------------------------------------------
interface ExistingCatalog {
  categories: Map<string, any>
  items: Map<string, any>
}

async function loadExistingCatalog(): Promise<ExistingCatalog> {
  const categories = new Map<string, any>()
  const items = new Map<string, any>()
  if (!client) return { categories, items }
  for await (const obj of (await client.catalog.list({ types: 'CATEGORY' })) as any) {
    const name = (obj as any).categoryData?.name
    if (name) categories.set(name, obj)
  }
  for await (const obj of (await client.catalog.list({ types: 'ITEM' })) as any) {
    const name = (obj as any).itemData?.name
    if (name) items.set(name, obj)
  }
  return { categories, items }
}

// ---------------------------------------------------------------------------
// Build the upsert batch, tracking client ids so we can emit the config block
// ---------------------------------------------------------------------------
interface VariationMeta {
  name: string
  clientVarId: string
  reused: boolean
}
interface ItemMeta {
  key: DesiredItem['key']
  clientItemId: string
  reused: boolean
  variations: VariationMeta[]
}

function buildCategory(existing: ExistingCatalog): { object: any | null; categoryId: string; reused: boolean } {
  const found = existing.categories.get(CATEGORY_NAME)
  if (found) return { object: null, categoryId: found.id, reused: true }
  const categoryId = tempId('category')
  return {
    object: { type: 'CATEGORY', id: categoryId, categoryData: { name: CATEGORY_NAME } },
    categoryId,
    reused: false,
  }
}

function buildItem(spec: DesiredItem, categoryId: string, existing: ExistingCatalog): { object: any; meta: ItemMeta } {
  const found = existing.items.get(spec.name)
  const clientItemId = found ? found.id : tempId('item')
  const existingVariations: any[] = found?.itemData?.variations ?? []

  const variationMetas: VariationMeta[] = []
  const variationObjects = spec.variations.map((v) => {
    const existingVar = existingVariations.find((ev) => ev.itemVariationData?.name === v.name)
    const clientVarId = existingVar ? existingVar.id : tempId('var')
    variationMetas.push({ name: v.name, clientVarId, reused: Boolean(existingVar) })
    return {
      type: 'ITEM_VARIATION' as const,
      id: clientVarId,
      version: existingVar?.version,
      itemVariationData: {
        itemId: clientItemId,
        name: v.name,
        pricingType: 'FIXED_PRICING',
        priceMoney: { amount: BigInt(v.priceCents), currency: 'USD' },
      },
    }
  })

  const object = {
    type: 'ITEM' as const,
    id: clientItemId,
    version: found?.version,
    itemData: {
      name: spec.name,
      productType: 'REGULAR',
      categories: [{ id: categoryId }],
      reportingCategory: { id: categoryId },
      // Preserve any already-attached image(s) on update.
      imageIds: found?.itemData?.imageIds ?? undefined,
      variations: variationObjects,
    },
  }

  return {
    object,
    meta: { key: spec.key, clientItemId, reused: Boolean(found), variations: variationMetas },
  }
}

// ---------------------------------------------------------------------------
// Config-block emission
// ---------------------------------------------------------------------------
function buildConfigBlock(metas: ItemMeta[], resolve: (clientId: string) => string): string {
  const byKey = (k: DesiredItem['key']) => metas.find((m) => m.key === k)!
  const varId = (m: ItemMeta, name: string) => resolve(m.variations.find((v) => v.name === name)!.clientVarId)

  const assembly = byKey('assembly')
  const pkg = byKey('package')
  const deposit = byKey('deposit')

  const packageVariations: Record<string, Record<number, string>> = {}
  for (const theme of stockedThemes) {
    packageVariations[theme.id] = {}
    for (const tier of kitConfig.tiers) {
      packageVariations[theme.id][tier.serves] = varId(pkg, `${theme.displayName} — serves ${tier.serves}`)
    }
  }

  const depositVariations: Record<number, string> = {}
  for (const tier of kitConfig.tiers) {
    depositVariations[tier.serves] = varId(deposit, `Deposit — serves ${tier.serves}`)
  }

  const q = (s: string) => `'${s}'`
  const lines: string[] = []
  lines.push('  square: {')
  lines.push(`    assemblyItemId: ${q(resolve(assembly.clientItemId))},`)
  lines.push(`    assemblyVariationId: ${q(varId(assembly, ASSEMBLY_VARIATION_NAME))},`)
  lines.push(`    packageItemId: ${q(resolve(pkg.clientItemId))},`)
  lines.push(`    depositItemId: ${q(resolve(deposit.clientItemId))},`)
  lines.push('    packageVariations: {')
  for (const theme of stockedThemes) {
    const inner = kitConfig.tiers.map((t) => `${t.serves}: ${q(packageVariations[theme.id][t.serves])}`).join(', ')
    lines.push(`      ${q(theme.id)}: { ${inner} },`)
  }
  lines.push('    },')
  const depInner = kitConfig.tiers.map((t) => `${t.serves}: ${q(depositVariations[t.serves])}`).join(', ')
  lines.push(`    depositVariations: { ${depInner} },`)
  lines.push('  },')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function main() {
  console.log(`seed-kits — ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'} · env ${process.env.SQUARE_ENVIRONMENT ?? 'sandbox'}\n`)

  let existing: ExistingCatalog = { categories: new Map(), items: new Map() }
  try {
    existing = await loadExistingCatalog()
  } catch (err: any) {
    if (dryRun) {
      console.warn('⚠ Could not read existing catalog (no creds / offline) — treating every object as NEW for this preview.\n')
    } else {
      throw err
    }
  }

  const cat = buildCategory(existing)
  const built = desiredItems.map((spec) => buildItem(spec, cat.categoryId, existing))
  const metas = built.map((b) => b.meta)
  const objects = [...(cat.object ? [cat.object] : []), ...built.map((b) => b.object)]

  // Summary
  const newCount = (cat.object ? 1 : 0) + built.filter((b) => !b.meta.reused).length
  const updCount = (cat.object ? 0 : 1) + built.filter((b) => b.meta.reused).length
  console.log(`Category "${CATEGORY_NAME}": ${cat.reused ? 'reuse ' + cat.categoryId : 'CREATE'}`)
  for (const b of built) {
    const nv = b.meta.variations.length
    const reusedVars = b.meta.variations.filter((v) => v.reused).length
    console.log(
      `Item "${desiredItems.find((d) => d.key === b.meta.key)!.name}": ${b.meta.reused ? 'update ' + b.meta.clientItemId : 'CREATE'}` +
        `  (${nv} variations — ${reusedVars} reused, ${nv - reusedVars} new)`,
    )
  }
  console.log(`\n${objects.length} objects total · ${updCount} reused · ${newCount} new\n`)

  // Full batch
  console.log('--- batch objects ---')
  console.log(JSON.stringify(objects, jsonReplacer, 2))
  console.log('--- end batch ---\n')

  if (dryRun) {
    // No idMappings in a dry run: resolve() returns the temp/real client id as-is.
    const resolve = (clientId: string) => clientId
    console.log('Paste into src/config/kit.config.ts (ids prefixed with "#" are placeholders until a live run):\n')
    console.log(buildConfigBlock(metas, resolve))
    console.log('\nDry run complete — nothing was written to Square.')
    return
  }

  const response: any = await client!.catalog.batchUpsert({
    idempotencyKey: crypto.randomUUID(),
    batches: [{ objects }],
  })
  const idMappings: any[] = response.idMappings ?? []
  const idMap = new Map<string, string>(idMappings.map((m) => [m.clientObjectId, m.objectId]))
  // Existing objects already carry real ids; new ones resolve via the mapping.
  const resolve = (clientId: string) => idMap.get(clientId) ?? clientId

  const configBlock = buildConfigBlock(metas, resolve)
  // A '#' surviving into the config means Square returned partial idMappings —
  // pasting it would ship temp ids into the app. Fail loudly instead.
  if (configBlock.includes("'#")) {
    console.error('ERROR: unresolved temp ids in config block — Square returned incomplete idMappings. Re-run the script (idempotent) and compare.')
    console.error(configBlock)
    process.exit(1)
  }
  console.log(`Success — ${idMappings.length} new object id(s) mapped.\n`)
  console.log('Paste into src/config/kit.config.ts:\n')
  console.log(configBlock)
}

main().catch((e: any) => {
  console.error('FATAL:', e?.errors ?? e?.body ?? e)
  process.exit(1)
})
