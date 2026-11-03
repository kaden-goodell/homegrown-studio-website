/**
 * Sandbox end-to-end suite for our own classes (stage 1, Task 17) and parties
 * (stage 2, Task 14).
 *
 * Runs only against the branch preview, which talks to the Square SANDBOX:
 *   https://kaden-own-booking-system--iridescent-croissant-494fc3.netlify.app
 * Any other host (ourhometownstudio.com included) is refused. Sandbox card
 * nonces only; no real money.
 *
 * Run it (Kaden, from the repo root; the passcodes go straight from the
 * branch's Netlify env into this process and are never printed):
 *
 *   ! ADMIN_PASSCODE="$(npx netlify env:get ADMIN_PASSCODE --context branch:kaden/own-booking-system)" STAFF_PASSCODE="$(npx netlify env:get STAFF_PASSCODE --context branch:kaden/own-booking-system)" PREVIEW_OWNER_ALERT_NUMBERS="$(npx netlify env:get OWNER_ALERT_NUMBERS --context branch:kaden/own-booking-system)" npx tsx scripts/sandbox-e2e.ts
 *
 * Options:
 *   --only N      just scenario N (or --only 3,5, or a range: --only 24-40)
 *   --dry-run     print what each scenario does; no network, no passcodes needed
 *   --cleanup-only  run no scenarios: cancel "E2E …" classes left by a run that
 *                 stopped part way, archive their library entries, remove
 *                 "E2E block" time and "E2E closure" days, cancel "E2E …"
 *                 parties and take the E2E package, extras and test days out
 *                 of Parties setup (same passcodes, preview only)
 *
 * Optional env:
 *   SQUARE_SANDBOX_ACCESS_TOKEN  checks each order, payment, refund and POS item in
 *                                the Square sandbox, and lets scenarios 11, 22 and 40
 *                                (and the To decide half of 27) run.
 *                                Without it those checks are skipped with a note.
 *   (required) PREVIEW_OWNER_ALERT_NUMBERS  the branch's OWNER_ALERT_NUMBERS: the run stops unless it is
 *                                Kaden's (402) 980-2907 only (owner texts go there).
 *   E2E_EMAIL                    where the test bookings' confirmation emails go
 *                                (default kaden+e2e@ourhometownstudio.com).
 *
 * Scenarios 1–23 are our classes (stage 1, scripts/lib/sandbox-e2e/scenarios.ts).
 * Scenarios 24–40 are parties (stage 2, scripts/lib/sandbox-e2e/party-scenarios.ts):
 * the first one to run adds a $1 "E2E <run> Test party" package (Only with the
 * link), two $1 extras and dated test party days at 4 AM to Parties setup on the
 * preview; the run's cleanup (after the last scenario, or on Ctrl-C) takes them
 * out again. Every party's host is "E2E <run> …"; each scenario cancels its
 * parties (never refunding); refunds only in 35, 36, 37 and 40 (sandbox money).
 * Scenario 60 is crafts in /admin (scripts/lib/sandbox-e2e/craft-scenarios.ts).
 * Scenarios 41–48 are staffing (stage 3, scripts/lib/sandbox-e2e/staffing-scenarios.ts):
 * they sign a third client in to /staff as "E2E Crew", the person "Set up sandbox"
 * puts on the preview's own staff list (skipped with how to fix it when it isn't
 * there yet), and never message anyone (tell off on every assign).
 * Scenarios 49–67 are the stage 4 extras (scripts/lib/sandbox-e2e/extras-scenarios.ts):
 * promo codes and the half-cent proof, early-bird, free bookings, repeating
 * dates, the waitlist with saved sandbox cards, saved-card proofs, Register
 * setup, the early-bird register price, the reader (simulated) and the
 * customer's own cancel (D2).
 *
 * Every class it makes is named "E2E <run> …", link-only (scenario 1 makes
 * one public for a moment to check the list), and cancelled at the end with
 * its library entry archived. Nothing is refunded except in scenarios 10 and
 * 17, in the sandbox. Ctrl-C (or a crash) first halts the running scenario
 * (its next call to the preview or Square throws; the stop waits up to 20 s
 * for a call already in flight), then runs its cleanups, puts Parties setup
 * back and signs out before exiting. Exit code 0 only when every
 * scenario run passed.
 */
