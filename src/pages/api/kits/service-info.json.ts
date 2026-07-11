import type { APIRoute } from 'astro'
import { createSquareClient } from '@providers/square/client'
import { siteConfig } from '@config/site.config'
import { partyConfig } from '@config/party.config'
import { kitConfig } from '@config/kit.config'
import { kitThemes } from '@config/kit-content'
import { createLogger } from '@lib/logger'
import type { SquareConfig } from '@config/site.config'

const logger = createLogger('api:kits:service-info')

export const GET: APIRoute = async () => {
  const startTime = Date.now()

  // Unseeded → no package catalog yet. Distinct 503 so the UI can show an
  // internal-preview notice rather than the generic error state.
  if (!kitConfig.square.packageItemId) {
    return new Response(JSON.stringify({ error: 'kits not seeded' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }

  try {
    const client = createSquareClient(siteConfig.providers.catalog.config as SquareConfig)

    // ── Craft assembly (provenance: DUPLICATED from api/party/service-info.json.ts
    // lines ~43–104, intentionally NOT extracted to a shared helper — Task 10 edits
    // that party file in parallel and the no-overlap guarantee outweighs DRY here).
    const craftItems: any[] = []
    const imageIds = new Set<string>()
    for await (const obj of await client.catalog.list({ types: 'ITEM' })) {
      const o = obj as any
      const inCat = (o.itemData?.categories ?? []).some(
        (c: any) => c.id === partyConfig.square.partyCraftCategoryId
      )
      if (!inCat) continue
      craftItems.push(o)
      for (const id of o.itemData?.imageIds ?? []) imageIds.add(id)
    }

    const imageUrlById: Record<string, string> = {}
    if (imageIds.size > 0) {
      const imgResp = await client.catalog.batchGet({ objectIds: [...imageIds] })
      for (const img of ((imgResp as any).objects ?? [])) {
        imageUrlById[img.id] = img.imageData?.url ?? ''
      }
    }

    const crafts = craftItems
      .map((o) => {
        const prices = (o.itemData?.variations ?? [])
          .map((vr: any) => Number(vr.itemVariationData?.priceMoney?.amount ?? 0n))
          .filter((n: number) => n > 0)
        const minCents = prices.length ? Math.min(...prices) : 0
        const maxCents = prices.length ? Math.max(...prices) : 0
        const firstImage = (o.itemData?.imageIds ?? [])[0]
        const personalized = (o.itemData?.categories ?? []).some(
          (c: any) => c.id === partyConfig.square.personalizedCategoryId
        )
        const popular = (o.itemData?.categories ?? []).some(
          (c: any) => c.id === partyConfig.square.popularCategoryId
        )
        return {
          id: o.id as string,
          name: (o.itemData?.name ?? '') as string,
          perHeadCents: minCents,
          perHeadMaxCents: maxCents,
          description: (o.itemData?.descriptionPlaintext ?? o.itemData?.description ?? '') as string,
          imageUrl: firstImage ? imageUrlById[firstImage] ?? null : null,
          personalized,
          popular,
        }
      })
      .sort((a, b) => Number(!!b.popular) - Number(!!a.popular) || a.name.localeCompare(b.name))
    // ── end duplicated craft assembly ──

    // Every theme is surfaced; the UI renders waitlist (non-stocked) ones as
    // notify-me cards. Only stocked themes carry buyable tiers.
    const themes = kitThemes.map((t) => ({
      id: t.id,
      displayName: t.displayName,
      tagline: t.tagline,
      scheme: t.scheme,
      photo: t.photo,
      stocked: t.stocked,
      tiers: t.stocked
        ? kitConfig.tiers.map((tier) => ({
            serves: tier.serves,
            packagePriceCents: tier.packagePriceCents,
            depositCents: tier.depositCents,
          }))
        : [],
    }))

    const data = {
      crafts,
      themes,
      assemblyFeeCents: kitConfig.assemblyFeeCents,
      minGuests: kitConfig.minGuests,
      maxGuests: kitConfig.maxGuests,
      leadTimeDays: kitConfig.leadTimeDays,
      returnWindow: kitConfig.returnWindow,
    }

    logger.info('Kit service info fetched', {
      duration_ms: Date.now() - startTime,
      craftCount: crafts.length,
    })

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    logger.error('Failed to fetch kit service info', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    return new Response(JSON.stringify({ error: 'Failed to fetch kit information' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
