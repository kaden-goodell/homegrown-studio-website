/**
 * The online booking switch the owners flip in /admin › More › Online booking
 * (bus factor: Catherine can pause or open booking without the hosting
 * dashboard or a redeploy). One document in kv `site-switches`:
 *   - per kind (parties, workshops = classes & workshops, kits): open or paused
 *   - a short pause note the closed booking panels show (blank = the default)
 *   - the test link's secret (`?preview=<secret>` unlocks booking on one device)
 * written compare-and-set, with the last 50 changes kept (who, when, what).
 *
 * Until an owner first saves, there is no document and the BOOKINGS_OPEN and
 * PREVIEW_TOKEN settings apply exactly as before. Once saved, the document
 * wins over both. Every booking path asks through bookings-gate.ts, which
 * reads this at request time (remembered for 30 seconds per server instance;
 * a save replaces it at once on the instance that saved), so no redeploy.
 *
 * Server only.
 */
import { randomBytes } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { assertClassWritesAllowed } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import { SettingsError } from '@lib/settings-error'
import type { By } from '@lib/staff-auth'
import { siteConfig } from '@config/site.config'

const logger = createLogger('booking-switch')
const kv = makeKvStore('site-switches', 'site-switches')
const KEY = 'switches'
const ATTEMPTS = 3
export const SWITCH_CACHE_MS = 30_000
export const SWITCH_HISTORY_CAP = 50
export const PAUSE_NOTE_MAX = 140

/** The kinds the owners switch. ('other', the hidden older flows, stays with BOOKINGS_OPEN.) */
export type SwitchKind = 'parties' | 'workshops' | 'kits'
export const SWITCH_KINDS: SwitchKind[] = ['parties', 'workshops', 'kits']
export const KIND_NAME: Record<SwitchKind, string> = { parties: 'Parties', workshops: 'Classes & workshops', kits: 'Take-home kits' }

/** What customers read while a kind is paused and no note was written. */
export function defaultPauseNote(): string {
  return `Online booking is paused for now. Call or text us at ${siteConfig.contactPhone} and we’ll get you set up.`
}

export interface SwitchChange {
  at: string
  by: By
  /** In the owner's words: "Paused parties", "Opened classes & workshops", "Changed the pause note", "Made a new test link". */
  changed: string[]
}

export interface SwitchDoc {
  v: 1
  open: Record<SwitchKind, boolean>
  /** '' = the default note. */
  pauseNote: string
  /** The test link's secret; '' = none made yet. */
  previewToken: string
  updatedAt: string
  by: By
  history: SwitchChange[]
}

/** What's in force, wherever it came from. */
export interface SwitchState {
  open: Record<SwitchKind, boolean>
  /** What customers see (the default when none was written). */
  pauseNote: string
  /** The note as written ('' = the default is showing). */
  pauseNoteWritten: string
  previewToken: string
  /** 'saved' once an owner saved here; 'setup' = still the site's hosting settings. */
  source: 'saved' | 'setup'
  updatedAt: string | null
  by: By | null
  history: SwitchChange[]
}

export { SettingsError }

// ---------------------------------------------------------------- env (the fallback)

function readEnv(key: string): string | undefined {
  try {
    // Must be written exactly `import.meta.env` (Vite substitutes it at build time).
    const ime: any = (import.meta as any).env
    if (ime && ime[key] != null && ime[key] !== '') return String(ime[key])
  } catch {
    /* import.meta not available */
  }
  if (typeof process !== 'undefined' && process.env && process.env[key] != null && process.env[key] !== '') return String(process.env[key])
  return undefined
}

/** BOOKINGS_OPEN read as kinds: "true" = all of them, else a comma list of real kind names. */
export function envOpenKinds(): { all: boolean; kinds: Set<string> } {
  const raw = (readEnv('BOOKINGS_OPEN') ?? '').trim().toLowerCase()
  if (raw === 'true') return { all: true, kinds: new Set() }
  const known = new Set(['parties', 'workshops', 'kits', 'other'])
  return { all: false, kinds: new Set(raw.split(',').map((k) => k.trim()).filter((k) => known.has(k))) }
}

