/**
 * Make a gift card for a giveaway from the command line.
 *
 * Usage:
 *   npx tsx scripts/mint-gift-card.ts --amount 25 --for "Megan" [--note "Facebook giveaway"]
 */
import 'dotenv/config'
import { providers } from '../src/config/providers'
import { recordAudit } from '../src/lib/audit'
import { saveMintedGiftCard, validateMint, newGiftCardRecordId } from '../src/lib/gift-cards'

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
  const id = newGiftCardRecordId()
  const card = await providers.giftcard.mint({ amountCents: v.value.amountCents, idempotencyKey: id })
  try {
    await saveMintedGiftCard({
      id, giftCardId: card.id, gan: card.gan, amountCents: v.value.amountCents,
      forWhom: v.value.forWhom, note: v.value.note,
      by: { id: 'cli', name: 'Kaden (CLI)' }, at: new Date().toISOString(),
    })
    await recordAudit({
      by: { id: 'cli', name: 'Kaden (CLI)', role: 'owner' },
      action: 'gift-card.minted',
      target: { kind: 'gift-card', id, label: v.value.forWhom },
      details: { amountCents: v.value.amountCents, forWhom: v.value.forWhom, gan: card.gan, note: v.value.note || null },
    })
  } catch (err) {
    console.error('Card made but NOT recorded:', err)
  }
  console.log(`Gift card ${card.gan} ($${v.value.amountCents / 100}) for ${v.value.forWhom}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
