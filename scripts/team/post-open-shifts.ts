import { client, LOCATION_ID, JOB_TITLES, flag, hasFlag, getOrCreateJob } from './square-helpers'
import { cutSlots, nextMonday, chicagoToday } from '../../src/lib/crew/slots'

/**
 * Publish the week's "Studio Crew" open shifts so moms can claim them in
 * the Square Team app (they tap Request; Kaden approves the push).
 * Run weekly: npx tsx scripts/team/post-open-shifts.ts
 */

const weekArg = flag('week') ?? 'next'
const week = weekArg === 'next' ? nextMonday(chicagoToday()) : weekArg
if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
  console.error(`--week must be YYYY-MM-DD (a Monday) or "next", got "${weekArg}"`)
  process.exit(1)
}
const copies = Number(flag('copies') ?? 1)

async function main() {
  const slots = cutSlots(week)
  console.log(`Week of ${week}: ${slots.length} template slots × ${copies} cop${copies === 1 ? 'y' : 'ies'}`)

  const taken = new Map<string, number>()
  let cursor: string | undefined
  do {
    const existing: any = await client.labor.searchScheduledShifts({
      query: {
        filter: {
          locationIds: [LOCATION_ID],
          start: { startAt: slots[0].startAt, endAt: slots[slots.length - 1].endAt },
        },
      },
      limit: 50, // API max
      cursor,
    })
    for (const s of existing.scheduledShifts ?? []) {
      const d = s.draftShiftDetails ?? {}
      if (d.isDeleted) continue
      const k = `${d.startAt}|${d.endAt}`
      taken.set(k, (taken.get(k) ?? 0) + 1)
    }
    cursor = existing.cursor
  } while (cursor)

  const jobId = await getOrCreateJob(JOB_TITLES.crew)
  const createdIds: string[] = []
  for (const slot of slots) {
    const have = taken.get(`${slot.startAt}|${slot.endAt}`) ?? 0
    const need = Math.max(0, copies - have)
    if (need === 0) { console.log(`  = ${slot.label} — already posted (${have})`); continue }
    for (let i = 0; i < need; i++) {
      if (hasFlag('dry-run')) { console.log(`  + ${slot.label} (DRY RUN)`); continue }
      const r: any = await client.labor.createScheduledShift({
        idempotencyKey: `open-${week}-${slot.startAt}-${i}`,
        scheduledShift: {
          draftShiftDetails: {
            locationId: LOCATION_ID,
            jobId,
            startAt: slot.startAt,
            endAt: slot.endAt,
            notes: 'Studio Crew open shift — claim in the Team app',
            // no teamMemberId → this is an OPEN shift
          },
        },
      })
      createdIds.push(r.scheduledShift.id)
      console.log(`  + ${slot.label} → ${r.scheduledShift.id}`)
    }
  }

  if (createdIds.length && !hasFlag('dry-run')) {
    const shifts: Record<string, { version?: number }> = {}
    for (const id of createdIds) shifts[id] = {}
    await client.labor.bulkPublishScheduledShifts({
      scheduledShifts: shifts,
      scheduledShiftNotificationAudience: 'AFFECTED',
    })
    console.log(`Published ${createdIds.length} open shifts. Moms can now claim them in the Team app.`)
  } else if (!createdIds.length) {
    console.log('Nothing new to publish.')
  }
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1) })
