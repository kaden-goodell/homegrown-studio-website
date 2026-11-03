import type { APIRoute } from 'astro'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { providers } from '@config/providers'
import { alertOwners } from '@lib/owner-alert'
import { createLogger } from '@lib/logger'
import { recordAudit } from '@lib/audit'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import {
  listMintedGiftCards, saveMintedGiftCard, validateMint, newGiftCardRecordId, giftCardIdForPress, getMintedGiftCard,
  type MintedGiftCard,
} from '@lib/gift-cards'

export const prerender = false

/** M9: a mint whose answer failed may still have made the card in Square. */
export const GIFT_CARD_MAYBE_MADE = 'Square didn’t answer clearly, so the card may or may not have been made. Check the list below before making another; tapping Make the gift card again for the same card never makes a second one.'

const logger = createLogger('api:staff:gift-cards')
const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS })

/**
 * Crew see only a card's last 4 digits (DV19): online redemption needs only
 * the number, so a full list would let anyone signed in spend a card. The
 * full number is shown once, to its maker, right after it's made (POST), and
 * to owners. `giftCardId` (Square's id, which can look the card up) goes to
 * owners only too.
 */
export function maskedGan(gan: string): string {
  const digits = String(gan ?? '').replace(/\s/g, '')
  return digits.length > 4 ? `•••• ${digits.slice(-4)}` : digits
}

/** Staff-only: every gift card we've made, with its live balance from Square. Crew get masked numbers. */
export const GET: APIRoute = async ({ request }) => {
  const member = await staffAuthorized(request)
  if (!member) return json({ error: 'Unauthorized' }, 401)
  const owner = member.role === 'owner'
  try {
    const records = await listMintedGiftCards()
    const cards = await Promise.all(records.map(async (r) => {
      const shown = owner ? r : { ...r, gan: maskedGan(r.gan), giftCardId: '', masked: true as const }
      try {
        const live = await providers.giftcard.get(r.giftCardId)
        return { ...shown, balanceCents: live ? live.balanceCents : null, state: live ? live.state : null }
      } catch (err) {
        logger.warn('Gift card lookup failed', { id: r.id, error: err instanceof Error ? err.message : String(err) })
        return { ...shown, balanceCents: null, state: null }
      }
    }))
    return json({ data: { cards, masked: !owner } })
  } catch (err) {
    logger.error('Gift card list failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Could not load gift cards' }, 503)
  }
}

/** Staff-only: make a new gift card for a giveaway. */
export const POST: APIRoute = async ({ request }) => {
  const member = await staffAuthorized(request)
  if (!member) return json({ error: 'Unauthorized' }, 401)
  // R41 (I1): a test site sharing the live stores and Square never makes a real gift card.
  const refusal = classWritesRefusal(request)
  if (refusal) return json({ error: refusal, code: 'NO_TEST_STORE' }, 503)

  let body: unknown
  try { body = await request.json() } catch { body = null }
  const v = validateMint(body)
  if (!v.ok) return json({ error: v.error }, 400)

  // M9: the same press (double tap, retry) → the same id and Square key → the same card, never two.
  const pressed = giftCardIdForPress((body as { pressId?: unknown } | null)?.pressId, v.value.amountCents)
  const id = pressed ?? newGiftCardRecordId()
  if (pressed) {
    const have = await getMintedGiftCard(pressed).catch(() => null)
    if (have) return json({ data: { card: have, balanceCents: null, replayed: true } })
  }
  let minted
  try {
    minted = await providers.giftcard.mint({ amountCents: v.value.amountCents, idempotencyKey: id })
  } catch (err) {
    logger.error('Gift card mint failed', { error: err instanceof Error ? err.message : String(err) })
    // Square may have made it before the answer was lost: never say it wasn't.
    return json({ error: GIFT_CARD_MAYBE_MADE }, 502)
  }

  const record: MintedGiftCard = {
    id,
    giftCardId: minted.id,
    gan: minted.gan,
    amountCents: v.value.amountCents,
    forWhom: v.value.forWhom,
    note: v.value.note,
    by: byOf(member),
    at: new Date().toISOString(),
    ...(paymentBypassEnabled(request) ? { simulated: true as const } : {}),
  }
  // The audit keeps the record id as the target; the card number stays out of it.
  const audit = (recorded: boolean) => recordAudit({
    by: member,
    action: 'gift-card.minted',
    target: { kind: 'gift-card', id: record.id, label: record.forWhom },
    details: {
      amountCents: record.amountCents, forWhom: record.forWhom, note: record.note || null,
      ...(recorded ? {} : { recorded: false }),
    },
    ...(record.simulated ? { simulated: true as const } : {}),
  })
  try {
    await saveMintedGiftCard(record)
  } catch (err) {
    logger.error('Gift card made but not recorded', { id, gan: maskedGan(minted.gan), error: err instanceof Error ? err.message : String(err) })
    await audit(false)
    await alertOwners(`Gift card ${minted.gan} ($${v.value.amountCents / 100}, for ${v.value.forWhom}) was made in Square by ${member.name} but not recorded. Hand it out anyway.`)
    return json({ error: 'Card made but not recorded', gan: minted.gan }, 502)
  }
  await audit(true)
  return json({ data: { card: record, balanceCents: minted.balanceCents } })
}
