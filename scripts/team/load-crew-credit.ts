import { readFileSync, writeFileSync } from 'node:fs'
import { client, LOCATION_ID, flag, hasFlag, findCrewMembers } from './square-helpers'
import { timecardHours, computeCreditCents, ledgerKey } from '../../src/lib/crew/credit'

/**
 * Pay-period store-credit top-up for the Studio Crew (moms).
 * Reads CLOSED timecards for the period, computes hours × rate, and loads
 * each mom's gift card with a promotional (no-payment) balance adjustment.
 * Idempotent via scripts/team/data/credit-ledger.json — commit it after runs.
 *
 * Usage: npx tsx scripts/team/load-crew-credit.ts --from 2026-07-20 --to 2026-08-02 --rate 15 [--dry-run]
 */

const from = flag('from'), to = flag('to'), rate = Number(flag('rate'))
if (!from || !to || !Number.isFinite(rate) || rate <= 0) {
  console.error('Usage: load-crew-credit.ts --from YYYY-MM-DD --to YYYY-MM-DD --rate <dollarsPerHour> [--dry-run]')
  process.exit(1)
}
const LEDGER_PATH = 'scripts/team/data/credit-ledger.json'
// Period bounds in Chicago local: from 00:00 CT through end-of-day on `to`.
const startAt = `${from}T00:00:00-05:00`
const endAt = `${to}T23:59:59-05:00`

async function giftCardFor(member: { id: string; name: string; email?: string }): Promise<any> {
  if (!member.email) throw new Error(`${member.name} has no email — cannot attach a gift card`)
  // 1. find-or-create the customer by email
  const found: any = await client.customers.search({
    query: { filter: { emailAddress: { exact: member.email } } }, limit: 1,
  })
  let customerId = found.customers?.[0]?.id
  if (!customerId) {
    const created: any = await client.customers.create({
      idempotencyKey: `crew-cust-${member.email}`,
      emailAddress: member.email,
      givenName: member.name.split(' ')[0],
      familyName: member.name.split(' ').slice(1).join(' ') || undefined,
      note: 'Studio Crew — store-credit compensation card holder',
    })
    customerId = created.customer.id
  }
  // 2. find-or-create the linked gift card
  const cards: any = await client.giftCards.list({ customerId })
  const existing = (cards.giftCards ?? cards.data ?? [])[0]
  if (existing) return existing
  const gc: any = await client.giftCards.create({
    idempotencyKey: `crew-gc-${member.id}`,
    giftCard: { type: 'DIGITAL' },
  })
  await client.giftCards.linkCustomer({ giftCardId: gc.giftCard.id, customerId })
  return gc.giftCard
}

async function loadCredit(card: any, cents: bigint, key: string): Promise<string> {
  const base = { locationId: LOCATION_ID, giftCardId: card.id }
  const amountMoney = { amount: cents, currency: 'USD' as const }
  if (card.state === 'PENDING' || card.state === 'NOT_ACTIVE') {
    const r: any = await client.giftCards.activities.create({
      idempotencyKey: `act-${key}`,
      giftCardActivity: {
        type: 'ACTIVATE', ...base,
        activateActivityDetails: { amountMoney, buyerPaymentInstrumentIds: ['crew-credit'] },
      },
    })
    return r.giftCardActivity.id
  }
  const r: any = await client.giftCards.activities.create({
    idempotencyKey: `adj-${key}`,
    giftCardActivity: {
      type: 'ADJUST_INCREMENT', ...base,
      adjustIncrementActivityDetails: { amountMoney, reason: 'COMPLIMENTARY' },
    },
  })
  return r.giftCardActivity.id
}

async function main() {
  const ledger: Record<string, any> = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))
  const crew = await findCrewMembers()
  if (!crew.length) { console.log('No Studio Crew members found.'); return }
  console.log(`Period ${from} → ${to} @ $${rate}/hr credit — ${crew.length} crew member(s)\n`)

  for (const member of crew) {
    const key = ledgerKey(member.id, from, to)
    if (ledger[key]) { console.log(`= ${member.name}: already loaded $${(ledger[key].cents / 100).toFixed(2)} on ${ledger[key].loadedAt}`); continue }

    const tcs: any = await client.labor.searchTimecards({
      query: { filter: { locationIds: [LOCATION_ID], teamMemberIds: [member.id], status: 'CLOSED', start: { startAt, endAt } } },
      limit: 200,
    })
    const hours = (tcs.timecards ?? []).reduce((sum: number, tc: any) => sum + timecardHours(tc), 0)
    const cents = computeCreditCents(hours, rate)
    if (cents === 0n) { console.log(`- ${member.name}: 0 hours, skipping`); continue }

    if (hasFlag('dry-run')) {
      console.log(`~ ${member.name}: ${hours.toFixed(2)} h → $${(Number(cents) / 100).toFixed(2)} (DRY RUN)`)
      continue
    }
    const card = await giftCardFor(member)
    const activityId = await loadCredit(card, cents, key)
    ledger[key] = { name: member.name, hours: Number(hours.toFixed(2)), cents: Number(cents), giftCardId: card.id, activityId, loadedAt: new Date().toISOString() }
    writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n')
    console.log(`+ ${member.name}: ${hours.toFixed(2)} h → $${(Number(cents) / 100).toFixed(2)} loaded (card ...${(card.gan ?? '').slice(-4)})`)
  }
  console.log('\nDone. Commit the ledger: git add scripts/team/data/credit-ledger.json && git commit -m "chore(crew): credit loads ' + from + '..' + to + '"')
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1) })
