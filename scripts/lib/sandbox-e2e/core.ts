/**
 * The pieces of scripts/sandbox-e2e.ts that need no live site: which hosts it
 * may talk to, reading the passcodes from the environment (never printing
 * them), a cookie jar, a pace-keeper for the booking endpoint's rate limit,
 * assertions, cleanup, the runner and the summary table. Unit tested in
 * tests/scripts/sandbox-e2e.test.ts with a mocked fetch.
 */

/** The branch preview: the only site this suite ever talks to. It runs Square SANDBOX. */
export const PREVIEW_ORIGIN = 'https://kaden-own-booking-system--iridescent-croissant-494fc3.netlify.app'
/** Square's sandbox: the only Square host this suite ever talks to. */
export const SANDBOX_ORIGIN = 'https://connect.squareupsandbox.com'
/** The same version the site uses for its own raw Square calls (src/lib/classes/square-api.ts). */
export const SQUARE_SANDBOX_VERSION = '2026-01-22'

/** How Kaden runs it (the passcodes come from the branch's Netlify env, straight into the process). */
export const RUN_LINE =
  '! ADMIN_PASSCODE="$(npx netlify env:get ADMIN_PASSCODE --context branch:kaden/own-booking-system)" STAFF_PASSCODE="$(npx netlify env:get STAFF_PASSCODE --context branch:kaden/own-booking-system)" npx tsx scripts/sandbox-e2e.ts'

const HOSTS = {
  preview: new URL(PREVIEW_ORIGIN).host,
  square: new URL(SANDBOX_ORIGIN).host,
} as const

export class RefusedHostError extends Error {}

/**
 * The URL, when it is on the allowed host for `kind`; otherwise throws. Only
 * https, no user info, exactly the preview host (never ourhometownstudio.com,
 * never the production Netlify site) or exactly the Square sandbox host.
 */
export function assertAllowed(raw: string | URL, kind: keyof typeof HOSTS): URL {
  let url: URL
  try {
    url = new URL(String(raw))
  } catch {
    throw new RefusedHostError(`Refusing a URL that does not parse: ${String(raw).slice(0, 80)}`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.host !== HOSTS[kind]) {
    throw new RefusedHostError(`Refusing to talk to ${url.protocol}//${url.host}: this suite only talks to ${HOSTS[kind]}.`)
  }
  return url
}

// ── Secrets ────────────────────────────────────────────────────────────────

export interface Secrets { adminPasscode: string; staffPasscode: string; sandboxToken: string | null }
export class MissingSecretError extends Error {}

/** Passcodes from the process env only. Missing → one line saying how to run it (no values, ever). */
export function readSecrets(env: Record<string, string | undefined>): Secrets {
  const admin = (env.ADMIN_PASSCODE ?? '').trim()
  const staff = (env.STAFF_PASSCODE ?? '').trim()
  const missing = [!admin && 'ADMIN_PASSCODE', !staff && 'STAFF_PASSCODE'].filter(Boolean)
  if (missing.length) {
    throw new MissingSecretError(`${missing.join(' and ')} not set. Run it with: ${RUN_LINE}`)
  }
  const token = (env.SQUARE_SANDBOX_ACCESS_TOKEN ?? '').trim()
  return { adminPasscode: admin, staffPasscode: staff, sandboxToken: token || null }
}

/** Every secret in `text` replaced by [hidden]. Used on anything the suite prints. */
export function redact(text: string, secrets: (string | null | undefined)[]): string {
  let out = text
  for (const s of secrets) {
    if (!s || s.length < 4) continue
    out = out.split(s).join('[hidden]')
  }
  return out
}

// ── Cookies ────────────────────────────────────────────────────────────────

/** The Set-Cookie lines of a response (Node's getSetCookie when there, else a careful split). */
export function setCookiesOf(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof h.getSetCookie === 'function') return h.getSetCookie()
  const raw = headers.get('set-cookie')
  return raw ? raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/) : []
}

