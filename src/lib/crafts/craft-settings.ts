/**
 * Which crafts are hidden on the website (/admin › More › Crafts › Hide on
 * the website). Ours, not Square's: the register keeps every craft, because
 * crafts are rung up at the studio after a party (D1). One small document
 * with its history, in kv `craft-settings`.
 */
import { makeKvStore } from '@lib/blob-store'

const kv = makeKvStore('craft-settings', 'craft-settings')
const KEY = 'hidden'

interface HiddenDoc {
  ids: string[]
  history: { at: string; by: string; id: string; hidden: boolean }[]
}

async function read(): Promise<{ doc: HiddenDoc; etag: string | null; exists: boolean }> {
  const { value, etag } = await kv.getWithMeta(KEY)
  if (!value) return { doc: { ids: [], history: [] }, etag, exists: false }
  const doc = JSON.parse(value) as HiddenDoc
  return { doc: { ids: Array.isArray(doc.ids) ? doc.ids : [], history: Array.isArray(doc.history) ? doc.history : [] }, etag, exists: true }
}

/** The ids hidden on the website. Throws when the store can't be read (callers decide). */
export async function getHiddenCraftIds(): Promise<Set<string>> {
  return new Set((await read()).doc.ids)
}

/** Hide or show one craft; safe against two saves at once. */
export async function setCraftHidden(id: string, hidden: boolean, by: string, now: Date = new Date()): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const { doc, etag, exists } = await read()
    const ids = new Set(doc.ids)
    if (ids.has(id) === hidden) return
    if (hidden) ids.add(id)
    else ids.delete(id)
    const next: HiddenDoc = { ids: [...ids], history: [...doc.history, { at: now.toISOString(), by, id, hidden }].slice(-500) }
    if (await kv.setIfMatch(KEY, JSON.stringify(next), etag, exists)) return
  }
  throw new Error('The craft list was busy. Try again.')
}
