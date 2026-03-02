import type { CapacityProvider, CapacityInfo } from '../interfaces/capacity'
import type { NotificationProvider } from '../interfaces/notification'
import type { SquareInternalConfig } from '../../config/site.config'
import { createLogger } from '../../lib/logger'

const logger = createLogger('square-capacity')

const SEARCH_URL = 'https://app.squareup.com/appointments/api/buyer/classes/class_schedule_instances/search'

const REQUIRED_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Origin: 'https://book.squareup.com',
  Referer: 'https://book.squareup.com/',
}

interface SquareClassScheduleInstance {
  capacity?: number
  available_capacity?: number
}

interface SquareSearchResponse {
  class_schedule_instances?: SquareClassScheduleInstance[]
}

export class SquareInternalCapacityProvider implements CapacityProvider {
  private readonly unitToken: string
  private readonly notification: NotificationProvider

  constructor(config: SquareInternalConfig, notification: NotificationProvider) {
    this.unitToken = config.unitToken
    this.notification = notification
  }

  async getAvailableCapacity(slotIds: string[]): Promise<Map<string, CapacityInfo | null>> {
    const results = new Map<string, CapacityInfo | null>()

    if (slotIds.length === 0) {
      return results
    }

    try {
      const response = await fetch(`${SEARCH_URL}?unit_token=${this.unitToken}`, {
        method: 'POST',
        headers: REQUIRED_HEADERS,
        body: JSON.stringify({
          query: {
            filter: {
              class_schedule_instance_ids: slotIds,
            },
          },
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data: SquareSearchResponse = await response.json()
      const instances = data.class_schedule_instances ?? []

      // Build a lookup from the response
      const instanceMap = new Map<string, SquareClassScheduleInstance>()
      for (const instance of instances) {
        // The API returns instances keyed by their ID; we match by position in the request
        // Since we batch all IDs, we need to match response instances to requested IDs
        // The response includes all matching instances
      }

      // For batched requests, map response instances back to slot IDs by index
      // Each instance in the response corresponds to a requested slot ID
      for (const slotId of slotIds) {
        const instance = instances.find((_inst, idx) => {
          // The API returns instances in the same order as requested IDs
          return slotIds.indexOf(slotId) === idx
        })

        if (
          instance &&
          typeof instance.capacity === 'number' &&
          typeof instance.available_capacity === 'number'
        ) {
          results.set(slotId, {
            slotId,
            totalCapacity: instance.capacity,
            availableCapacity: instance.available_capacity,
          })
          logger.info('Capacity fetched', {
            slotId,
            totalCapacity: instance.capacity,
            availableCapacity: instance.available_capacity,
            is_internal_api: true,
          })
        } else {
          results.set(slotId, null)
          logger.warn('No capacity data in response', { slotId, is_internal_api: true })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Capacity fetch failed', {
        slotIds,
        error: message,
        is_internal_api: true,
      })

      // Set all slots to null on batch failure
      for (const slotId of slotIds) {
        results.set(slotId, null)
      }

      // Send notification for the failure
      try {
        await this.notification.send({
          type: 'api-failure',
          title: 'Square Internal Capacity API Failure',
          details: {
            slotIds,
            error: message,
            is_internal_api: true,
          },
          severity: 'warning',
          timestamp: new Date().toISOString(),
        })
      } catch (notifyError) {
        logger.error('Failed to send failure notification', {
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
          is_internal_api: true,
        })
      }
    }

    return results
  }
}
