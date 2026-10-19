/**
 * Sandbox end-to-end suite for our own classes (stage 1, Task 17).
 *
 * Runs only against the branch preview, which talks to the Square SANDBOX:
 *   https://kaden-own-booking-system--iridescent-croissant-494fc3.netlify.app
 * Any other host (ourhometownstudio.com included) is refused. Sandbox card
 * nonces only; no real money.
 *
 * Run it (Kaden, from the repo root; the passcodes go straight from the
 * branch's Netlify env into this process and are never printed):
 *
 *   ! ADMIN_PASSCODE="$(npx netlify env:get ADMIN_PASSCODE --context branch:kaden/own-booking-system)" STAFF_PASSCODE="$(npx netlify env:get STAFF_PASSCODE --context branch:kaden/own-booking-system)" npx tsx scripts/sandbox-e2e.ts
 *
 * Options:
 *   --only N      just scenario N (or --only 3,5)
 *   --dry-run     print what each scenario does; no network, no passcodes needed
 *   --cleanup-only  run no scenarios: cancel "E2E …" classes left by a run that
 *                 stopped part way, archive their library entries, remove
 *                 "E2E block" time and "E2E closure" days (same passcodes, preview only)
 *
 * Optional env:
 *   SQUARE_SANDBOX_ACCESS_TOKEN  checks each order, payment, refund and POS item in
 *                                the Square sandbox, and lets scenarios 11 and 22 run.
 *                                Without it those checks are skipped with a note.
 *   E2E_EMAIL                    where the test bookings' confirmation emails go
 *                                (default kaden+e2e@ourhometownstudio.com).
 *
 * Every class it makes is named "E2E <run> …", link-only (scenario 1 makes
 * one public for a moment to check the list), and cancelled at the end with
 * its library entry archived. Nothing is refunded except in scenarios 10 and
 * 17, in the sandbox. Ctrl-C (or a crash) runs the running scenario's
 * cleanups and signs out before exiting. Exit code 0 only when every
 * scenario run passed.
 */
import { pathToFileURL } from 'node:url'
import {
  formatPlan, formatSummary, MissingSecretError, onStop, parseArgs, pick, PREVIEW_ORIGIN, PreviewClient, RateGate, readSecrets, redact, runScenarios,
  SlotAllocator, SquareSandbox, checkStatus, check, type Pending, type Secrets, type StopProcess,
} from './lib/sandbox-e2e/core'
import { blockedDay, CLEANUP_PLAN, cleanUpLeftovers, firstDay, scenarios, type Ctx } from './lib/sandbox-e2e/scenarios'

/** Test bookings text the owners; this is Kaden's number (test texts only ever go to him). */
const TEST_PHONE = '(402) 980-2907'

async function signIn(secrets: Secrets, ctx: Pick<Ctx, 'admin' | 'staff'>): Promise<void> {
  const a = await ctx.admin.post('/api/admin/login.json', { passcode: secrets.adminPasscode })
  checkStatus(a, 200, 'Sign in to /admin')
  check(ctx.admin.jar.has('hg_admin'), 'Signed in to /admin but no cookie came back')

  const s = await ctx.staff.post('/api/staff/login.json', { passcode: secrets.staffPasscode })
  checkStatus(s, 200, 'Staff passcode')
  const staff: { id: string; name: string; role: string }[] = s.body?.data?.staff ?? []
  const who = staff.find((m) => m.role === 'owner') ?? staff[0]
  check(who, 'The staff list is empty')
  const p = await ctx.staff.post('/api/staff/pick.json', { passcode: secrets.staffPasscode, staffId: who.id })
  checkStatus(p, 200, 'Pick who is on the iPad')
}

/** What can be swapped in a test: the process the stop handlers listen on, and exit. */
export interface MainDeps { proc?: StopProcess; exit?: (code: number) => void }

