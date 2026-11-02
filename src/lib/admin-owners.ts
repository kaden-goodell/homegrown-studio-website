/**
 * Who the owners are, for /admin (G4): the people marked **Owner** on the
 * staff list (More › Staff › People) who still work here. Adding an owner,
 * making one Crew, or marking one "No longer working here" there is how the
 * owners change; nothing else holds the names.
 *
 * Until a staff list has been saved, the bootstrap owners (Catherine and
 * Kaden, admin-who OWNERS) apply exactly as before. When the saved list can't
 * be read for a moment, the last list this server read is used, and only with
 * none at all the bootstrap names (an audit label at worst: owner names never
 * open anything by themselves, the admin passcode does).
 *
 * Server only.
 */
import { OWNERS, ownerOf, type Owner } from '@lib/admin-who'
import { createLogger } from '@lib/logger'
import { savedOwners, type StaffPerson } from '@lib/staff-directory'

const logger = createLogger('admin-owners')

export interface OwnerEntry {
  /** The staff list id, or null for a bootstrap owner (no list yet). */
  id: string | null
  name: Owner
  email: string | null
  phone: string | null
}

export interface OwnerList {
  owners: OwnerEntry[]
  /** 'staff-list': from More › Staff › People; 'bootstrap': no staff list yet, so Catherine and Kaden. */
  source: 'staff-list' | 'bootstrap'
  /** True when the list couldn't be read just now and an older answer is shown. */
  stale: boolean
}

const BOOTSTRAP: OwnerList = { owners: OWNERS.map((name) => ({ id: null, name, email: null, phone: null })), source: 'bootstrap', stale: false }

const entry = (p: StaffPerson): OwnerEntry => ({ id: p.id, name: p.name, email: p.email, phone: p.phone })

/** The owners now. Never throws. */
export async function ownerList(): Promise<OwnerList> {
  try {
    const people = await savedOwners()
    if (!people) return BOOTSTRAP
    // A saved list always keeps at least one owner (the staff list refuses removing the last), but never answer with nobody.
    if (people.length === 0) return BOOTSTRAP
    return { owners: people.map(entry), source: 'staff-list', stale: false }
  } catch (err) {
    logger.warn('Owner list unreadable — using the bootstrap owners', { error: err instanceof Error ? err.message : String(err) })
    return { ...BOOTSTRAP, stale: true }
  }
}

/** The owners' names, for the "Who's using this?" picker. */
export async function ownerNames(): Promise<Owner[]> {
  return (await ownerList()).owners.map((o) => o.name)
}

/** The owner a value (an X-Admin-Who header) names, as the list spells it, or null when it isn't an owner now. */
export async function resolveOwner(value: unknown): Promise<OwnerEntry | null> {
  const { owners } = await ownerList()
  const name = ownerOf(value, owners.map((o) => o.name))
  return name ? owners.find((o) => o.name === name) ?? null : null
}

/**
 * Whether a name is an owner now: 'yes', 'no', or 'unknown' when the staff
 * list can't be read and this server has no copy (a calendar link then asks
 * to try again rather than stop).
 */
export async function ownerStatus(value: unknown): Promise<'yes' | 'no' | 'unknown'> {
  const list = await ownerList()
  if (list.stale) return 'unknown'
  return ownerOf(value, list.owners.map((o) => o.name)) ? 'yes' : 'no'
}
