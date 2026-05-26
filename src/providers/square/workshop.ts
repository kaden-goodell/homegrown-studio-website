import type { Workshop, WorkshopProvider } from '../interfaces/workshop'
import type { SquareConfig } from '../../config/site.config'
import { createSquareClient } from './client'
import { createLogger } from '../../lib/logger'

const logger = createLogger('square-workshop')
const CLASSES_API_BASE = 'https://app.squareup.com/appointments/api/buyer/classes'

function formatDateWithOffset(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0')
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}${sign}${hours}:${minutes}`
}

export class SquareWorkshopProvider implements WorkshopProvider {
  constructor(private config: SquareConfig) {}

  async listWorkshops(): Promise<Workshop[]> {
    if (!this.config.locationId) {
      return []
    }
    const all = await this.fetchAll()
    return all
      .filter((w) => w.availableCapacity > 0)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  }

  async getWorkshop(id: string): Promise<Workshop | null> {
    if (!this.config.locationId) return null
    const all = await this.fetchAll()
    return all.find((w) => w.id === id) ?? null
  }

  private async fetchAll(): Promise<Workshop[]> {
    const locationId = this.config.locationId
    const now = new Date()
    const endDate = new Date()
    endDate.setFullYear(endDate.getFullYear() + 1)

    const requestBody = {
      cursor: null,
      sort: { field: 'START_AT' },
      query: {
        filter: {
          location_id: locationId,
          starting_at: {
            start_at: formatDateWithOffset(now),
            end_at: formatDateWithOffset(endDate),
          },
          status: 'CLASS_SCHEDULE_ACTIVE',
        },
      },
      includes: ['CLASS_SCHEDULE'],
      limit: 50,
    }

    const response = await fetch(
      `${CLASSES_API_BASE}/class_schedule_instances/search?unit_token=${locationId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': 'https://book.squareup.com',
          'Referer': 'https://book.squareup.com/',
        },
        body: JSON.stringify(requestBody),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Classes API error', { status: response.status, error: errorText })
      throw new Error(`Square Classes API error: ${response.status}`)
    }

    const data: any = await response.json()
    const scheduleMap = new Map<string, any>()
    for (const schedule of data.included_resources?.class_schedules ?? []) {
      scheduleMap.set(schedule.id, schedule)
    }

    const workshops: Workshop[] = (data.class_schedule_instances ?? []).map((instance: any): Workshop => {
      const details = scheduleMap.get(instance.class_schedule_id) ?? {}
      return {
        id: instance.id,
        scheduleId: instance.class_schedule_id,
        name: details.name ?? 'Unnamed Workshop',
        description: details.description ?? '',
        descriptionHtml: details.description_html ?? '',
        startAt: instance.start_at,
        durationMinutes: details.duration_minutes ?? 60,
        priceCents: details.price_amount ?? 0,
        priceCurrency: details.price_currency ?? 'USD',
        availableCapacity: instance.available_capacity ?? 0,
        staffName: details.staff_name ?? '',
        teamMemberId: details.team_member_id ?? '',
      }
    })

    // Join images from paired CLASS_TICKET catalog items by name match.
    // Square auto-creates a catalog item for every class added via the
    // Appointments UI; that catalog item is where workshop images live.
    try {
      const nameToUrl = await this.fetchWorkshopImageMap()
      for (const w of workshops) {
        const url = nameToUrl.get(w.name.toLowerCase())
        if (url) w.imageUrl = url
      }
    } catch (err) {
      logger.error('Failed to join workshop images from catalog', {
        error: err instanceof Error ? err.message : String(err),
      })
      // Continue — workshops still render without images.
    }

    return workshops
  }

  /** Maps lowercased workshop name → image URL (first imageId resolved to a CDN URL). */
  private async fetchWorkshopImageMap(): Promise<Map<string, string>> {
    const client = createSquareClient(this.config)
    const nameToImageId = new Map<string, string>()
    const imageIds = new Set<string>()

    for await (const obj of await client.catalog.list({ types: 'ITEM' })) {
      const item = obj as any
      const name: string | undefined = item.itemData?.name
      const ids: string[] = item.itemData?.imageIds ?? []
      if (!name || ids.length === 0) continue
      nameToImageId.set(name.toLowerCase(), ids[0])
      imageIds.add(ids[0])
    }

    if (imageIds.size === 0) return new Map()

    const batchResp: any = await client.catalog.batchGet({ objectIds: Array.from(imageIds) })
    const idToUrl = new Map<string, string>()
    for (const obj of batchResp?.objects ?? batchResp?.relatedObjects ?? []) {
      if (obj.type === 'IMAGE' && obj.imageData?.url) {
        idToUrl.set(obj.id, obj.imageData.url)
      }
    }

    const result = new Map<string, string>()
    for (const [name, imgId] of nameToImageId) {
      const url = idToUrl.get(imgId)
      if (url) result.set(name, url)
    }
    return result
  }
}