import { pathToFileURL } from 'node:url'
import {
  actAsOwner, formatPlan, formatSummary, MissingSecretError, onStop, ownerNumbersProblem, parseArgs, pick, PREVIEW_ORIGIN, PreviewClient, RateGate, readSecrets, redact, runScenarios,
  SlotAllocator, SquareSandbox, checkStatus, check, Halt, type Pending, type Secrets, type StopProcess,
} from './lib/sandbox-e2e/core'
import { blockedDay, CLEANUP_PLAN, cleanUpLeftovers, firstDay, scenarios } from './lib/sandbox-e2e/scenarios'
import { cleanUpPartyLeftovers, PARTY_CLEANUP_PLAN, partyScenarios, type PartyCtx } from './lib/sandbox-e2e/party-scenarios'
import { staffingScenarios, type StaffingCtx } from './lib/sandbox-e2e/staffing-scenarios'
import { cleanUpExtrasLeftovers, EXTRAS_CLEANUP_PLAN, EXTRAS_NEED_TOKEN, extrasScenarios } from './lib/sandbox-e2e/extras-scenarios'
import { craftScenarios } from './lib/sandbox-e2e/craft-scenarios'
import { Cleanup, type CleanupResult, type Scenario } from './lib/sandbox-e2e/core'

/** The run's context: the party bits (run-level cleanup) and the crew bits (a third /staff client). */
export type RunCtx = PartyCtx & StaffingCtx

/** Every scenario, in id order: our classes (1–23), parties (24–40), staffing (41–48), the stage 4 extras (49–67), then crafts in /admin (68). */
export const ALL_SCENARIOS: Scenario<RunCtx>[] = [
  ...(scenarios as Scenario<RunCtx>[]), ...(partyScenarios as Scenario<RunCtx>[]), ...(staffingScenarios as Scenario<RunCtx>[]),
  ...(extrasScenarios as Scenario<RunCtx>[]), ...(craftScenarios as Scenario<RunCtx>[]),
]

/** Runs the run-level undo steps (Parties setup put back) once, saying what happened. */
export async function finishRun(runCleanup: Cleanup, log: (line: string) => void): Promise<CleanupResult[]> {
  if (!runCleanup.size) return []
  log('\nPutting back what the run changed:')
  const done = await runCleanup.run()
  for (const c of done) log(`    ${c.ok ? 'done' : 'NOT done'}: ${c.label}${c.error ? ` (${c.error})` : ''}`)
  if (done.some((c) => !c.ok)) log('Some of it failed. Run: npx tsx scripts/sandbox-e2e.ts --cleanup-only')
  return done
}

/** Test bookings text the owners; this is Kaden's number (test texts only ever go to him). */
const TEST_PHONE = '(402) 980-2907'