export function envKindOpen(kind: string): boolean {
  const { all, kinds } = envOpenKinds()
  return all || kinds.has(kind)
}

export function envPreviewToken(): string {
  return readEnv('PREVIEW_TOKEN') ?? ''
}

/** The state from a document, or from the env when there is none. */
export function stateOf(doc: SwitchDoc | null): SwitchState {
  if (!doc) {
    return {
      open: { parties: envKindOpen('parties'), workshops: envKindOpen('workshops'), kits: envKindOpen('kits') },
      pauseNote: defaultPauseNote(),
      pauseNoteWritten: '',
      previewToken: envPreviewToken(),
      source: 'setup',
      updatedAt: null,
      by: null,
      history: [],
    }
  }
  return {
    open: { ...doc.open },
    pauseNote: doc.pauseNote || defaultPauseNote(),
    pauseNoteWritten: doc.pauseNote,
    // A saved document without a test link of its own keeps the old one working.
    previewToken: doc.previewToken || envPreviewToken(),
    source: 'saved',
    updatedAt: doc.updatedAt,
    by: doc.by,
    history: doc.history,
  }
}

// ---------------------------------------------------------------- reading

function parse(json: string | null): SwitchDoc | null {
  if (!json) return null
  const d = JSON.parse(json)
  if (!d || typeof d !== 'object' || !d.open || typeof d.updatedAt !== 'string') return null
  return {
    v: 1,
    open: { parties: d.open.parties === true, workshops: d.open.workshops === true, kits: d.open.kits === true },
    pauseNote: typeof d.pauseNote === 'string' ? d.pauseNote : '',
    previewToken: typeof d.previewToken === 'string' ? d.previewToken : '',
    updatedAt: d.updatedAt,
    by: d.by ?? { id: 'admin', name: 'Owner' },
    history: Array.isArray(d.history) ? d.history : [],
  }
}

let cached: { at: number; doc: SwitchDoc | null } | null = null

/**
 * The saved switch document (null = never saved: the env applies). Remembered
 * for 30 seconds. When the store can't be read: the last answer this server
 * had, or, with none, null (the env, as before this existed), logged.
 */
export async function readSwitchDoc(opts: { fresh?: boolean } = {}): Promise<SwitchDoc | null> {
  const now = Date.now()
  if (cached && !opts.fresh && now - cached.at < SWITCH_CACHE_MS) return cached.doc
  try {
    const doc = parse(await kv.get(KEY))
    cached = { at: now, doc }
    return doc
  } catch (e) {
    logger.error('Online booking switch could not be read', { error: e instanceof Error ? e.message : String(e) })
    return cached ? cached.doc : null
  }
}

/** What's in force now. */
export async function getSwitchState(opts: { fresh?: boolean } = {}): Promise<SwitchState> {
  return stateOf(await readSwitchDoc(opts))
}

/** For /admin: read straight from the store, throwing when it can't be read. */
export async function getSwitchStateStrict(): Promise<SwitchState> {
  const doc = parse(await kv.get(KEY))
  cached = { at: Date.now(), doc }
  return stateOf(doc)
}

/** Forget the remembered answer (tests). */
export function resetSwitchCache(): void {
  cached = null
}

/** @internal test-only: back to "never saved". */
export async function _resetSwitchForTests(): Promise<void> {
  cached = null
  await kv.set(KEY, '')
}

// ---------------------------------------------------------------- writing

export interface SwitchInput {
  open: Record<SwitchKind, boolean>
  pauseNote: string
  /** true: make a new test link (old ones stop working). */
  newTestLink?: boolean
}

