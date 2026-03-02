import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:workshops:availability')
  const startTime = Date.now()

  try {
    const body = await request.json()
    const { startDate, endDate, eventTypeId } = body

    const slots = await providers.booking.searchAvailability({
      startDate,
      endDate,
      locationId: 'default',
    })

    const slotIds = slots.map(s => s.id)
    const capacityMap = await providers.capacity.getAvailableCapacity(slotIds)

    const slotsWithCapacity = slots
      .map(slot => ({
        ...slot,
        capacity: capacityMap.get(slot.id) ?? null,
      }))
      .filter(slot => {
        if (slot.capacity === null) return true
        return slot.capacity.availableCapacity > 0
      })

    logger.info('Workshop availability fetched', {
      duration_ms: Date.now() - startTime,
      eventTypeId,
      startDate,
      endDate,
      totalSlots: slots.length,
      availableSlots: slotsWithCapacity.length,
    })

    return new Response(JSON.stringify({ data: slotsWithCapacity }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Failed to fetch workshop availability', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })

    await providers.notification.send({
      type: 'api-failure',
      title: 'Workshop availability fetch failed',
      details: { route: 'workshops/availability', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })

    return new Response(JSON.stringify({ error: 'Unable to check availability' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
