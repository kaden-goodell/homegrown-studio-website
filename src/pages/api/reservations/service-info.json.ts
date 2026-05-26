import type { APIRoute } from 'astro'
import { createSquareClient } from '@providers/square/client'
import { siteConfig } from '@config/site.config'
import { reservationConfig } from '@config/reservation.config'
import { createLogger } from '@lib/logger'
import type { SquareConfig } from '@config/site.config'

const logger = createLogger('api:reservations:service-info')

export const GET: APIRoute = async () => {
  const startTime = Date.now()
  try {
    const client = createSquareClient(
      siteConfig.providers.catalog.config as SquareConfig
    )

    const itemResponse = await client.catalog.object.get({
      objectId: reservationConfig.square.catalogItemId,
    })

    const item = ((itemResponse as any)?.object ?? itemResponse) as any

    if (!item?.itemData) {
      logger.error('Catalog item not found or missing itemData', {
        objectId: reservationConfig.square.catalogItemId,
        responseShape: Object.keys((itemResponse as any) ?? {}),
      })
      return errorResponse('Service not found', 404)
    }

    const modifierListIds = (item.itemData.modifierListInfo ?? [])
      .map((info: any) => info.modifierListId)
      .filter(Boolean)

    let relatedObjects: any[] = []
    if (modifierListIds.length > 0) {
      const batchResponse = await client.catalog.batchGet({
        objectIds: modifierListIds,
      })
      relatedObjects = (batchResponse as any).objects ?? []
    }

    // Map variations (duration options with pricing)
    const variations = (item.itemData.variations ?? []).map((v: any) => {
      const varData = v.itemVariationData ?? {}
      const durationMs = varData.serviceDuration ?? 0
      return {
        id: v.id as string,
        name: (varData.name ?? '') as string,
        version: Number(v.version ?? 0),
        priceCents: Number(varData.priceMoney?.amount ?? 0n),
        durationMinutes: Number(durationMs) / 60000,
      }
    })

    // Map modifiers from related modifier lists
    const modifiers: Array<{
      id: string
      name: string
      priceCents: number
    }> = []

    for (const obj of relatedObjects) {
      if (obj.type !== 'MODIFIER_LIST') continue
      for (const mod of obj.modifierListData?.modifiers ?? []) {
        modifiers.push({
          id: mod.id as string,
          name: (mod.modifierData?.name ?? '') as string,
          priceCents: Number(mod.modifierData?.priceMoney?.amount ?? 0n),
        })
      }
    }

    const data = {
      service: {
        id: item.id as string,
        name: (item.itemData.name ?? '') as string,
      },
      variations,
      modifiers,
      teamMemberId: reservationConfig.square.defaultTeamMemberId,
    }

    logger.info('Service info fetched', {
      duration_ms: Date.now() - startTime,
      variationCount: variations.length,
      modifierCount: modifiers.length,
    })

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      },
    })
  } catch (error) {
    logger.error('Failed to fetch service info', {
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