/** Checks and tidies what an owner sent. */
export function validateSwitchInput(body: any): SwitchInput {
  if (!body || typeof body !== 'object' || !body.open || typeof body.open !== 'object') throw new SettingsError(400, 'Nothing to save.')
  const open = {} as Record<SwitchKind, boolean>
  for (const k of SWITCH_KINDS) {
    if (typeof body.open[k] !== 'boolean') throw new SettingsError(400, `Say whether ${KIND_NAME[k].toLowerCase()} are open or paused.`, `open.${k}`)
    open[k] = body.open[k]
  }
  const note = (typeof body.pauseNote === 'string' ? body.pauseNote : '').replace(/\s+/g, ' ').trim()
  if (note.length > PAUSE_NOTE_MAX) throw new SettingsError(400, `Keep the note to ${PAUSE_NOTE_MAX} characters.`, 'pauseNote')
  if (/[<>]/.test(note)) throw new SettingsError(400, 'Leave out < and > in the note.', 'pauseNote')
  return { open, pauseNote: note, newTestLink: body.newTestLink === true }
}

export function describeSwitchChanges(before: SwitchState, after: { open: Record<SwitchKind, boolean>; pauseNoteWritten: string; newTestLink: boolean }): string[] {
  const out: string[] = []
  for (const k of SWITCH_KINDS) {
    if (before.open[k] !== after.open[k]) out.push(`${after.open[k] ? 'Opened' : 'Paused'} ${KIND_NAME[k].toLowerCase()}`)
  }
  if (before.pauseNoteWritten !== after.pauseNoteWritten) out.push(after.pauseNoteWritten ? 'Changed the pause note' : 'Went back to the usual pause note')
  if (after.newTestLink) out.push('Made a new test link')
  return out
}

function newToken(): string {
  return randomBytes(18).toString('base64url')
}

export class StaleSwitchError extends SettingsError {
  constructor(public current: SwitchState) { super(409, 'Someone else changed online booking. Check it and save again.') }
}

/**
 * Saves the switch. `expectedUpdatedAt` is what the owner loaded (null while
 * the hosting settings were in force); anything newer is refused as stale.
 * The first save starts from what was in force, so nothing changes that the
 * owner didn't change. The switch's own test link is made on the first save,
 * and from then on links made with PREVIEW_TOKEN no longer unlock anything.
 */
export async function saveSwitches(
  input: SwitchInput,
  opts: { expectedUpdatedAt: string | null; by: By; now?: Date },
): Promise<{ saved: SwitchState; before: SwitchState; changed: string[] }> {
  assertClassWritesAllowed() // R41: a test site never writes the live switch
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { value, etag } = await kv.getWithMeta(KEY)
    const cur = parse(value)
    const before = stateOf(cur)
    if ((cur?.updatedAt ?? null) !== (opts.expectedUpdatedAt ?? null)) throw new StaleSwitchError(before)
    // The switch's own test link: made on the first save (PREVIEW_TOKEN links stop then), or on request.
    const token = input.newTestLink || !cur?.previewToken ? newToken() : cur.previewToken
    const changed = describeSwitchChanges(before, { open: input.open, pauseNoteWritten: input.pauseNote, newTestLink: !!input.newTestLink })
    const now = opts.now ?? new Date()
    const stamp = cur && now.toISOString() <= cur.updatedAt ? new Date(Date.parse(cur.updatedAt) + 1).toISOString() : now.toISOString()
    const history = [{ at: stamp, by: opts.by, changed }, ...(cur?.history ?? [])].slice(0, SWITCH_HISTORY_CAP)
    const doc: SwitchDoc = { v: 1, open: input.open, pauseNote: input.pauseNote, previewToken: token, updatedAt: stamp, by: opts.by, history }
    if (await kv.setIfMatch(KEY, JSON.stringify(doc), etag, value !== null)) {
      cached = { at: Date.now(), doc }
      return { saved: stateOf(doc), before, changed }
    }
  }
  throw new SettingsError(503, 'Someone else is saving at the same moment. Try again.')
}
