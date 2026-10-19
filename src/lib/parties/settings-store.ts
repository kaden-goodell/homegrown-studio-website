/**
 * Party settings the owners save in /admin › Parties setup: party times,
 * packages, extras and the Square read switch. One document (kv
 * `party-settings`, key `settings`), written compare-and-set, with the last
 * 50 changes kept (who, when, what, and what it was before). The same shape
 * as src/lib/studio-settings.ts.
 *
 * Until an owner first saves, there is no document and everything reads the
 * config (configPartySettings()): production behaves exactly as before.
 *
 * Remembered for 60 seconds per server instance; a save replaces it at once
 * on the instance that saved. Booking paths read `strict` (a read failure
 * throws: refuse, nothing charged); display reads fall back to the last good
 * answer, or the config.
 *
 * Never writes Square (R38). Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import type { By } from '@lib/staff-auth'
import { SettingsError } from '@lib/settings-error'
import { configPartySettings, describePartyChanges } from './party-times'
import type { PartySettings, PartySettingsInput } from './types'

const logger = createLogger('party-settings')
const kv = makeKvStore('party-settings', 'party-settings')
const KEY = 'settings'
const ATTEMPTS = 3
export const PARTY_SETTINGS_CACHE_MS = 60_000
export const PARTY_HISTORY_CAP = 50

let cached: { at: number; settings: PartySettings } | null = null

function parse(json: string): PartySettings {
  const s = JSON.parse(json) as PartySettings
  return { ...s, addOns: s.addOns ?? [], history: s.history ?? [] }
}

const inputOf = (s: PartySettingsInput): PartySettingsInput => ({
  times: s.times, packages: s.packages, addOns: s.addOns, readSquareBookings: s.readSquareBookings,
})

/**
 * The party settings in use: what's saved, or the config with `updatedAt:
 * null`. `strict` (booking paths) throws when the store can't be read;
 * otherwise the last good answer this server had, or the config (logged).
 * `fresh` skips the 60-second memory.
 */
export async function getPartySettings(opts: { strict?: boolean; fresh?: boolean } = {}): Promise<PartySettings> {
  const now = Date.now()
  if (cached && !opts.fresh && now - cached.at < PARTY_SETTINGS_CACHE_MS) return cached.settings
  try {
    const json = await kv.get(KEY)
    const settings = json ? parse(json) : configPartySettings()
    cached = { at: now, settings }
    return settings
  } catch (e) {
    logger.error('Party settings could not be read', { error: e instanceof Error ? e.message : String(e), strict: !!opts.strict })
    if (opts.strict) throw e
    return cached?.settings ?? configPartySettings()
  }
}

/** Forget the remembered answer (tests). */
export function resetPartySettingsCache(): void {
  cached = null
}

export class StalePartySettingsError extends SettingsError {
  constructor(public current: PartySettings) { super(409, 'Someone else changed the party settings. Check them and save again.') }
}

/**
 * Saves the owners' party settings (already checked by
 * validatePartySettings). `expectedUpdatedAt` is what they loaded (null when
 * they were looking at the config): anything else is refused as stale (409)
 * with the current settings. updatedAt only moves forward.
 */
export async function savePartySettings(
  input: PartySettingsInput,
  opts: { expectedUpdatedAt: string | null; by: By; now?: Date },
): Promise<{ saved: PartySettings; changed: string[] }> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { value, etag } = await kv.getWithMeta(KEY)
    const cur = value ? parse(value) : null
    if ((cur?.updatedAt ?? null) !== (opts.expectedUpdatedAt ?? null)) {
      throw new StalePartySettingsError(cur ?? configPartySettings())
    }
    const before = inputOf(cur ?? configPartySettings())
    const after = inputOf(input)
    const changed = describePartyChanges(before, after)
    const now = opts.now ?? new Date()
    // updatedAt only moves forward, so a stale guard can never match a later save by accident.
    const stamp = cur?.updatedAt && now.toISOString() <= cur.updatedAt ? new Date(Date.parse(cur.updatedAt) + 1).toISOString() : now.toISOString()
    const history = [{ at: stamp, by: opts.by, changed, before }, ...(cur?.history ?? [])].slice(0, PARTY_HISTORY_CAP)
    const saved: PartySettings = { ...after, updatedAt: stamp, by: opts.by, history }
    if (await kv.setIfMatch(KEY, JSON.stringify(saved), etag, value !== null)) {
      cached = { at: Date.now(), settings: saved }
      return { saved, changed }
    }
  }
  throw new SettingsError(503, 'Someone else is saving at the same moment. Try again.')
}
