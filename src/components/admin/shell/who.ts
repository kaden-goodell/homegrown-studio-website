/** Who is using /admin on this device, remembered between visits (Catherine or Kaden). */
import { ownerOf, type Owner } from '@lib/admin-who'

const KEY = 'admin-who'

export function rememberedOwner(): Owner | null {
  try {
    return ownerOf(localStorage.getItem(KEY))
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
