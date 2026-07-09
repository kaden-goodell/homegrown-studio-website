import type { APIRoute } from 'astro'
import { createSquareClient } from '@providers/square/client'
import { siteConfig } from '@config/site.config'
import { partyConfig } from '@config/party.config'
import { createLogger } from '@lib/logger'
import type { SquareConfig } from '@config/site.config'

const logger = createLogger('api:party:service-info')

export const GET: APIRoute = async () => {
  const startTime = Date.now()
  try {
    const client = createSquareClient(
      siteConfig.providers.catalog.config as SquareConfig
    )

    const itemResponse = await client.catalog.object.get({
      objectId: partyConfig.square.catalogItemId,
    })

    const item = ((itemResponse as any)?.object ?? itemResponse) as any

    if (!item?.itemData) {
      logger.error('Catalog item not found or missing itemData', {
        objectId: partyConfig.square.catalogItemId,
        responseShape: Object.keys((itemResponse as any) ?? {}),
      })
      return errorResponse('Service not found', 404)
    }

    // Whole-studio party uses a single service variation.
    const variation = (item.itemData.variations ?? [])[0]
    if (!variation) {
      logger.error('Catalog item has no service variation', {
        objectId: partyConfig.square.catalogItemId,
      })
      return errorResponse('Service variation not found', 404)
    }

    const variationId = variation.id as string
    const variationVersion = Number(variation.version ?? 0)

    // Crafts are catalog ITEMS in the Party Crafts category. Each carries a
    // per-head price (its variation), a description, and an optional image.
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

    // Resolve craft image ids to CDN urls in one batch.
    const imageUrlById: Record<string, string> = {}
    if (imageIds.size > 0) {
      const imgResp = await client.catalog.batchGet({ objectIds: [...imageIds] })
      for (const img of ((imgResp as any).objects ?? [])) {
        imageUrlById[img.id] = img.imageData?.url ?? ''
      }
    }

    const crafts: Array<{
      id: string
      name: string
      perHeadCents: number
      description: string
      imageUrl: string | null
      personalized: boolean
    }> = craftItems
      .map((o) => {
        const v = o.itemData?.variations?.[0]?.itemVariationData
        const firstImage = (o.itemData?.imageIds ?? [])[0]
        const personalized = (o.itemData?.categories ?? []).some(
          (c: any) => c.id === partyConfig.square.personalizedCategoryId
        )
        return {
          id: o.id as string,
          name: (o.itemData?.name ?? '') as string,
          perHeadCents: Number(v?.priceMoney?.amount ?? 0n),
          description: (o.itemData?.descriptionPlaintext ?? o.itemData?.description ?? '') as string,
          imageUrl: firstImage ? imageUrlById[firstImage] ?? null : null,
          personalized,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    const data = {
      service: {
        id: item.id as string,
        name: (item.itemData.name ?? '') as string,
      },
      variationId,
      variationVersion,
      durationMinutes: partyConfig.durationMinutes,
      basePriceCents: partyConfig.basePriceCents,
      teamMemberId: partyConfig.square.defaultTeamMemberId,
      crafts,
    }

    logger.info('Party service info fetched', {
      duration_ms: Date.now() - startTime,
      craftCount: crafts.length,
    })

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: {
        // No caching: crafts carry live price + the non-refundable "personalized"
        // flag, which must reach the booking flow immediately when changed.
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    logger.error('Failed to fetch party service info', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    return errorResponse('Failed to fetch service information', 500)
  }
}

function errorResponse(detail: string, status: number) {
  return new Response(
    JSON.stringify({ error: detail }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}
