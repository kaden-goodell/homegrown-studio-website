/**
 * The shared studio iPad's hand-off to a family (crew review C1).
 *
 * "Sign on this iPad" sets a flag in this tab's sessionStorage before it
 * leaves /staff; the signing page's own hand-back (WaiverFlow.kioskReturn)
 * clears it. So if /staff ever shows up again while the flag is still set,
 * the family got there some other way (a Back swipe, the Back button, a
 * restored page) and /staff covers itself until a crew member taps through.
 */
export const KIOSK_OUT_KEY = 'hg_kioskOut'

export function markKioskOut(): void {
  try { sessionStorage.setItem(KIOSK_OUT_KEY, '1') } catch { /* storage off: the replace() still drops /staff from history */ }
}

export function clearKioskOut(): void {
  try { sessionStorage.removeItem(KIOSK_OUT_KEY) } catch { /* ignore */ }
}

export function kioskOutPending(): boolean {
  try { return sessionStorage.getItem(KIOSK_OUT_KEY) === '1' } catch { return false }
}