export class CookieJar {
  private jar = new Map<string, string>()
  /** Takes Set-Cookie lines; Max-Age=0 or an empty value removes the cookie. */
  set(lines: string[]): void {
    for (const line of lines) {
      const [pair, ...attrs] = line.split(';')
      const eq = pair.indexOf('=')
      if (eq < 1) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      const gone = !value || attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a))
      if (gone) this.jar.delete(name)
      else this.jar.set(name, value)
    }
  }
  has(name: string): boolean { return this.jar.has(name) }
  header(): string { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') }
}

// ── Pace ───────────────────────────────────────────────────────────────────

/**
 * The booking endpoint allows 5 tries a minute from one address. The gate
 * lets `max` calls through per `windowMs` and waits for the rest.
 */
export class RateGate {
  private stamps: number[] = []
  constructor(
    private max: number,
    private windowMs: number,
    private now: () => number = () => Date.now(),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}
  /** Waits until `n` calls fit in the window, then counts them. */
  async take(n = 1): Promise<void> {
    if (n > this.max) throw new Error(`Can't send ${n} at once; the gate allows ${this.max}.`)
    for (;;) {
      const t = this.now()
      this.stamps = this.stamps.filter((s) => t - s < this.windowMs)
      if (this.stamps.length + n <= this.max) {
        for (let i = 0; i < n; i++) this.stamps.push(t)
        return
      }
      const oldest = this.stamps[this.stamps.length + n - this.max - 1]
      await this.sleep(Math.max(50, this.windowMs - (t - oldest) + 50))
    }
  }
}

// ── HTTP ───────────────────────────────────────────────────────────────────

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
export interface Reply<T = any> { status: number; body: T; text: string }

export async function readReply(res: Response): Promise<Reply> {
  const text = await res.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { status: res.status, body, text }
}

/** One browser's worth of calls to the preview: its own cookies, never another host, never a redirect followed. */
export class PreviewClient {
  readonly jar = new CookieJar()
  constructor(private opts: { fetch?: FetchLike; gate?: RateGate } = {}) {}

  async request(method: string, path: string, init: { body?: unknown; headers?: Record<string, string>; gated?: boolean } = {}): Promise<Reply> {
    const url = assertAllowed(new URL(path, PREVIEW_ORIGIN), 'preview')
    if (init.gated && this.opts.gate) await this.opts.gate.take(1)
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers ?? {}) }
    const cookie = this.jar.header()
    if (cookie) headers.Cookie = cookie
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await (this.opts.fetch ?? fetch)(url.toString(), {
      method,
      headers,
      redirect: 'manual',
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
    this.jar.set(setCookiesOf(res.headers))
    return readReply(res)
  }
  get(path: string) { return this.request('GET', path) }
  post(path: string, body: unknown, extra: { gated?: boolean } = {}) { return this.request('POST', path, { body, ...extra }) }
}

export class SquareError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** Read-mostly calls to the Square SANDBOX with the sandbox token (never any other host). */
export class SquareSandbox {
  constructor(private token: string, private fetchImpl: FetchLike = fetch) {}
  async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    const url = assertAllowed(`${SANDBOX_ORIGIN}/v2${path}`, 'square')
    const res = await this.fetchImpl(url.toString(), {
      method,
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Square-Version': SQUARE_SANDBOX_VERSION,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const r = await readReply(res)
    if (r.status < 200 || r.status >= 300) {
      const e = r.body?.errors?.[0]
      throw new SquareError(r.status, `Square sandbox ${method} ${path.split('?')[0]} answered ${r.status}${e ? `: ${e.code ?? ''} ${e.detail ?? ''}`.trimEnd() : ''}`)
    }
    return r.body
  }
  get(path: string) { return this.call('GET', path) }
  post(path: string, body: unknown) { return this.call('POST', path, body) }
}

// ── Assertions ─────────────────────────────────────────────────────────────

export class AssertionFailed extends Error {}
/** Thrown to skip the rest of a scenario (with why). */
export class SkipScenario extends Error {}

export function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new AssertionFailed(message)
}

const show = (v: unknown) => stable(v) ?? String(v)