async function signIn(secrets: Secrets, ctx: Pick<RunCtx, 'admin' | 'staff'>): Promise<void> {
  const a = await ctx.admin.post('/api/admin/login.json', { passcode: secrets.adminPasscode })
  checkStatus(a, 200, 'Sign in to /admin')
  check(ctx.admin.jar.has('hg_admin'), 'Signed in to /admin but no cookie came back')
  // Owners come from the preview's staff list: act as one it names (Kaden when he is one; Kaden when it names none).
  actAsOwner(a.body?.data?.owners)

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
    list = pick(ALL_SCENARIOS, args.only)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 2
  }
  if (args.dryRun && args.cleanupOnly) {
    console.log(`Would clear up what earlier runs left on ${PREVIEW_ORIGIN}:`)
    for (const step of [...EXTRAS_CLEANUP_PLAN, ...CLEANUP_PLAN, ...PARTY_CLEANUP_PLAN]) console.log(`    - ${step}`)
    return 0
  }
  if (args.dryRun) {
    console.log(formatPlan(list))
    console.log(`\nSquare-side checks: ${env.SQUARE_SANDBOX_ACCESS_TOKEN ? 'on (SQUARE_SANDBOX_ACCESS_TOKEN set)' : `off (no SQUARE_SANDBOX_ACCESS_TOKEN; scenarios 11, 22, 40, ${EXTRAS_NEED_TOKEN.join(', ')} and the To decide half of 27 would be skipped, and the others' Square checks)`}`)
    return 0
  }

  let secrets: Secrets
  try {
    secrets = readSecrets(env)
  } catch (e) {
    if (e instanceof MissingSecretError) { console.error(e.message); return 2 }
    throw e
  }
  // T4: owner texts must reach Kaden only. Checked before anything goes over the network.
  const owners = ownerNumbersProblem(env.PREVIEW_OWNER_ALERT_NUMBERS)
  if (owners) { console.error(owners); return 2 }
  const hide = [secrets.adminPasscode, secrets.staffPasscode, secrets.sandboxToken]
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  const gate = new RateGate(4, 60_000)
  // Ctrl-C halts the running scenario (its next call throws) before anything is cleaned up.
  const halt = new Halt()
  const ctx: RunCtx = {
    pub: new PreviewClient({ gate, halt }),
    admin: new PreviewClient({ halt }),
    staff: new PreviewClient({ halt }),
    crew: new PreviewClient({ halt }),
    staffPasscode: secrets.staffPasscode,
    gate,
    square: secrets.sandboxToken ? new SquareSandbox(secrets.sandboxToken, (u, i) => fetch(u, i), halt) : null,
    slots: new SlotAllocator('2000-01-01'),
    runTag: new Date().toISOString().slice(5, 16).replace(/[-T:]/g, ''),
    person: { givenName: 'E2E', familyName: 'Sandbox', email: (env.E2E_EMAIL ?? '').trim() || 'kaden+e2e@ourhometownstudio.com', phone: TEST_PHONE },
    settings: null,
    runCleanup: new Cleanup(),
    sleep,
    log: (line) => console.log(redact(line, hide)),
  }
  const signOut = async () => {
    await ctx.admin.request('DELETE', '/api/admin/login.json').catch(() => undefined)
    await ctx.staff.request('DELETE', '/api/staff/login.json').catch(() => undefined)
    if (ctx.crew.jar.has('hg_staff')) await ctx.crew.request('DELETE', '/api/staff/login.json').catch(() => undefined)
  }
  // Ctrl-C, a kill or an error nothing caught: halt the running scenario, run its cleanups, put Parties setup back, sign out, exit.
  const pending: Pending = { current: null, halt }
  const removeStop = onStop({
    proc: deps.proc ?? process, pending, signOut: async () => { await finishRun(ctx.runCleanup, ctx.log).catch(() => undefined); await signOut() }, log: ctx.log, secrets: hide, exit: deps.exit ?? ((code) => process.exit(code)),
  })

  try {
    try {
      await signIn(secrets, ctx)
      const sandbox = await ctx.admin.get('/api/admin/classes/seed-sandbox.json')
      checkStatus(sandbox, 200, 'Ask the preview which Square it uses')
      check(sandbox.body?.data?.sandbox === true, 'The preview is not on the Square sandbox. Stopping before anything is booked.')
      // No emails or texts from tests (Kaden, 2 Nov 2026): the preview must say it sends none.
      const muted = await ctx.admin.get('/api/admin/preview-messages.json')
      checkStatus(muted, 200, 'Ask the preview whether its emails and texts are muted')
      check(muted.body?.data?.muted === true, 'The preview would send real emails and texts (messages are not muted there). Stopping before anything is booked.')
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
      const extras = await cleanUpExtrasLeftovers(ctx, ctx.log)
      const classes = await cleanUpLeftovers(ctx, ctx.log)
      const parties = await cleanUpPartyLeftovers(ctx, ctx.log)
      const done = [...extras.done, ...classes.done, ...parties.done], failed = [...extras.failed, ...classes.failed, ...parties.failed]
      ctx.log(`${done.length} done, ${failed.length} failed${done.length + failed.length ? '' : ' (nothing left over)'}.`)
      return failed.length ? 1 : 0
    }

    ctx.log(`Run ${ctx.runTag}: ${list.length} scenario(s); Square-side checks ${ctx.square ? 'on' : 'off (no SQUARE_SANDBOX_ACCESS_TOKEN)'}.`)
    const results = await runScenarios(list, ctx, { secrets: hide, log: ctx.log, pending })
    if (halt.stopped) {
      // The stop handler owns the cleanup now; never race it.
      await pending.stopped
      return 130
    }
    const putBack = await finishRun(ctx.runCleanup, ctx.log)
    console.log(`\n${redact(formatSummary(results), hide)}`)
    return results.every((r) => r.outcome !== 'FAIL') && putBack.every((c) => c.ok) ? 0 : 1
  } catch (e) {
    console.error(redact(`Stopped: ${e instanceof Error ? e.message : String(e)}`, hide))
    return 1
  } finally {
    removeStop()
    if (halt.stopped) {
      await pending.stopped?.catch(() => undefined)
    } else {
      // A run stopped by an error still puts Parties setup back (a no-op when the summary path already did).
      await finishRun(ctx.runCleanup, ctx.log).catch(() => undefined)
      await signOut()
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code), (e) => {
    const env = process.env
    console.error(redact(`Stopped: ${e instanceof Error ? e.message : String(e)}`, [env.ADMIN_PASSCODE, env.STAFF_PASSCODE, env.SQUARE_SANDBOX_ACCESS_TOKEN]))
    process.exit(1)
  })
}
