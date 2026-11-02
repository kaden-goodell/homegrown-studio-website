/**
 * The staff roster shown on the "Who's on the iPad?" picker — sourced from
 * Square's Team Members so staff don't have to be added twice. Falls back to
 * the two owners if Square is unreachable or the team list comes back empty,
 * so a Square outage never locks staff out of the console.
 *
 * Stage 3 (staffing) adds, server only:
 * - teamWithContacts(): the active team with email and phone, for telling a
 *   person they're on a shift. Contact details never leave the server in a
 *   crew response, and listStaff() never carries them.
 * - a last-known copy of the team (kv `staff-team`, key `team`), written when
 *   Square answers with a different list, so names and calendar-link checks
 *   survive a Square outage.
 * - isActiveStaffId(): the fallback ids 'kaden'/'catherine' are never a real
 *   person, so nothing is ever stored under them (a Square blip would
 *   otherwise split one person's data in two).
 * - staffIdForOwner(): /admin knows owners by name ('Catherine' | 'Kaden');
 *   this maps that name to the owner's team member id by given name.
 *
 * Read only towards Square (Team API search; no booking profiles, ever).
 */
import { createLogger } from '@lib/logger'
import { createSquareClient } from '@providers/square/client'
import { siteConfig } from '@config/site.config'
import type { SquareConfig } from '@config/site.config'
import type { StaffMember } from '@lib/staff-auth'
import type { Owner } from '@lib/admin-who'
import { makeKvStore } from '@lib/blob-store'
import { classWritesRefusal } from '@lib/classes/test-site-guard'

const logger = createLogger('staff-directory')
const CACHE_TTL_MS = 10 * 60 * 1000

const FALLBACK: StaffMember[] = [
  { id: 'kaden', name: 'Kaden', role: 'owner' },
  { id: 'catherine', name: 'Catherine', role: 'owner' },
]

/** The ids listStaff() answers with when Square can't be read. Never a real person: nothing is keyed by them. */
export const FALLBACK_IDS: ReadonlySet<string> = new Set(FALLBACK.map((m) => m.id))

/** A team member with their contact details. Server only. */
export interface StaffPerson extends StaffMember {
  /** Square's given name, for matching an /admin owner name (the display `name` may carry a family initial). */
  givenName: string
  email: string | null
  phone: string | null
  active: boolean
}

const teamKv = makeKvStore('staff-team', 'staff-team')
const TEAM_KEY = 'team'

let cache: { at: number; people: StaffPerson[] } | null = null

/** @internal test-only: clear the cached roster. */
export function _resetStaffCache(): void {
  cache = null
}

/** @internal test-only: forget the saved last-known team. */
export async function _resetLastKnownForTests(): Promise<void> {
  await teamKv.set(TEAM_KEY, 'null')
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

/** Active Square team members with contact details, cached 10 minutes. Throws when Square fails or lists nobody. */
async function squareTeam(): Promise<StaffPerson[]> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.people

  const client = createSquareClient(siteConfig.providers.catalog.config as SquareConfig)
  const res: any = await client.teamMembers.search({ query: { filter: { status: 'ACTIVE' } } })
  const active = ((res.teamMembers ?? []) as any[]).filter((m) => m.status === 'ACTIVE')
  if (active.length === 0) throw new Error('Square returned no active team members')

  // Two staff sharing a given name ("Sam", "Sam") get a family initial
  // appended so the picker grid never shows two identical buttons.
  const givenCounts = new Map<string, number>()
  for (const m of active) givenCounts.set(m.givenName, (givenCounts.get(m.givenName) ?? 0) + 1)

  const people: StaffPerson[] = active.map((m) => {
    const shared = (givenCounts.get(m.givenName) ?? 0) > 1
    const initial = String(m.familyName ?? '').trim().charAt(0)
    return {
      id: m.id,
      name: shared && initial ? `${m.givenName} ${initial}.` : m.givenName,
      givenName: String(m.givenName ?? ''),
      role: m.isOwner ? 'owner' : 'crew',
      email: text(m.emailAddress),
      phone: text(m.phoneNumber),
      active: true,
    }
  })

  cache = { at: now, people }
  // Once per 10 minutes at most (the cache above); never throws.
  await rememberTeam(people)
  return people
}

