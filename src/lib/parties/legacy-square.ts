/**
 * Parties booked in Square before our own party book: READ ONLY.
 *
 * They keep holding their times on the shared schedule until they have run
 * (S2-R9). Nothing here writes Square: no create, cancel or update, ever.
 *
 *   legacyPartyBusy(from, to)  Square bookings at the location of the PARTY
 *                              SERVICE only (another service's booking is not a
 *                              party), as `Busy` with id = Square booking id.
 *                              [] without asking Square when the owners' switch
 *                              `readSquareBookings` is off, or on the sandbox
 *                              (it has no live party item), or with the mock
 *                              providers (no Square at all). Throws when Square
 *                              or the settings can't be read: a party time is
 *                              never offered unchecked.
 *   legacyRemaining(now)       future, non-cancelled Square parties, whatever
 *                              the switch says (Parties setup refuses to turn
 *                              the read off while any remain, S2-R27).
 *
 * Also home of `onSandbox`, `isNotFound` and `loadPartyVariationId` (were in
 * party-open-dates.ts, which re-exports them).
 */
import { partyDisplayName } from '@lib/parties/party-name'
import { providers } from '@config/providers'
import { siteConfig, type SquareConfig } from '@config/site.config'
import { partyConfig } from '@config/party.config'
import { createSquareClient } from '@providers/square/client'
import { partyName, partySpanOf } from '@lib/conflicts'
import { getPartyRecord } from '@lib/party-store'
import type { Busy } from '@lib/classes/studio-schedule'
import type { Booking } from '@providers/interfaces/booking'
import { getPartySettings } from './settings-store'

/** A Square "no such object" answer (404 / NOT_FOUND). */
export function isNotFound(err: unknown): boolean {
  const e = err as any
  if (e?.statusCode === 404 || e?.status === 404) return true
  return /not[ _]?found|404/i.test(err instanceof Error ? err.message : String(err))
}

/** True on the sandbox, which has none of the live-only catalog items. */
export function onSandbox(): boolean {
  return (siteConfig.providers?.catalog?.config as SquareConfig | undefined)?.environment === 'sandbox'
}

/** The mock providers (local dev without Square): no Square, so no Square-booked parties. */
function onMockProviders(): boolean {
  return (siteConfig.providers?.catalog as { type?: string } | undefined)?.type === 'mock'
}

/** The party service's variation id: what marks a booking as a party. '' on the sandbox. */
export async function loadPartyVariationId(): Promise<string> {
  const client = createSquareClient((siteConfig.providers?.catalog?.config ?? {}) as SquareConfig)
  let resp: unknown
  try {
    resp = await client.catalog.object.get({ objectId: partyConfig.square.catalogItemId })
  } catch (err) {
    // The sandbox has no live party item: that is "no party variation", not a failure.
    if (onSandbox() && isNotFound(err)) return ''
    throw err
  }
  const item = ((resp as any)?.object ?? resp) as any
  return item?.itemData?.variations?.[0]?.id ?? ''
}

// The variation id only changes when the Square item is rebuilt; asked again every 10 minutes.
const VARIATION_MS = 10 * 60_000
let variation: { until: number; id: string } | null = null

async function partyVariationId(): Promise<string> {
  if (variation && variation.until > Date.now()) return variation.id
  const id = await loadPartyVariationId()
  // Live, a party item with no variation means we can't tell a party from anything else: refuse.
  if (!id) throw new Error('The Square party service could not be found.')
  variation = { until: Date.now() + VARIATION_MS, id }
  return id
}

/** Forget the remembered variation id (tests). */
export function resetLegacySquareMemory(): void {
  variation = null
  customerNames.clear()
}

// Square lists bookings by START; a party that began before `from` can still be running.
const LOOK_BACK_MS = 12 * 60 * 60_000

/** Square words for a booking that isn't coming through the door: declined requests and no-shows. */
const NOT_COMING = new Set(['DECLINED', 'NO_SHOW'])

// Hosts' names from Square's customer list, remembered for 10 minutes (one lookup per host, not per screen load).
const CUSTOMER_NAME_MS = 10 * 60_000
const customerNames = new Map<string, { until: number; name: string }>()

/** "Jane Smith" from Square's customer record, or '' (no customer, not found, or Square didn't answer). */
async function squareCustomerName(customerId: string): Promise<string> {
  if (!customerId) return ''
  const hit = customerNames.get(customerId)
  if (hit && hit.until > Date.now()) return hit.name
  let name = ''
  try {
    const c = await providers.customer.getById(customerId)
    name = c ? `${c.givenName ?? ''} ${c.familyName ?? ''}`.trim() : ''
  } catch {
    return '' // only the label is lost; try again next time
  }
  if (customerNames.size > 500) customerNames.clear()
  customerNames.set(customerId, { until: Date.now() + CUSTOMER_NAME_MS, name })
  return name
}

