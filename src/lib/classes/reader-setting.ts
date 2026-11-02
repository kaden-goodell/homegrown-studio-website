/**
 * Charge on the reader, on or off (the bus-factor rule: Catherine can flip it
 * in /admin › More › Register setup, not only in the Netlify settings).
 *
 * Stored in the studio-settings store under its own key ('reader'),
 * compare-and-set, with the last 50 changes kept. Until an owner saves, it
 * follows READER_ENABLED ('true' = on; anything else, off). The Square
 * application id the app's return is registered on (SQUARE_POS_CLIENT_ID)
 * stays site config: it comes from Square's developer screen together with the
 * return addresses, so it isn't something to type in /admin. Without it the
 * option says so in plain words and the other ways to pay stay.
 *
 * Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import { assertClassWritesAllowed } from './test-site-guard'

const kv = makeKvStore('studio-settings', 'studio-settings')
const KEY = 'reader'
const HISTORY_CAP = 50

export interface ReaderSettingDoc {
  enabled: boolean
  updatedAt: string
  by: By
  history: { at: string; by: By; enabled: boolean }[]
}

export interface ReaderStatus {
  /** an owner (or READER_ENABLED) turned it on */
  on: boolean
  /** the Square app link can be made (SQUARE_POS_CLIENT_ID is set) */
  linked: boolean
  /** 'saved' = set in /admin; 'site' = READER_ENABLED */
  source: 'saved' | 'site'
  updatedAt: string | null
  by: By | null
  /** plain words when it is on but can't be used, else null */
  message: string | null
}

/** Said on /staff and /admin when it's turned on but the website isn't linked to the Square app. */
export const READER_NOT_LINKED = 'Charge on the reader isn’t linked to the Square app yet, so it can’t be used. Pay on the iPad and Pay at the counter still work.'

export class StaleReaderSettingError extends Error {
  constructor() { super('Someone else changed this just now. Check it and try again.') }
}

function env(name: string): string {
  const e: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return String(e[name] || (typeof process !== 'undefined' ? process.env[name] : '') || '').trim()
}

/** The Square application id for the POS API (empty when not set). */
export const readerClientId = () => env('SQUARE_POS_CLIENT_ID')

async function readDoc(): Promise<{ doc: ReaderSettingDoc | null; etag: string | null; exists: boolean }> {
  const { value, etag } = await kv.getWithMeta(KEY)
  return { doc: value ? (JSON.parse(value) as ReaderSettingDoc) : null, etag, exists: value !== null }
}

/** On or off, linked or not. A store we can't read counts as off (nothing is charged on a guess). */
export async function readerStatus(): Promise<ReaderStatus> {
  let doc: ReaderSettingDoc | null = null
  try {
    doc = (await readDoc()).doc
  } catch {
    return { on: false, linked: !!readerClientId(), source: 'site', updatedAt: null, by: null, message: 'Charge on the reader couldn’t be checked just now. Use Pay on the iPad or Pay at the counter.' }
  }
  const on = doc ? doc.enabled : env('READER_ENABLED') === 'true'
  const linked = !!readerClientId()
  return {
    on, linked, source: doc ? 'saved' : 'site', updatedAt: doc?.updatedAt ?? null, by: doc?.by ?? null,
    message: on && !linked ? READER_NOT_LINKED : null,
  }
}

/** Turns it on or off. `expectedUpdatedAt` is what the screen loaded (null = nothing saved yet). */
export async function saveReaderSetting(enabled: boolean, by: By, expectedUpdatedAt: string | null, now = new Date()): Promise<ReaderStatus> {
  assertClassWritesAllowed()
  const { doc, etag, exists } = await readDoc()
  if ((doc?.updatedAt ?? null) !== expectedUpdatedAt) throw new StaleReaderSettingError()
  const at = now.toISOString()
  const next: ReaderSettingDoc = {
    enabled, updatedAt: at, by,
    history: [{ at, by, enabled }, ...(doc?.history ?? [])].slice(0, HISTORY_CAP),
  }
  if (!(await kv.setIfMatch(KEY, JSON.stringify(next), etag, exists))) throw new StaleReaderSettingError()
  return readerStatus()
}