/** JSON with object keys sorted, so { a, b } equals { b, a }. */
export function stable(v: unknown): string | undefined {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x))
}

export function checkEqual<T>(actual: T, expected: T, what: string): void {
  if (stable(actual) !== stable(expected)) {
    throw new AssertionFailed(`${what}: expected ${show(expected)}, got ${show(actual)}`)
  }
}

/** What the site said, in one short line (its error, code and detail). */
export function sayReply(r: Reply): string {
  const b = r.body
  const said = [b?.code, b?.error, b?.detail, b?.warning].filter((x) => typeof x === 'string' && x).join(' / ')
  return `${r.status}${said ? ` ${said}` : r.body === null && r.text ? ` ${r.text.slice(0, 120)}` : ''}`
}

export function checkStatus(r: Reply, wanted: number | number[], what: string): void {
  const ok = Array.isArray(wanted) ? wanted.includes(r.status) : r.status === wanted
  if (!ok) throw new AssertionFailed(`${what}: expected HTTP ${Array.isArray(wanted) ? wanted.join(' or ') : wanted}, got ${sayReply(r)}`)
}

// ── Cleanup ────────────────────────────────────────────────────────────────

export interface CleanupResult { label: string; ok: boolean; error?: string }

/** Undo steps, run last-in first-out; one failing never stops the rest. */
export class Cleanup {
  private steps: { label: string; fn: () => Promise<unknown> }[] = []
  add(label: string, fn: () => Promise<unknown>): void { this.steps.push({ label, fn }) }
  get size(): number { return this.steps.length }
  async run(): Promise<CleanupResult[]> {
    const out: CleanupResult[] = []
    while (this.steps.length) {
      const { label, fn } = this.steps.pop()!
      try {
        await fn()
        out.push({ label, ok: true })
      } catch (e) {
        out.push({ label, ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return out
  }
}

// ── Stopping part way ──────────────────────────────────────────────────────

/** The cleanup of the scenario running now (null between scenarios), for a stop to run. */
export interface Pending { current: Cleanup | null }

export interface StopProcess {
  on(event: string, fn: (...a: any[]) => void): unknown
  off(event: string, fn: (...a: any[]) => void): unknown
}

const STOP_EVENTS: Record<string, number> = { SIGINT: 130, SIGTERM: 143, uncaughtException: 1, unhandledRejection: 1 }

/**
 * On Ctrl-C, a kill, or an error nothing caught: run the running scenario's
 * cleanups (last in, first out), sign out, then exit. Once, however many
 * signals arrive. Returns a function that removes the handlers.
 */
export function onStop(opts: {
  proc: StopProcess
  pending: Pending
  signOut: () => Promise<unknown>
  log: (line: string) => void
  secrets: (string | null)[]
  exit: (code: number) => void
}): () => void {
  let stopping = false
  const handlers = Object.entries(STOP_EVENTS).map(([event, code]) => {
    const fn = (err?: unknown) => {
      if (stopping) return
      stopping = true
      const why = event.startsWith('SIG') ? event : `${event}: ${err instanceof Error ? err.message : String(err)}`
      opts.log(redact(`\nStopping (${why}). Cleaning up what the running scenario made…`, opts.secrets))
      void (async () => {
        const left = opts.pending.current
        opts.pending.current = null
        const done = left ? await left.run() : []
        for (const c of done) opts.log(redact(`    ${c.ok ? 'cleaned' : 'NOT cleaned'}: ${c.label}${c.error ? ` (${c.error})` : ''}`, opts.secrets))
        await opts.signOut().catch(() => undefined)
        if (done.some((c) => !c.ok)) opts.log('Some cleanup failed. Run: npx tsx scripts/sandbox-e2e.ts --cleanup-only')
        opts.exit(code)
      })()
    }
    opts.proc.on(event, fn)
    return [event, fn] as const
  })
  return () => { for (const [event, fn] of handlers) opts.proc.off(event, fn) }
}

// ── Scenarios and the runner ───────────────────────────────────────────────

export interface Scope {
  cleanup: Cleanup
  note(message: string): void
}

export interface Scenario<C> {
  id: number
  title: string
  /** what it does and checks, for --dry-run */
  plan: string[]
  run(ctx: C, scope: Scope): Promise<void>
}

export type Outcome = 'PASS' | 'FAIL' | 'SKIP'
export interface ScenarioResult { id: number; title: string; outcome: Outcome; ms: number; detail: string; notes: string[]; cleanup: CleanupResult[] }

export interface Args { only: number[] | null; dryRun: boolean; help: boolean; cleanupOnly: boolean }

/** --only 3 / --only 3,5 / --only=3, --dry-run, --cleanup-only, --help. Anything else is refused. */
export function parseArgs(argv: string[]): Args {
  const out: Args = { only: null, dryRun: false, help: false, cleanupOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--cleanup-only') out.cleanupOnly = true
    else if (a === '--help' || a === '-h') out.help = true
    else if (a === '--only' || a.startsWith('--only=')) {
      const raw = a === '--only' ? argv[++i] : a.slice('--only='.length)
      const ids = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(Number)
      if (!ids.length || ids.some((n) => !Number.isInteger(n) || n < 1)) throw new Error(`--only takes scenario numbers, like --only 3 or --only 3,5 (got ${raw ?? 'nothing'}).`)
      out.only = [...new Set([...(out.only ?? []), ...ids])]
    } else throw new Error(`Unknown option ${a}. Use --only N, --dry-run, --cleanup-only or --help.`)
  }
  if (out.cleanupOnly && out.only) throw new Error('--cleanup-only runs no scenarios, so it takes no --only.')
  return out
}

/** The scenarios to run, in order; refuses a number that isn't one. */
export function pick<C>(list: Scenario<C>[], only: number[] | null): Scenario<C>[] {
  if (!only) return list
  const unknown = only.filter((n) => !list.some((s) => s.id === n))
  if (unknown.length) throw new Error(`No scenario ${unknown.join(', ')}. There are ${list.length} (1 to ${list[list.length - 1]?.id}).`)
  return list.filter((s) => only.includes(s.id))
}

export async function runScenarios<C>(
  list: Scenario<C>[],
  ctx: C,
  opts: { secrets: (string | null)[]; log?: (line: string) => void; now?: () => number; pending?: Pending },
): Promise<ScenarioResult[]> {
  const log = opts.log ?? (() => undefined)
  const now = opts.now ?? (() => Date.now())
  const results: ScenarioResult[] = []
  for (const s of list) {
    const cleanup = new Cleanup()
    if (opts.pending) opts.pending.current = cleanup
    const notes: string[] = []
    const scope: Scope = { cleanup, note: (m) => { notes.push(redact(m, opts.secrets)); log(`    note: ${redact(m, opts.secrets)}`) } }
    log(`\n[${s.id}] ${s.title}`)
    const started = now()
    let outcome: Outcome = 'PASS'
    let detail = ''
    try {
      await s.run(ctx, scope)
    } catch (e) {
      const msg = redact(e instanceof Error ? e.message : String(e), opts.secrets)
      if (e instanceof SkipScenario) { outcome = 'SKIP'; detail = msg }
      else { outcome = 'FAIL'; detail = e instanceof AssertionFailed ? msg : `${e instanceof Error ? e.name : 'Error'}: ${msg}` }
    }
    const cleaned = (await cleanup.run()).map((c) => ({ ...c, ...(c.error ? { error: redact(c.error, opts.secrets) } : {}) }))
    const broken = cleaned.filter((c) => !c.ok)
    if (broken.length) {
      const what = `cleanup failed: ${broken.map((c) => `${c.label} (${c.error})`).join('; ')}`
      if (outcome !== 'FAIL') outcome = 'FAIL'
      detail = detail ? `${detail}; ${what}` : what
    }
    if (opts.pending?.current === cleanup) opts.pending.current = null
    const r: ScenarioResult = { id: s.id, title: s.title, outcome, ms: now() - started, detail, notes, cleanup: cleaned }
    log(`    ${outcome}${detail ? ` - ${detail}` : ''}`)
    results.push(r)
  }
  return results
}

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))

/** The table printed at the end, then each failure's reason in full. */
export function formatSummary(results: ScenarioResult[]): string {
  const rows = results.map((r) => [String(r.id), r.title, r.outcome, `${(r.ms / 1000).toFixed(1)}s`, r.detail || r.notes[0] || ''])
  const head = ['#', 'Scenario', 'Result', 'Time', 'Why / note']
  const widths = [3, 48, 6, 7, 60]
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i])).join('  ').trimEnd()
  const out = [line(head), widths.map((w) => '-'.repeat(w)).join('  ')]
  for (const r of rows) out.push(line(r))
  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length
  out.push('', `${count('PASS')} passed, ${count('FAIL')} failed, ${count('SKIP')} skipped, of ${results.length}.`)
  const failed = results.filter((r) => r.outcome !== 'PASS' && r.detail)
  if (failed.length) {
    out.push('', 'In full:')
    for (const r of failed) out.push(`  [${r.id}] ${r.outcome}: ${r.detail}`)
  }
  return out.join('\n')
}