/** The host's name for a Square booking: our record's, else (crew screens) Square's customer. */
async function hostNameOf(b: Booking, labels: boolean, fromSquare: boolean): Promise<string | undefined> {
  if (!labels) return undefined
  const ours = (await getPartyRecord(b.id).catch(() => null))?.hostName
  if (ours) return ours
  return fromSquare ? (await squareCustomerName(b.customerId)) || undefined : undefined
}

async function squareParties(fromIso: string, toIso: string, labels = true, staff = false): Promise<Busy[]> {
  if (!providers.booking.listBookings) throw new Error('This booking provider cannot list bookings.')
  const from = Date.parse(fromIso), to = Date.parse(toIso)
  const bookings = await providers.booking.listBookings({
    startDate: new Date(from - LOOK_BACK_MS).toISOString(),
    endDate: toIso,
    locationId: siteConfig.providers.booking.config.locationId || '',
  })
  // Crew screens also leave out declined requests and no-shows (nobody is coming).
  const live = bookings.filter((b) => b.status !== 'cancelled' && !(staff && NOT_COMING.has(b.squareStatus ?? '')))
  if (live.length === 0) return [] // nothing to sort: no catalog question
  const variationId = await partyVariationId()
  const parties = live.filter((b) => b.slot?.serviceVariationId === variationId)
  const spans = await Promise.all(
    // A missing record only costs the host's name on the label.
    parties.map(async (b) => partySpanOf(b, await hostNameOf(b, labels, staff))),
  )
  return spans
    .filter((p) => Date.parse(p.endIso) > from && Date.parse(p.startIso) < to)
    .map((p) => ({
      kind: 'party' as const,
      id: p.id,
      label: partyDisplayName({ hostName: p.hostName }),
      startIso: p.startIso,
      endIso: p.endIso,
      ...(p.hostName ? { hostName: p.hostName } : {}),
    }))
}

/** Square-booked parties overlapping [fromIso, toIso). See the file header. */
export async function legacyPartyBusy(fromIso: string, toIso: string, opts: { labels?: boolean } = {}): Promise<Busy[]> {
  const settings = await getPartySettings({ strict: true })
  if (!settings.readSquareBookings || onSandbox() || onMockProviders()) return []
  return squareParties(fromIso, toIso, opts.labels !== false)
}

/** Days ahead legacyRemaining looks: past any booking window Square ever took. */
const REMAINING_DAYS = 366

/** Future Square-booked parties still to run (end after `now`), switch or not. [] on the sandbox. */
export async function legacyRemaining(now: Date = new Date()): Promise<Busy[]> {
  if (onSandbox() || onMockProviders()) return []
  const to = new Date(now.getTime() + REMAINING_DAYS * 86_400_000)
  return squareParties(now.toISOString(), to.toISOString())
}

/**
 * Square-booked parties for the crew's screens (This week, Today, the door
 * list): every booked, not-cancelled party at the location overlapping the
 * range, whatever the owners' read switch says (a party Square still holds
 * is still coming through the door). [] on the sandbox and the mock
 * providers. Throws when Square can't be read; the caller says so in one line.
 */
export async function legacyStaffParties(fromIso: string, toIso: string): Promise<Busy[]> {
  if (onSandbox() || onMockProviders()) return []
  return squareParties(fromIso, toIso, true, true)
}

/**
 * One Square-booked party by its Square booking id (its roster on /staff), or
 * null: not a party, cancelled, declined, a no-show, not found, or no Square
 * here. Read only. The host's name comes from Square's customer when we hold
 * no record. Staff routes only (events.ts caches it): the public waiver page
 * never asks Square.
 */
export async function legacyStaffParty(id: string): Promise<Busy | null> {
  if (onSandbox() || onMockProviders() || id.startsWith('pty_')) return null
  let b
  try {
    b = await providers.booking.getBooking(id)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  if (!b || b.status === 'cancelled' || NOT_COMING.has(b.squareStatus ?? '')) return null
  if (b.slot?.serviceVariationId !== (await partyVariationId())) return null
  const p = partySpanOf(b, await hostNameOf(b, true, true))
  return { kind: 'party', id: p.id, label: partyDisplayName({ hostName: p.hostName }), startIso: p.startIso, endIso: p.endIso, ...(p.hostName ? { hostName: p.hostName } : {}) }
}
