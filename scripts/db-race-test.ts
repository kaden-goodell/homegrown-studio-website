/**
 * Races two separate processes (two "servers", each with its own database
 * connection) against the database in DATABASE_URL, N rounds (default 200),
 * on the real modules and stores, and FAILS if any round lets two win:
 *
 *   party   two customers hold the same party time        (party-book, holdTime)
 *   seat    two customers take the last seat in a class   (seat-ledger, hold)
 *   claim   two waitlist runs claim the same entry         (waitlists)
 *   promo   two bookings use a code's last use             (promo-uses)
 *   refund  two refunds of the same $10 payment, cap $10   (refund-requests)
 *
 * Everything it writes is under the "zz-race" store namespace (store column
 * "zz-race-…"), never a real record, and it deletes those rows at the end.
 * Preview databases only: it refuses without --i-know-this-is-preview and on
 * a production context.
 *
 *   DATABASE_URL="$(npx netlify env:get DATABASE_URL --context branch:kaden/own-booking-system)" \
 *     npx tsx scripts/db-race-test.ts --i-know-this-is-preview [--rounds 200]
 */
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const NAMESPACE = 'zz-race'
const KINDS = ['party', 'seat', 'claim', 'promo', 'refund'] as const
type Kind = (typeof KINDS)[number]
type Ask = { round: number; kind: Kind; goAt: number }
type Answer = { round: number; kind: Kind; won: boolean; error?: string }

const args = process.argv.slice(2)
const isWorker = args[0] === '--worker'

if (isWorker) await worker(args[1])
else await parent()

async function parent(): Promise<void> {
  const ctx = process.env.CONTEXT || process.env.NETLIFY_CONTEXT || ''
  if (!args.includes('--i-know-this-is-preview')) {
    console.error('Refusing: add --i-know-this-is-preview (this is for a preview database only).')
    process.exit(2)
  }
  if (ctx === 'production') {
    console.error('Refusing: this is the production context.')
    process.exit(2)
  }
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL (the preview one, read from Netlify).')
    process.exit(2)
  }
  const ri = args.indexOf('--rounds')
  const rounds = ri >= 0 ? Number(args[ri + 1]) : 200
  const env = { ...process.env, STORE_NAMESPACE: NAMESPACE, NETLIFY: '', SQUARE_ENVIRONMENT: 'sandbox' }
  const self = fileURLToPath(import.meta.url)
  const workers = ['A', 'B'].map((who) => fork(self, ['--worker', who], { env, execArgv: process.execArgv, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }))
  const pending = new Map<string, (a: Answer) => void>()
  for (const w of workers) w.on('message', (a: Answer) => pending.get(`${a.round}:${(w as any).who}`)?.(a))
  workers.forEach((w, i) => ((w as any).who = i))
  await Promise.all(workers.map((w) => new Promise<void>((res) => w.once('message', () => res()))))

  const bad: string[] = []
  const errors: string[] = []
  const tally: Record<Kind, number> = { party: 0, seat: 0, claim: 0, promo: 0, refund: 0 }
  for (let round = 1; round <= rounds; round++) {
    const kind = KINDS[(round - 1) % KINDS.length]
    const goAt = Date.now() + 400
    const answers = await Promise.all(
      workers.map((w, i) => new Promise<Answer>((res) => {
        pending.set(`${round}:${i}`, res)
        w.send({ round, kind, goAt } satisfies Ask)
      })),
    )
    for (const a of answers) if (a.error) errors.push(`round ${round} ${kind}: ${a.error}`)
    const winners = answers.filter((a) => a.won).length
    tally[kind]++
    if (winners > 1) bad.push(`round ${round} ${kind}: BOTH won`)
    if (winners === 0 && !answers.some((a) => a.error)) bad.push(`round ${round} ${kind}: neither won`)
    if (round % 25 === 0) console.log(`${round}/${rounds} rounds, ${bad.length} bad`)
  }
  for (const w of workers) w.send({ round: -1, kind: 'party', goAt: 0 })
  await cleanUp()
  console.log(`\nRounds per kind: ${JSON.stringify(tally)}`)
  if (errors.length) console.log(`Errors (${errors.length}):\n  ${errors.slice(0, 10).join('\n  ')}`)
  if (bad.length) {
    console.log(`FAIL: ${bad.length} round(s) went wrong:\n  ${bad.slice(0, 20).join('\n  ')}`)
    process.exit(1)
  }
  console.log(errors.length ? 'FAIL: errors above.' : `PASS: in all ${rounds} rounds exactly one of the two won.`)
  process.exit(errors.length ? 1 : 0)
}