/** --dry-run: what each scenario would do. No network. */
export function formatPlan<C>(list: Scenario<C>[]): string {
  const out = [`Would run ${list.length} scenario${list.length === 1 ? '' : 's'} against ${PREVIEW_ORIGIN} (Square sandbox):`]
  for (const s of list) {
    out.push('', `[${s.id}] ${s.title}`)
    for (const step of s.plan) out.push(`    - ${step}`)
  }
  return out.join('\n')
}

// ── Studio dates ───────────────────────────────────────────────────────────

const TZ = 'America/Chicago'

/** YYYY-MM-DD in the studio's time zone. */
export function chicagoDate(iso: string | number | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

/** The UTC instant of HH:MM on a studio day (daylight saving handled). */
export function chicagoToUtcIso(ymd: string, hhmm: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const offsetAt = (ms: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms
  }
  let t = guess - offsetAt(guess)
  t = guess - offsetAt(t)
  return new Date(t).toISOString()
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10)
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export function weekdayOf(ymd: string): (typeof WEEKDAY_NAMES)[number] {
  const [y, m, d] = ymd.split('-').map(Number)
  return WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()]
}

/**
 * Hands out studio days for test classes: one day per call (or n days in a
 * row for a multi-day class), never the same day twice in a run, skipping
 * days `skip` says no to (closed days, café days). Classes go at 5 AM,
 * when nothing else is ever on.
 */
