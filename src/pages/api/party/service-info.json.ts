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

    // Read the craft modifier list — each modifier carries a per-head price.
    const batchResponse = await client.catalog.batchGet({
      objectIds: [partyConfig.square.craftModifierListId],
    })
    const relatedObjects = (batchResponse as any).objects ?? []

    const crafts: Array<{ id: string; name: string; perHeadCents: number }> = []
    for (const obj of relatedObjects) {
      if (obj.type !== 'MODIFIER_LIST') continue
      for (const mod of obj.modifierListData?.modifiers ?? []) {
        crafts.push({
          id: mod.id as string,
          name: (mod.modifierData?.name ?? '') as string,
          perHeadCents: Number(mod.modifierData?.priceMoney?.amount ?? 0n),
        })
      }
    }

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
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
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
