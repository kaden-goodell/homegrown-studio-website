/** Who is using /admin on this device, remembered between visits, and the owners' names last heard from the server. */
import { OWNERS, ownerNameOf, type Owner } from '@lib/admin-who'

const KEY = 'admin-who'
const OWNERS_KEY = 'admin-owners'

export function rememberedOwner(): Owner | null {
  try {
    return ownerNameOf(localStorage.getItem(KEY))
  } catch {
    return null
  }
}

export function rememberOwner(owner: Owner): void {
  try {
    localStorage.setItem(KEY, owner)
  } catch {
    // private mode: it's asked again next time
  }
}

/** The owners' names this device last heard (for the sign-in picker); Catherine and Kaden before it ever heard. */
export function rememberedOwners(): Owner[] {
  try {
    const list = JSON.parse(localStorage.getItem(OWNERS_KEY) ?? 'null')
    const names = Array.isArray(list) ? list.map(ownerNameOf).filter((n): n is string => !!n) : []
    return names.length ? names : [...OWNERS]
  } catch {
    return [...OWNERS]
  }
}

export function rememberOwners(owners: Owner[]): void {
  try {
    localStorage.setItem(OWNERS_KEY, JSON.stringify(owners))
  } catch {
    // private mode
  }
}

/** The owners a server answer names, or null when it named none (an older server). */
export function ownersFrom(value: unknown): Owner[] | null {
  if (!Array.isArray(value)) return null
  const names = value.map(ownerNameOf).filter((n): n is string => !!n)
  return names.length ? names : null
}