async function cleanUp(): Promise<void> {
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(process.env.DATABASE_URL!)
  const rows = await sql.query("DELETE FROM kv_store WHERE store LIKE 'zz-race-%' RETURNING 1")
  console.log(`Cleaned up ${rows.length} test row(s).`)
}

async function worker(who: string): Promise<void> {
  const { makeKvStore } = await import('../src/lib/blob-store')
  const { holdTime } = await import('../src/lib/parties/party-book')
  const { hold } = await import('../src/lib/classes/seat-ledger')
  const { quote } = await import('../src/lib/classes/pricing')
  const { defaultRules } = await import('../src/lib/classes/validate')
  const waitlists = makeKvStore('waitlists', 'waitlists')
  const promos = makeKvStore('promo-uses', 'promo-uses')
  const refunds = makeKvStore('refund-requests', 'refund-requests')

  /** The read-modify-write every claim/limit/cap in the app does: re-read and re-decide until the write lands. */
  async function rmw(kv: typeof waitlists, key: string, decide: (cur: any) => any | null): Promise<boolean> {
    for (let i = 0; i < 20; i++) {
      const { value, etag } = await kv.getWithMeta(key)
      const cur = value ? JSON.parse(value) : null
      const next = decide(cur)
      if (next === null) return false
      if (await kv.setIfMatch(key, JSON.stringify(next), etag, value !== null)) return true
    }
    throw new Error('20 lost writes in a row')
  }

  const runId = `${process.ppid}`
  process.send!({ ready: true })
  process.on('message', async (ask: Ask) => {
    if (ask.round < 0) process.exit(0)
    await new Promise((r) => setTimeout(r, Math.max(0, ask.goAt - Date.now())))
    const k = `${runId}-${ask.round}`
    let won = false
    try {
      switch (ask.kind) {
        case 'party': {
          const day = new Date(Date.UTC(2031, 0, 1) + ask.round * 86_400_000)
          const start = new Date(day.getTime() + 22 * 3_600_000).toISOString()
          const end = new Date(day.getTime() + 24 * 3_600_000).toISOString()
          won = (await holdTime({ partyId: `pty_race_${who}_${k}`, startIso: start, endIso: end, ttlMinutes: 15 }, [], new Date('2030-12-01T00:00:00Z'))).ok
          break
        }
        case 'seat': {
          const cls = {
            id: `cls_race_${k}`, libraryId: null, libraryVersion: null,
            content: {
              name: 'Race', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
              ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
              prices: { all: { person: 1000 } }, questions: [], addOns: [], defaultCapacity: 1, defaultMinutes: 120,
            },
            sessions: [{ id: 'ses_a', startIso: '2031-06-01T18:00:00.000Z', endIso: '2031-06-01T20:00:00.000Z', capacity: 1 }],
            status: 'open', square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by: { id: 'race', name: 'race' }, history: [],
          } as any
          const now = new Date('2031-05-01T12:00:00Z')
          const q = quote(cls, { passId: 'all', tickets: { person: 1 } }, now, 9)
          if (!q.ok) throw new Error(q.error)
          const r = await hold(cls, q.value, {
            bookingId: `bkg_race_${who}_${k}`, passId: 'all', source: 'online',
            customer: { givenName: 'Race', familyName: who, email: 'race@example.com', phone: '4029802907' }, ttlMinutes: 10,
          } as any, now)
          won = r.ok
          break
        }
        case 'claim':
          won = await rmw(waitlists, `race-claim-${k}`, (cur) => (cur?.claimedBy ? null : { claimedBy: who }))
          break
        case 'promo':
          won = await rmw(promos, `race-promo-${k}`, (cur) => {
            const uses = cur?.uses ?? []
            return uses.length >= 1 ? null : { limit: 1, uses: [...uses, who] }
          })
          break
        case 'refund':
          won = await rmw(refunds, `race-refund-${k}`, (cur) => {
            const refunded = cur?.refundedCents ?? 0
            return refunded + 1000 > 1000 ? null : { paidCents: 1000, refundedCents: refunded + 1000, by: who }
          })
          break
      }
      process.send!({ round: ask.round, kind: ask.kind, won } satisfies Answer)
    } catch (err) {
      process.send!({ round: ask.round, kind: ask.kind, won: false, error: err instanceof Error ? err.message : String(err) } satisfies Answer)
    }
  })
}
