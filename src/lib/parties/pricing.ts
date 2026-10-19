/**
 * Party prices, worked out from the saved Parties setup (never from what a
 * browser sends). The quote's items are copies of the price at that moment:
 * once on a party they keep it, whatever the settings say later (S2-R13).
 *
 * Who may book what:
 * - 'everyone' packages: anyone.
 * - 'link' packages (the test package): owners, or a booking that names the
 *   package (/book?package=<id> → linkPackageId).
 * - 'admin' packages: owners only.
 * Extras not offered online are for owners only; 'public' and 'link'
 * audiences both book online.
 *
 * Pure and browser-safe: types only.
 */
import type { Cents, PartyAddOn, PartyPackage, PartySettings } from './types'
import type { PartyItem, PartyRecord } from '../party-store'

export interface PartyRequest { packageId?: string; guests: number; addOns?: Record<string, number> }
export type QuoteItem = Omit<PartyItem, 'id' | 'chargeId' | 'addedAt' | 'by'>
export interface PartyQuote { pkg: PartyPackage; minutes: number; items: QuoteItem[]; totalCents: Cents }
export type Audience = 'public' | 'link' | 'admin'

const PACKAGE_GONE = 'That party package isn’t available.'
const EXTRA_GONE = 'That extra isn’t available.'
export const WHOLE_STUDIO_PACKAGE_ID = 'pkg_whole'

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0

/** The package booked when none is named: the first open-to-everyone one. */
function defaultPackage(s: PartySettings): PartyPackage | undefined {
  return s.packages.find((p) => p.who === 'everyone' && !p.archived)
}

function mayBook(pkg: PartyPackage, audience: Audience, linkPackageId?: string): boolean {
  if (pkg.archived) return false
  if (pkg.who === 'everyone' || audience === 'admin') return true
  return pkg.who === 'link' && linkPackageId === pkg.id
}

function addOnItem(a: PartyAddOn, qty: number, guests: number): QuoteItem {
  const units = a.per === 'guest' ? qty * guests : qty
  return {
    kind: 'addon', refId: a.id, label: a.label, qty: units, unitCents: a.priceCents,
    cents: units * a.priceCents, extraMinutes: a.extraMinutes * qty,
  }
}

const tooMany = (a: PartyAddOn) => `You can add up to ${a.maxQty} ${a.label}.`

/**
 * The price and length of a party as asked. `addOns` maps an extra's id to
 * how many (per guest extras: 1 = one for every guest); 0 = none.
 */
export function quoteParty(
  s: PartySettings, req: PartyRequest, audience: Audience, linkPackageId?: string,
): { ok: true; value: PartyQuote } | { ok: false; error: string; field?: string } {
  const wanted = req.packageId ?? (audience !== 'admin' && linkPackageId ? linkPackageId : undefined)
  const pkg = wanted === undefined ? defaultPackage(s) : s.packages.find((p) => p.id === wanted)
  if (!pkg || !mayBook(pkg, audience, linkPackageId)) return { ok: false, error: PACKAGE_GONE, field: 'packageId' }

  const guests = req.guests
  if (!isCount(guests) || guests < pkg.minGuests || guests > pkg.maxGuests) {
    return { ok: false, error: `Parties are for ${pkg.minGuests} to ${pkg.maxGuests} guests.`, field: 'guests' }
  }

  const items: QuoteItem[] = [{
    kind: 'package', refId: pkg.id, label: pkg.name, qty: 1, unitCents: pkg.priceCents, cents: pkg.priceCents, extraMinutes: 0,
  }]
  for (const [id, qty] of Object.entries(req.addOns ?? {})) {
    const field = `addOns.${id}`
    const a = s.addOns.find((x) => x.id === id)
    if (!a || a.archived || (!a.online && audience !== 'admin')) return { ok: false, error: EXTRA_GONE, field }
    if (!isCount(qty)) return { ok: false, error: tooMany(a), field }
    if (qty === 0) continue
    if (qty > a.maxQty) return { ok: false, error: tooMany(a), field }
    items.push(addOnItem(a, qty, guests))
  }
  return {
    ok: true,
    value: {
      pkg,
      minutes: pkg.minutes + items.reduce((m, it) => m + it.extraMinutes, 0),
      items,
      totalCents: items.reduce((t, it) => t + it.cents, 0),
    },
  }
}

/** An extra an owner adds to a booked party of ours (any extra, online or not; per guest from its guest count). */
export function quoteAddOn(
  s: PartySettings, rec: PartyRecord, addOnId: string, qty: number,
): { ok: true; value: QuoteItem } | { ok: false; error: string } {
  if (rec.source !== 'ours') return { ok: false, error: 'This party was booked in Square. Change it there.' }
  if (rec.status === 'cancelled') return { ok: false, error: 'This party was cancelled.' }
  const a = s.addOns.find((x) => x.id === addOnId)
  if (!a || a.archived) return { ok: false, error: EXTRA_GONE }
  const have = (rec.items ?? []).filter((it) => it.kind === 'addon' && it.refId === a.id)
    .reduce((n, it) => n + (a.per === 'guest' ? Math.max(1, Math.round(it.qty / Math.max(1, rec.guestCount))) : it.qty), 0)
  if (!isCount(qty) || qty === 0 || have + qty > a.maxQty) return { ok: false, error: tooMany(a) }
  return { ok: true, value: addOnItem(a, qty, rec.guestCount) }
}

/**
 * Square order lines for party items: untaxed ad hoc lines (OWNER-1). The
 * whole-studio package keeps the name it has always had on orders and the tax
 * report ('Whole Studio Party — studio fee'); its extras share the prefix.
 * Other packages read 'Party — <name>'. The note is the package or extra id.
 * Pass `packageId` when the items don't include the package (extras paid later).
 */
export function orderLineItems(
  items: Pick<PartyItem, 'label' | 'qty' | 'unitCents' | 'refId' | 'kind'>[],
  pkgName: string,
  opts: { packageId?: string } = {},
): { name: string; quantity: number; pricePerUnit: Cents; note: string }[] {
  const pkgId = items.find((it) => it.kind === 'package')?.refId ?? opts.packageId
  const whole = pkgId === WHOLE_STUDIO_PACKAGE_ID
  const prefix = whole ? 'Whole Studio Party' : 'Party'
  return items.map((it) => ({
    name: it.kind === 'package'
      ? (whole ? 'Whole Studio Party — studio fee' : `Party — ${pkgName || it.label}`)
      : `${prefix} — ${it.label}`,
    quantity: it.qty,
    pricePerUnit: it.unitCents,
    note: it.refId,
  }))
}
