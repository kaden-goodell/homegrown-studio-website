import { SquareClient } from 'square'
import type { SquareConfig } from '../../config/site.config'
import type { CatalogProvider, EventType, EventVariation, AddOn } from '../interfaces/catalog'
import { createLogger } from '../../lib/logger'

const logger = createLogger('square-catalog')

export class SquareCatalogProvider implements CatalogProvider {
  private client: SquareClient

  constructor(private config: SquareConfig) {
    this.client = new SquareClient({
      token: config.accessToken,
      environment: config.environment,
    })
  }

  async getEventTypes(params?: { category?: string }): Promise<EventType[]> {
    logger.info('Fetching event types', params)

    const items: any[] = []
    for await (const item of this.client.catalog.list({ types: 'ITEM' }) as any) {
      items.push(item)
    }

    logger.info('Found catalog items', { count: items.length })

    // Collect modifier list IDs to batch-fetch
    const modifierListIds = new Set<string>()
    for (const item of items) {
      const modListInfo = item.itemData?.modifierListInfo ?? []
      for (const info of modListInfo) {
        if (info.modifierListId) {
          modifierListIds.add(info.modifierListId)
        }
      }
    }

    // Batch-fetch modifier lists
    const modifierListsMap = new Map<string, any>()
    if (modifierListIds.size > 0) {
      logger.info('Fetching modifier lists', { count: modifierListIds.size })
      try {
        const response = await this.client.catalog.batchGet({
          objectIds: Array.from(modifierListIds),
        })
        for (const obj of (response as any).objects ?? []) {
          modifierListsMap.set(obj.id, obj)
        }
      } catch (err) {
        logger.error('Failed to fetch modifier lists', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const eventTypes: EventType[] = []

    for (const item of items) {
      const itemData = item.itemData
      if (!itemData) continue

      const category = itemData.categories?.[0]?.name ?? itemData.category?.name ?? ''

      // Filter by category if requested
      if (params?.category && category.toLowerCase() !== params.category.toLowerCase()) {
        continue
      }

      // Map variations
      const variations: EventVariation[] = (itemData.variations ?? []).map((v: any) => {
        const varData = v.itemVariationData ?? {}
        return {
          id: v.id,
          name: varData.name ?? '',
          priceAmount: Number(varData.priceMoney?.amount ?? 0n),
          priceCurrency: varData.priceMoney?.currency ?? 'USD',
        }
      })

      // Map modifiers from modifier lists
      const modifiers: AddOn[] = []
      const modListInfo = itemData.modifierListInfo ?? []
      for (const info of modListInfo) {
        const modList = modifierListsMap.get(info.modifierListId)
        if (!modList?.modifierListData?.modifiers) continue
        for (const mod of modList.modifierListData.modifiers) {
          modifiers.push({
            id: mod.id,
            name: mod.modifierData?.name ?? '',
            priceAmount: Number(mod.modifierData?.priceMoney?.amount ?? 0n),
            priceCurrency: mod.modifierData?.priceMoney?.currency ?? 'USD',
          })
        }
      }

      // Determine flow from custom attribute or default
      const flow: 'booking' | 'quote' =
        item.customAttributeValues?.flow?.stringValue === 'quote' ? 'quote' : 'booking'

      // Duration from first variation's serviceDuration (ms -> minutes), default 60
      const serviceDurationMs =
        itemData.variations?.[0]?.itemVariationData?.serviceDuration
      const duration = serviceDurationMs ? Number(serviceDurationMs) / 60000 : 60

      // Image URL from imageIds
      const imageUrl = itemData.imageIds?.[0]
        ? `https://items-images-production.s3.us-west-2.amazonaws.com/files/${itemData.imageIds[0]}/original.jpeg`
        : undefined

      eventTypes.push({
        id: item.id,
        name: itemData.name ?? '',
        description: itemData.description ?? '',
        category,
        imageUrl,
        variations,
        modifiers,
        flow,
        duration,
      })
    }

    logger.info('Returning event types', { count: eventTypes.length })
    return eventTypes
  }

  async getAddOns(eventTypeId: string): Promise<AddOn[]> {
    logger.info('Fetching add-ons', { eventTypeId })

    const response = await this.client.catalog.object.get({ objectId: eventTypeId })
    const item = response as any

    const modListInfo = item.itemData?.modifierListInfo ?? []
    const modifierListIds = modListInfo
      .map((info: any) => info.modifierListId)
      .filter(Boolean)

    if (modifierListIds.length === 0) return []

    const batchResponse = await this.client.catalog.batchGet({
      objectIds: modifierListIds,
    })

    const addOns: AddOn[] = []
    for (const obj of (batchResponse as any).objects ?? []) {
      for (const mod of obj.modifierListData?.modifiers ?? []) {
        addOns.push({
          id: mod.id,
          name: mod.modifierData?.name ?? '',
          priceAmount: Number(mod.modifierData?.priceMoney?.amount ?? 0n),
          priceCurrency: mod.modifierData?.priceMoney?.currency ?? 'USD',
        })
      }
    }

    return addOns
  }

  async getPricing(eventTypeId: string, variationId: string): Promise<EventVariation> {
    logger.info('Fetching pricing', { eventTypeId, variationId })

    const response = await this.client.catalog.object.get({ objectId: eventTypeId })
    const item = response as any

    const variation = (item.itemData?.variations ?? []).find(
      (v: any) => v.id === variationId
    )

    if (!variation) {
      throw new Error(`Variation ${variationId} not found on item ${eventTypeId}`)
    }

    const varData = variation.itemVariationData ?? {}
    return {
      id: variation.id,
      name: varData.name ?? '',
      priceAmount: Number(varData.priceMoney?.amount ?? 0n),
      priceCurrency: varData.priceMoney?.currency ?? 'USD',
    }
  }
}
