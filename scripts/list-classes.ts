import 'dotenv/config'

const locationId = process.env.SQUARE_LOCATION_ID!

const now = new Date()
const endDate = new Date()
endDate.setFullYear(endDate.getFullYear() + 1)

function formatDateWithOffset(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0')
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}${sign}${hours}:${minutes}`
}

async function main() {
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
    `https://app.squareup.com/appointments/api/buyer/classes/class_schedule_instances/search?unit_token=${locationId}`,
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

  const data = await response.json()

  console.log('=== CLASS SCHEDULE INSTANCES ===')
  console.log(JSON.stringify(data.class_schedule_instances?.length ?? 0) + ' instances\n')

  // Print raw class schedules
  console.log('=== CLASS SCHEDULES (included_resources) ===')
  for (const sched of data.included_resources?.class_schedules ?? []) {
    console.log(JSON.stringify(sched, null, 2))
    console.log()
  }

  // Print first few instances
  console.log('=== FIRST 3 INSTANCES ===')
  for (const inst of (data.class_schedule_instances ?? []).slice(0, 3)) {
    console.log(JSON.stringify(inst, null, 2))
    console.log()
  }
}

main().catch(console.error)
