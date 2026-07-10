import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

export const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: SquareEnvironment.Production,
})

export const LOCATION_ID = 'LTHCH1W1J3Y4Q'
export const JOB_TITLES = { assistant: 'Studio Assistant', crew: 'Studio Crew' } as const

const argv = process.argv.slice(2)
export const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
export const hasFlag = (n: string) => argv.includes(`--${n}`)

export async function getOrCreateJob(title: string): Promise<string> {
  let cursor: string | undefined
  do {
    const r: any = await client.team.listJobs({ cursor })
    const hit = (r.jobs ?? []).find((j: any) => j.title === title)
    if (hit) return hit.id
    cursor = r.cursor
  } while (cursor)
  const created: any = await client.team.createJob({
    idempotencyKey: `job-${title.toLowerCase().replace(/\s+/g, '-')}`,
    job: { title, isTipEligible: false },
  })
  console.log(`Created job "${title}" → ${created.job.id}`)
  return created.job.id
}

export async function findCrewMembers(): Promise<Array<{ id: string; name: string; email?: string }>> {
  const r: any = await client.teamMembers.search({
    query: { filter: { locationIds: [LOCATION_ID], status: 'ACTIVE' } },
    limit: 100,
  })
  const out: Array<{ id: string; name: string; email?: string }> = []
  for (const tm of r.teamMembers ?? []) {
    try {
      const ws: any = await client.teamMembers.wageSetting.get({ teamMemberId: tm.id })
      const jobs = ws.wageSetting?.jobAssignments ?? []
      if (jobs.some((j: any) => j.jobTitle === JOB_TITLES.crew)) {
        out.push({ id: tm.id, name: `${tm.givenName ?? ''} ${tm.familyName ?? ''}`.trim(), email: tm.emailAddress })
      }
    } catch { /* members with no wage setting are not crew */ }
  }
  return out
}
