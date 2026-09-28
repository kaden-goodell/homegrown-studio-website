/**
 * The staff roster shown on the "Who's on the iPad?" picker — sourced from
 * Square's Team Members so staff don't have to be added twice. Falls back to
 * the two owners if Square is unreachable or the team list comes back empty,
 * so a Square outage never locks staff out of the console.
 */
import { createLogger } from '@lib/logger'
import { createSquareClient } from '@providers/square/client'
import { siteConfig } from '@config/site.config'
import type { SquareConfig } from '@config/site.config'
import type { StaffMember } from '@lib/staff-auth'

const logger = createLogger('staff-directory')
const CACHE_TTL_MS = 10 * 60 * 1000

const FALLBACK: StaffMember[] = [
  { id: 'kaden', name: 'Kaden', role: 'owner' },
  { id: 'catherine', name: 'Catherine', role: 'owner' },
]

let cache: { at: number; members: StaffMember[] } | null = null

/** @internal test-only: clear the cached roster. */
export function _resetStaffCache(): void {
  cache = null
}

/** Active Square team members as `{id, name, role}`, cached 10 minutes. */
export async function listStaff(): Promise<StaffMember[]> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.members

  try {
    const client = createSquareClient(siteConfig.providers.catalog.config as SquareConfig)
    const res: any = await client.teamMembers.search({ query: { filter: { status: 'ACTIVE' } } })
    const active = ((res.teamMembers ?? []) as any[]).filter((m) => m.status === 'ACTIVE')
    if (active.length === 0) throw new Error('Square returned no active team members')

    // Two staff sharing a given name ("Sam", "Sam") get a family initial
    // appended so the picker grid never shows two identical buttons.
    const givenCounts = new Map<string, number>()
    for (const m of active) givenCounts.set(m.givenName, (givenCounts.get(m.givenName) ?? 0) + 1)

    const members: StaffMember[] = active.map((m) => {
      const shared = (givenCounts.get(m.givenName) ?? 0) > 1
      const initial = String(m.familyName ?? '').trim().charAt(0)
      return {
        id: m.id,
        name: shared && initial ? `${m.givenName} ${initial}.` : m.givenName,
        role: m.isOwner ? 'owner' : 'crew',
      }
    })

    cache = { at: now, members }
    return members
  } catch (err) {
    logger.warn('Square team lookup failed — using fallback staff roster', {
      error: err instanceof Error ? err.message : String(err),
    })
    return FALLBACK
  }
}
