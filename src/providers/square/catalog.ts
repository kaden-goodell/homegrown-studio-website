import type { SquareConfig } from '../../config/site.config'
import type { CatalogProvider, EventType, EventVariation, AddOn } from '../interfaces/catalog'
import { createLogger } from '../../lib/logger'
import { createSquareClient } from './client'

const logger = createLogger('square-catalog')

export class SquareCatalogProvider implements CatalogProvider {
  private client: ReturnType<typeof createSquareClient>

  constructor(private config: SquareConfig) {
    this.client = createSquareClient(config)
  }

  async getEventTypes(params?: { category?: string }): Promise<EventType[]> {
    logger.info('Fetching event types', params)

    const items: any[] = []
    for await (const obj of await this.client.catalog.list({ types: 'ITEM' })) {
      items.push(obj)
    }

    logger.info('Found catalog items', { count: items.length })

    // Collect IDs to batch-fetch: modifier lists + categories
    const modifierListIds = new Set<string>()
    const categoryIds = new Set<string>()
    for (const item of items) {
      const modListInfo = item.itemData?.modifierListInfo ?? []
      for (const info of modListInfo) {
        if (info.modifierListId) {
          modifierListIds.add(info.modifierListId)
        }
      }
      for (const cat of item.itemData?.categories ?? []) {
        if (cat.id) categoryIds.add(cat.id)
      }
    }

    // Batch-fetch modifier lists + categories in one call
    const batchIds = [...Array.from(modifierListIds), ...Array.from(categoryIds)]
    const modifierListsMap = new Map<string, any>()
    const categoryNameMap = new Map<string, string>()
    if (batchIds.length > 0) {
      logger.info('Fetching modifier lists and categories', { modifiers: modifierListIds.size, categories: categoryIds.size })
      try {
        const response = await this.client.catalog.batchGet({
          objectIds: batchIds,
        })
        for (const obj of (response as any).objects ?? []) {
          if (obj.type === 'MODIFIER_LIST') {
            modifierListsMap.set(obj.id, obj)
          } else if (obj.type === 'CATEGORY') {
            categoryNameMap.set(obj.id, obj.categoryData?.name ?? '')
          }
        }
      } catch (err) {
        logger.error('Failed to fetch modifier lists/categories', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const eventTypes: EventType[] = []

    for (const item of items) {
      const itemData = item.itemData
      if (!itemData) continue

      const catId = itemData.categories?.[0]?.id
      const category = (catId ? categoryNameMap.get(catId) : undefined) ?? itemData.category?.name ?? ''

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
          startDate: varData.customAttributeValues?.startDate?.stringValue,
          endDate: varData.customAttributeValues?.endDate?.stringValue,
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
      const customAttrs = item.customAttributeValues ?? {}
      const flow: 'booking' | 'quote' =
        customAttrs.flow?.stringValue === 'quote' ? 'quote' : 'booking'

      // Program-specific custom attributes
      const enrollmentType = customAttrs.enrollmentType?.stringValue as 'per-session' | 'full' | undefined
      const ageMin = customAttrs.ageMin?.numberValue ? Number(customAttrs.ageMin.numberValue) : undefined
      const ageMax = customAttrs.ageMax?.numberValue ? Number(customAttrs.ageMax.numberValue) : undefined
      const scheduleDays = customAttrs.scheduleDays?.stringValue
      const scheduleTime = customAttrs.scheduleTime?.stringValue
      const totalHours = customAttrs.totalHours?.numberValue ? Number(customAttrs.totalHours.numberValue) : undefined
      const programDates = customAttrs.programDates?.stringValue
      const pricePerHead = customAttrs.pricePerHead?.numberValue ? Number(customAttrs.pricePerHead.numberValue) : undefined
      const maxCapacity = customAttrs.maxCapacity?.numberValue ? Number(customAttrs.maxCapacity.numberValue) : undefined

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
        ...(enrollmentType && { enrollmentType }),
        ...(ageMin !== undefined && ageMax !== undefined && { ageRange: { min: ageMin, max: ageMax } }),
        ...(scheduleDays && scheduleTime && { schedule: { days: scheduleDays, time: scheduleTime, totalHours: totalHours ?? 0 } }),
        ...(programDates && { programDates }),
        ...(pricePerHead !== undefined && { pricePerHead }),
        ...(maxCapacity !== undefined && { maxCapacity }),
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