/** The saved last-known team, or null. Throws only when the store itself fails. */
async function lastKnown(): Promise<StaffPerson[] | null> {
  const json = await teamKv.get(TEAM_KEY)
  if (!json) return null
  const saved = JSON.parse(json) as { at: string; people: StaffPerson[] } | null
  return saved && Array.isArray(saved.people) && saved.people.length > 0 ? saved.people : null
}

const sameTeam = (a: StaffPerson[], b: StaffPerson[]): boolean => {
  const norm = (l: StaffPerson[]) => JSON.stringify([...l].sort((x, y) => x.id.localeCompare(y.id)))
  return norm(a) === norm(b)
}

/**
 * Saves the team as the last-known copy when it differs from what's saved.
 * Never on a test site that shares the live stores (R41: a sandbox team must
 * not replace the live one). Compare-and-set; a lost race means someone else
 * just saved a fresh copy, which is fine. Failures are logged, never thrown.
 */
async function rememberTeam(people: StaffPerson[]): Promise<void> {
  if (classWritesRefusal()) return
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { value, etag } = await teamKv.getWithMeta(TEAM_KEY)
      const saved = value ? (JSON.parse(value) as { people?: StaffPerson[] } | null) : null
      if (saved?.people && sameTeam(saved.people, people)) return
      const json = JSON.stringify({ at: new Date().toISOString(), people })
      if (await teamKv.setIfMatch(TEAM_KEY, json, etag, value !== null)) return
    }
  } catch (err) {
    logger.warn('Could not save the last-known team', { error: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * Server only. The active team with contact details. `source: 'square'` when
 * Square answered; 'last-known' when Square failed and a saved copy exists;
 * throws when neither (callers show an error, never an empty team).
 */
export async function teamWithContacts(): Promise<{ people: StaffPerson[]; source: 'square' | 'last-known' }> {
  try {
    return { people: await squareTeam(), source: 'square' }
  } catch (err) {
    const saved = await lastKnown()
    if (saved) {
      logger.warn('Square team lookup failed — using the last-known team', {
        error: err instanceof Error ? err.message : String(err),
      })
      return { people: saved, source: 'last-known' }
    }
    throw new Error("Couldn't read the team list from Square, and there's no saved copy.")
  }
}

/** Active Square team members as `{id, name, role}`, cached 10 minutes. */
export async function listStaff(): Promise<StaffMember[]> {
  try {
    return (await squareTeam()).map((p) => ({ id: p.id, name: p.name, role: p.role }))
  } catch (err) {
    logger.warn('Square team lookup failed — using fallback staff roster', {
      error: err instanceof Error ? err.message : String(err),
    })
    return FALLBACK
  }
}

/**
 * True only for an id on the current (or last-known) ACTIVE team. The
 * fallback ids are never real; a team that can't be read at all answers false.
 */
export async function isActiveStaffId(id: string): Promise<boolean> {
  if (typeof id !== 'string' || !id || FALLBACK_IDS.has(id)) return false
  try {
    const { people } = await teamWithContacts()
    return people.some((p) => p.id === id && p.active)
  } catch {
    return false
  }
}

/** The team member an /admin owner name is, by given name among owners; null when not found, ambiguous, or the team can't be read. */
export async function staffIdForOwner(owner: Owner): Promise<string | null> {
  let people: StaffPerson[]
  try {
    people = (await teamWithContacts()).people
  } catch {
    return null
  }
  const want = owner.trim().toLowerCase()
  const hits = people.filter((p) => p.role === 'owner' && p.active && p.givenName.trim().toLowerCase() === want)
  return hits.length === 1 ? hits[0].id : null
}