export class SlotAllocator {
  private next: string
  constructor(startYmd: string, private skip: (ymd: string) => boolean = () => false) { this.next = startYmd }
  days(n: number): string[] {
    const out: string[] = []
    let guard = 0
    while (out.length < n) {
      if (++guard > 1000) throw new Error('No free studio days found.')
      const d = this.next
      this.next = addDays(this.next, 1)
      if (this.skip(d)) continue
      out.push(d)
    }
    return out
  }
  sessions(n: number, opts: { capacity?: number; time?: string; minutes?: number } = {}): { startIso: string; endIso: string; capacity: number }[] {
    const time = opts.time ?? '05:00'
    const minutes = opts.minutes ?? 30
    return this.days(n).map((d) => {
      const startIso = chicagoToUtcIso(d, time)
      return { startIso, endIso: new Date(Date.parse(startIso) + minutes * 60_000).toISOString(), capacity: opts.capacity ?? 6 }
    })
  }
}

// ── Money ──────────────────────────────────────────────────────────────────

/** Tax on one seat line, as Square rounds it (and src/lib/tax.ts taxCents). */
export const lineTax = (cents: number, percent = 9) => (cents > 0 && percent > 0 ? Math.round((cents * percent) / 100) : 0)
/** The total for these seat prices, tax worked out per line. */
export const totalWithTax = (prices: number[], percent = 9) => prices.reduce((s, p) => s + p + lineTax(p, percent), 0)
