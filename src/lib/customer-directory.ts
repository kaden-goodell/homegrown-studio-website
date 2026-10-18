/**
 * "Find a customer" on /staff Comp a seat (Kaden, 18 Oct 2026). Square's own
 * search only matches a whole email or phone, so the list is read once and
 * kept for a few minutes, and names match on any part.
 */
import { providers } from '@config/providers'
import type { Customer } from '@providers/interfaces/customer'

const CACHE_MS = 5 * 60_000
export const MAX_RESULTS = 8

let cache: { at: number; list: Customer[] } | null = null

/** The name-only customers made for a booking's 2nd, 3rd… seat. */
export function isGuestSeatCustomer(c: Customer): boolean {
  return /\((guest \d+ of \d+|with .+)\)$/.test(c.familyName ?? '')
}

/** Customers matching every word of `q` in their name, email or phone. Pure. */
export function searchCustomers(list: Customer[], q: string, limit = MAX_RESULTS): Customer[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const out: Customer[] = []
  for (const c of list) {
    if (isGuestSeatCustomer(c)) continue
    const text = `${c.givenName ?? ''} ${c.familyName ?? ''} ${c.email ?? ''}`.toLowerCase()
    const digits = (c.phone ?? '').replace(/\D/g, '')
    const hit = words.every((w) => text.includes(w) || (/^\d{3,}$/.test(w.replace(/\D/g, '')) && digits.includes(w.replace(/\D/g, ''))))
    if (hit) out.push(c)
    if (out.length >= limit) break
  }
  return out
}

export async function findCustomers(q: string, now = Date.now()): Promise<Customer[]> {
  if (!cache || now - cache.at > CACHE_MS) cache = { at: now, list: await providers.customer.listDirectory() }
  return searchCustomers(cache.list, q)
}

/** Tests only. */
export function clearDirectoryCache(): void {
  cache = null
}
