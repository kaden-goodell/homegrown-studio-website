/**
 * Make a gift card for a giveaway from the command line, against PRODUCTION.
 *
 * The card is made in Square with the token in .env (SQUARE_ENVIRONMENT must
 * be "production"). Its record and its audit entry go to the production
 * Netlify Blobs stores through the authed `netlify` CLI, so the card shows on
 * /staff and in the audit log like one made there.
 *
 * Usage:
 *   npx tsx scripts/mint-gift-card.ts --amount 25 --for "Megan" [--note "Facebook giveaway"]
 */
import 'dotenv/config'
import { SquareGiftCardProvider } from '../src/providers/square/giftcard'
import { newAuditEntry } from '../src/lib/audit'
import { giftCardKey, validateMint, newGiftCardRecordId, type MintedGiftCard } from '../src/lib/gift-cards'
import { blobSet, requireNetlifyCli } from './lib/netlify-blobs'

const BY = { id: 'cli', name: 'Kaden (CLI)' }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const v = validateMint({ amountDollars: Number(arg('amount')), forWhom: arg('for'), note: arg('note') })
  if (!v.ok) {
    console.error(v.error)
    console.error('Usage: npx tsx scripts/mint-gift-card.ts --amount <dollars> --for "<who>" [--note "..."]')
    process.exit(1)
  }

  // Check every way this could fail BEFORE a card exists in Square.
  requireNetlifyCli()
  const { SQUARE_ACCESS_TOKEN, SQUARE_ENVIRONMENT, SQUARE_LOCATION_ID, SQUARE_APPLICATION_ID } = process.env
  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) {
    console.error('✗ SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID must be set in .env.')
    process.exit(1)
  }
  if (SQUARE_ENVIRONMENT !== 'production') {
    console.error(`✗ SQUARE_ENVIRONMENT is "${SQUARE_ENVIRONMENT ?? ''}". This writes the production record, so the card must be a production card too.`)
    process.exit(1)
  }

  const giftcards = new SquareGiftCardProvider({
    accessToken: SQUARE_ACCESS_TOKEN,
    environment: 'production',
    locationId: SQUARE_LOCATION_ID,
    applicationId: SQUARE_APPLICATION_ID ?? '',
  })
  const id = newGiftCardRecordId()
  const card = await giftcards.mint({ amountCents: v.value.amountCents, idempotencyKey: id })
  console.log(`Gift card ${card.gan} ($${v.value.amountCents / 100}) for ${v.value.forWhom}`)

  const record: MintedGiftCard = {
    id, giftCardId: card.id, gan: card.gan, amountCents: v.value.amountCents,
    forWhom: v.value.forWhom, note: v.value.note,
    by: BY, at: new Date().toISOString(),
  }
  try {
    await blobSet('gift-cards', giftCardKey(id), JSON.stringify(record))
  } catch (err) {
    console.error('✗ The card exists in Square but was NOT recorded. Record to save by hand (store gift-cards, key ' + giftCardKey(id) + '):')
    console.error(JSON.stringify(record))
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
  const { key, entry } = newAuditEntry({
    by: { ...BY, role: 'owner' },
    action: 'gift-card.minted',
    target: { kind: 'gift-card', id, label: v.value.forWhom },
    details: { amountCents: v.value.amountCents, forWhom: v.value.forWhom, note: v.value.note || null },
  })
  try {
    await blobSet('audit', key, JSON.stringify(entry))
  } catch (err) {
    console.error('Card recorded, but the audit entry failed:', err instanceof Error ? err.message : err)
  }
  console.log(`Recorded in production as ${id}.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