export async function main(argv: string[], env: Record<string, string | undefined>, deps: MainDeps = {}): Promise<number> {
  let args
  try {
    args = parseArgs(argv)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 2
  }
  if (args.help) {
    console.log('npx tsx scripts/sandbox-e2e.ts [--only N[,M]] [--dry-run] [--cleanup-only]   (see the header of this file)')
    return 0
  }
  let list
  try {
    list = pick(scenarios, args.only)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 2
  }
  if (args.dryRun && args.cleanupOnly) {
    console.log(`Would clear up what earlier runs left on ${PREVIEW_ORIGIN}:`)
    for (const step of CLEANUP_PLAN) console.log(`    - ${step}`)
    return 0
  }
  if (args.dryRun) {
    console.log(formatPlan(list))
    console.log(`\nSquare-side checks: ${env.SQUARE_SANDBOX_ACCESS_TOKEN ? 'on (SQUARE_SANDBOX_ACCESS_TOKEN set)' : 'off (no SQUARE_SANDBOX_ACCESS_TOKEN; scenarios 11 and 22 would be skipped)'}`)
    return 0
  }

  let secrets: Secrets
  try {
    secrets = readSecrets(env)
  } catch (e) {
    if (e instanceof MissingSecretError) { console.error(e.message); return 2 }
    throw e
  }
  const hide = [secrets.adminPasscode, secrets.staffPasscode, secrets.sandboxToken]
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  const gate = new RateGate(4, 60_000)
  const ctx: Ctx = {
    pub: new PreviewClient({ gate }),
    admin: new PreviewClient(),
    staff: new PreviewClient(),
    gate,
    square: secrets.sandboxToken ? new SquareSandbox(secrets.sandboxToken) : null,
    slots: new SlotAllocator('2000-01-01'),
    runTag: new Date().toISOString().slice(5, 16).replace(/[-T:]/g, ''),
    person: { givenName: 'E2E', familyName: 'Sandbox', email: (env.E2E_EMAIL ?? '').trim() || 'kaden+e2e@ourhometownstudio.com', phone: TEST_PHONE },
    settings: null,
    sleep,
    log: (line) => console.log(redact(line, hide)),
  }
  const signOut = async () => {
    await ctx.admin.request('DELETE', '/api/admin/login.json').catch(() => undefined)
    await ctx.staff.request('DELETE', '/api/staff/login.json').catch(() => undefined)
  }
  // Ctrl-C, a kill or an error nothing caught: the running scenario's cleanups, sign out, exit.
  const pending: Pending = { current: null }
  const removeStop = onStop({
    proc: deps.proc ?? process, pending, signOut, log: ctx.log, secrets: hide, exit: deps.exit ?? ((code) => process.exit(code)),
  })

  try {
    try {
      await signIn(secrets, ctx)
      const sandbox = await ctx.admin.get('/api/admin/classes/seed-sandbox.json')
      checkStatus(sandbox, 200, 'Ask the preview which Square it uses')
      check(sandbox.body?.data?.sandbox === true, 'The preview is not on the Square sandbox. Stopping before anything is booked.')
      const settings = await ctx.admin.get('/api/admin/settings.json')
      checkStatus(settings, 200, 'Read the studio settings')
      ctx.settings = settings.body.data.settings
      ctx.slots = new SlotAllocator(firstDay(new Date()), blockedDay(ctx.settings))
    } catch (e) {
      console.error(redact(`Setup failed: ${e instanceof Error ? e.message : String(e)}`, hide))
      return 1
    }

    if (args.cleanupOnly) {
      ctx.log('Clearing up what earlier runs left behind ("E2E …" only):')
      const { done, failed } = await cleanUpLeftovers(ctx, ctx.log)
      ctx.log(`${done.length} done, ${failed.length} failed${done.length + failed.length ? '' : ' (nothing left over)'}.`)
      return failed.length ? 1 : 0
    }

    ctx.log(`Run ${ctx.runTag}: ${list.length} scenario(s); Square-side checks ${ctx.square ? 'on' : 'off (no SQUARE_SANDBOX_ACCESS_TOKEN)'}.`)
    const results = await runScenarios(list, ctx, { secrets: hide, log: ctx.log, pending })
    console.log(`\n${redact(formatSummary(results), hide)}`)
    return results.every((r) => r.outcome !== 'FAIL') ? 0 : 1
  } catch (e) {
    console.error(redact(`Stopped: ${e instanceof Error ? e.message : String(e)}`, hide))
    return 1
  } finally {
    removeStop()
    await signOut()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code), (e) => {
    const env = process.env
    console.error(redact(`Stopped: ${e instanceof Error ? e.message : String(e)}`, [env.ADMIN_PASSCODE, env.STAFF_PASSCODE, env.SQUARE_SANDBOX_ACCESS_TOKEN]))
    process.exit(1)
  })
}
