import { client, LOCATION_ID, JOB_TITLES, flag, hasFlag, getOrCreateJob } from './square-helpers'

/**
 * Create a payroll/clock-in team member. Deliberately does NOT touch
 * Square Appointments — new members stay non-bookable, which keeps
 * Kaden's availability-blocking model intact.
 *
 * Usage:
 *   npx tsx scripts/team/add-team-member.ts --given Jess --family Reeves \
 *     --email jess@example.com --phone "+12565550100" --job crew --wage 7.25
 */

const given = flag('given'), family = flag('family'), email = flag('email'), phone = flag('phone')
const jobKey = flag('job') as keyof typeof JOB_TITLES | undefined
const wage = flag('wage')

if (!given || !family || !email || !jobKey || !JOB_TITLES[jobKey] || wage == null) {
  console.error('Usage: add-team-member.ts --given <first> --family <last> --email <email> [--phone +1...] --job crew|assistant --wage <dollarsPerHour> [--dry-run]')
  process.exit(1)
}
const cents = Math.round(Number(wage) * 100)
if (!Number.isFinite(cents) || cents < 725) {
  console.error(`--wage "${wage}" is invalid or below federal minimum ($7.25)`)
  process.exit(1)
}
const jobTitle = JOB_TITLES[jobKey]

async function main() {
  if (hasFlag('dry-run')) {
    console.log(`DRY RUN — would create ${given} ${family} <${email}> as ${jobTitle} @ $${wage}/hr`)
    return
  }
  const created: any = await client.teamMembers.create({
    idempotencyKey: `tm-${email}`,
    teamMember: {
      givenName: given, familyName: family, emailAddress: email,
      ...(phone ? { phoneNumber: phone } : {}),
      status: 'ACTIVE',
      assignedLocations: { assignmentType: 'EXPLICIT_LOCATIONS', locationIds: [LOCATION_ID] },
    },
  })
  const tm = created.teamMember
  console.log(`Created team member ${tm.id} (${tm.givenName} ${tm.familyName})`)

  await getOrCreateJob(jobTitle) // ensure the job exists with this exact title
  const ws: any = await client.teamMembers.wageSetting.update({
    teamMemberId: tm.id,
    wageSetting: {
      teamMemberId: tm.id,
      jobAssignments: [{
        jobTitle,
        payType: 'HOURLY',
        hourlyRate: { amount: BigInt(cents), currency: 'USD' },
      }],
      isOvertimeExempt: false,
    },
  })
  console.log(`Wage set: ${jobTitle} @ $${(cents / 100).toFixed(2)}/hr (wage setting v${ws.wageSetting?.version})`)
  console.log('\nNEXT (dashboard, Kaden): Staff → Team → invite to the Square Team app; set a POS passcode.')
  console.log('Do NOT enable this person in Appointments — they must stay non-bookable.')
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1) })
