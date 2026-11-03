/**
 * What the /admin party sheets share: the owner-only party routes, the shapes
 * they answer with, and small loaders (Parties setup, the party crafts, the
 * free party times). Browser code: server modules are imported for their
 * types only.
 */
import { partyDisplayName } from '@lib/parties/party-name'
import { useEffect, useState } from 'react'
import type { AdminParty, AdminPartyGuest } from '@pages/api/admin/party.json'
import type { HostToTell, SendDetailsOffer } from '@lib/parties/admin-actions'
import type { PartySettings } from '@lib/parties/types'
import { localDate } from '@lib/party-slots'
import { api, PARTY } from '../classes/api'
import { addDays, today } from '../classes/dates'
import { useRefresh } from '../shell/data'

export const PARTY_SETTINGS = '/api/admin/parties/settings.json'
export const PARTY_TIMES = '/api/admin/parties/times.json'
export const PARTY_BOOK = '/api/admin/parties/book.json'
export const PARTY_ACTIONS = '/api/admin/parties/actions.json'
export const PARTY_REFUND = '/api/admin/parties/refund.json'
export const SERVICE_INFO = '/api/party/service-info.json'

export type { AdminParty, AdminPartyGuest, HostToTell, SendDetailsOffer }

/** A party craft from the catalog (priced per guest, paid at the studio). */
export interface PartyCraft { id: string; name: string; perHeadCents: number; perHeadMaxCents: number }

/** Parties still booked in Square: how many are to come, and when the last is. Null when Square couldn't be asked. */
/** Parties still booked in Square. `off`: the read is switched off, so Square isn't asked any more. Null: Square couldn't be asked. */
export type LegacyRemaining = { count: number; lastIso: string | null; off?: true } | null

/** A fresh key for one create or one tap (the server's CREATE_KEY_RE: 8–80 letters, digits, - and _). */
export function newKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  return c?.randomUUID ? c.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
}

/** "Stefanie" from "Stefanie Justice". */
export const firstOf = (name: string) => name.trim().split(/\s+/)[0] || 'the host'

/** "Justice party · Tote Bags": the one party name on every screen (UI review, 3 Nov). */
export function partyTitle(hostName: string, craftName?: string | null): string {
  return partyDisplayName({ hostName, craftName })
}

/** "14 guests · Waiting on payment" and friends: the words for a party's money state (never colour alone). */
export const STATE_WORDS: Record<AdminParty['paymentState'], string> = {
  waiting: 'Waiting on payment',
  partly: 'Part paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
  legacy: 'Booked in Square',
}

/** Parties setup as saved (or the config until it's first saved). Loads on its own; `reload` after a save elsewhere. */
export function usePartySettings() {
  const { version } = useRefresh()
  const [state, setState] = useState<{ settings: PartySettings; legacy: LegacyRemaining } | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    api<{ settings: PartySettings; legacyRemaining: LegacyRemaining }>(PARTY_SETTINGS).then((r) => {
      if (!live) return
      if (r.ok && r.data) setState({ settings: r.data.settings, legacy: r.data.legacyRemaining })
      else setError(r.error ?? 'Parties setup didn’t load.')
    })
    return () => { live = false }
  }, [version, tries])
  return { settings: state?.settings ?? null, legacy: state?.legacy ?? null, loaded: !!state, error, retry: () => setTries((n) => n + 1), replace: (s: PartySettings, legacy?: LegacyRemaining) => setState((cur) => ({ settings: s, legacy: legacy === undefined ? cur?.legacy ?? null : legacy })) }
}

/** The party crafts from the catalog (Square). */
export function useCrafts() {
  const [crafts, setCrafts] = useState<PartyCraft[] | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    api<{ crafts: PartyCraft[] }>(SERVICE_INFO).then((r) => {
      if (!live) return
      if (r.ok && r.data) setCrafts(r.data.crafts)
      else setError(r.ok ? 'The party crafts didn’t load.' : r.error ?? 'The party crafts didn’t load.')
    })
    return () => { live = false }
  }, [tries])
  return { crafts, error, retry: () => setTries((n) => n + 1) }
}

export interface PartyTimes {
  /** the party's length the times were judged for */
  minutes: number
  /** party times set on those days (closed days and the café gap already out) */
  offered: string[]
  /** of those, the ones nothing is in the way of */
  open: string[]
}

/**
 * The party times on studio days `from`..`to` (both included) and which are
 * free, for owners (no notice, no window; never past). `exclude` = a party
 * being moved (it doesn't block itself). Null while loading.
 */
export function usePartyTimes(q: { from: string; to: string; packageId?: string; addOns?: Record<string, number>; exclude?: string } | null) {
  const { version } = useRefresh()
  const [times, setTimes] = useState<PartyTimes | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const key = q ? JSON.stringify(q) : ''
  useEffect(() => {
    if (!q) { setTimes(null); return }
    let live = true
    setError('')
    setTimes(null)
    const p = new URLSearchParams({ from: q.from, to: q.to })
    if (q.packageId) p.set('packageId', q.packageId)
    const adds = Object.entries(q.addOns ?? {}).filter(([, n]) => n > 0).map(([id, n]) => `${id}:${n}`).join(',')
    if (adds) p.set('addOns', adds)
    if (q.exclude) p.set('exclude', q.exclude)
    api<PartyTimes>(`${PARTY_TIMES}?${p}`).then((r) => {
      if (!live) return
      if (r.ok && r.data) setTimes(r.data)
      else setError(r.error ?? 'The party times didn’t load.')
    })
    return () => { live = false }
  }, [key, version, tries])
  return { times, error, retry: () => setTries((n) => n + 1) }
}

/** The next eight weeks of party times, from today. */
export const timesWindow = () => ({ from: today(), to: addDays(today(), 56) })

/** Starts (UTC ISO) by studio day, earliest first. */
export function byStudioDay(starts: string[]): [string, string[]][] {
  const m = new Map<string, string[]>()
  for (const s of [...starts].sort()) m.set(localDate(s), [...(m.get(localDate(s)) ?? []), s])
  return [...m.entries()]
}

/** One party for its sheet, with who said yes. */
export function useParty(id: string) {
  const { version } = useRefresh()
  const [info, setInfo] = useState<{ party: AdminParty | null; guests: AdminPartyGuest[] | null } | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    api<{ party: AdminParty | null; guests: AdminPartyGuest[] | null }>(`${PARTY}?id=${encodeURIComponent(id)}`).then((r) => {
      if (!live) return
      if (r.ok && r.data) setInfo(r.data)
      else setError(r.error ?? 'The party didn’t load.')
    })
    return () => { live = false }
  }, [id, version, tries])
  return { info, error, reload: () => setTries((n) => n + 1), setParty: (party: AdminParty) => setInfo((cur) => {
    // An action's reply: the party as saved, shown at once (the reload follows). Fields only the GET adds are kept.
    const was = cur?.party ?? null
    return {
      guests: cur?.guests ?? null,
      party: {
        ...party,
        refundRequests: party.refundRequests ?? was?.refundRequests ?? [],
        holdState: party.holdState !== undefined ? party.holdState : (was?.holdState ?? null),
        payUrl: party.dueCents > 0 && party.status !== 'cancelled' ? (party.payUrl ?? was?.payUrl ?? null) : null,
      },
    }
  }) }
}
