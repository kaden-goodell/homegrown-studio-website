import { createLogger } from '../../lib/logger'

const logger = createLogger('square-classes')

export interface ClassInstance {
  id: string
  classScheduleId: string
  name: string
  description: string
  descriptionHtml: string
  startAt: string
  durationMinutes: number
  price: number
  currency: string
  availableCapacity: number
  staffName: string
  teamMemberId: string
}

// Square's buyer-facing classes API base URL
const CLASSES_API_BASE = 'https://app.squareup.com/appointments/api/buyer/classes'

function formatDateWithOffset(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0')
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}${sign}${hours}:${minutes}`
}

/**
 * Fetches scheduled class instances from Square's buyer-facing classes API.
 * This is a public, unauthenticated API used by Square's booking widget.
 * It returns class schedule instances with capacity, merged with class details.
 */
export async function getClassInstances(locationId: string): Promise<ClassInstance[]> {
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

  logger.info('Fetching class instances', { locationId })

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
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Classes API error', { status: response.status, error: errorText })
    throw new Error(`Square Classes API error: ${response.status}`)
  }

  const data = await response.json()

  // Build lookup map for class schedule details
  const scheduleMap = new Map<string, any>()
  for (const schedule of data.included_resources?.class_schedules ?? []) {
    scheduleMap.set(schedule.id, schedule)
  }

  const instances: ClassInstance[] = (data.class_schedule_instances ?? []).map((instance: any) => {
    const details = scheduleMap.get(instance.class_schedule_id) ?? {}
    return {
      id: instance.id,
      classScheduleId: instance.class_schedule_id,
      name: details.name ?? 'Unnamed Class',
      description: details.description ?? '',
      descriptionHtml: details.description_html ?? '',
      startAt: instance.start_at,
      durationMinutes: details.duration_minutes ?? 60,
      price: (details.price_amount ?? 0) / 100,
      currency: details.price_currency ?? 'USD',
      availableCapacity: instance.available_capacity ?? 0,
      staffName: details.staff_name ?? '',
      teamMemberId: details.team_member_id ?? '',
    }
  })

  instances.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())

  logger.info('Fetched class instances', { count: instances.length })
  return instances
}
