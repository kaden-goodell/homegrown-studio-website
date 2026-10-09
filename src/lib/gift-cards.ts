/**
 * Gift cards the studio has minted for giveaways: who each one is for, how
 * much, and who made it. The card itself (number, balance) lives in Square;
 * this is our record of why it exists.
 *
 * Netlify Blobs in prod, `.data/gift-cards/` on disk in dev.
 */
import { randomUUID } from 'node:crypto'
import { createLogger } from '@lib/logger'
import { isPreviewOrDev } from '@lib/deploy-context'
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'

const logger = createLogger('gift-cards')
const kv = makeKvStore('gift-cards', 'gift-cards')

export interface MintedGiftCard {
  id: string
  giftCardId: string
  gan: string
  amountCents: number
  forWhom: string
  note: string
  by: By
  at: string
  /** Made by a simulated (payment-bypass) mint. Absent on every real one. */
  simulated?: true
}

const PREFIX = 'gift-card:'

/** The store key for a minted card's record. Shared with the CLI that writes production directly. */
export function giftCardKey(id: string): string {
  return `${PREFIX}${id}`
}

export function newGiftCardRecordId(): string {
  return 'gc_' + randomUUID().slice(0, 8)
}

export async function saveMintedGiftCard(r: MintedGiftCard): Promise<void> {
  await kv.set(giftCardKey(r.id), JSON.stringify(r))
  logger.info('Gift card recorded', { id: r.id, amountCents: r.amountCents })
}

export async function listMintedGiftCards(): Promise<MintedGiftCard[]> {
  const keys = (await kv.list()).filter((k) => k.startsWith(PREFIX))
  const records = await Promise.all(keys.map(async (k) => {
    const json = await kv.get(k)
    return json ? (JSON.parse(json) as MintedGiftCard) : null
  }))
  // Previews share production's blob stores: a simulated card never shows in prod.
  const hideSimulated = !isPreviewOrDev()
  return records
    .filter((r): r is MintedGiftCard => r !== null)
    .filter((r) => !(hideSimulated && r.simulated === true))
    .sort((a, b) => b.at.localeCompare(a.at))
}

export function validateMint(body: unknown):
  | { ok: true; value: { amountCents: number; forWhom: string; note: string } }
  | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const dollars = b.amountDollars
  if (typeof dollars !== 'number' || !Number.isInteger(dollars) || dollars < 1 || dollars > 500) {
    return { ok: false, error: 'Amount must be a whole number of dollars from 1 to 500' }
  }
  const forWhom = typeof b.forWhom === 'string' ? b.forWhom.trim() : ''
  if (!forWhom) return { ok: false, error: 'Say who the card is for' }
  if (forWhom.length > 80) return { ok: false, error: 'Keep "who it\'s for" to 80 characters or fewer' }
  const note = typeof b.note === 'string' ? b.note.trim() : ''
  if (note.length > 200) return { ok: false, error: 'Keep the note to 200 characters or fewer' }
  return { ok: true, value: { amountCents: dollars * 100, forWhom, note } }
}
