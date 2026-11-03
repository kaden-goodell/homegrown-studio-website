/**
 * Demo seed for the branch preview, so Kaden can click through everything.
 *
 * Talks ONLY to the preview (Square SANDBOX, its own stores, emails and texts
 * muted) over its own /admin and /staff APIs:
 *   https://kaden-own-booking-system--iridescent-croissant-494fc3.netlify.app
 * Any other host is refused before a request goes out. The live site and the
 * live Square catalog are only READ (GET), for the real classes' words,
 * prices, dates and photos.
 *
 * Run it (the passcodes go straight from the branch's Netlify env into this
 * process and are never printed):
 *
 *   M=/Users/catherine/source/homegrownStudio; ADMIN_PASSCODE="$(cd $M && netlify env:get ADMIN_PASSCODE --context branch:kaden/own-booking-system)" STAFF_PASSCODE="$(cd $M && netlify env:get STAFF_PASSCODE --context branch:kaden/own-booking-system)" npx tsx scripts/seed-demo.ts
 *
 * Options:
 *   --dry-run   say what it would make; reads the live list, writes nothing
 *   --remove    cancel every demo class (never refunds) and archive its library entry
 *
 * Re-runnable: everything is looked up first (library entries by the demo
 * note and name, classes by library entry and start), so a second run adds
 * nothing twice. Nothing it makes is named "E2E …" (the sandbox suite's
 * cleanup deletes those).
 */
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import {
  actAsOwner, chicagoDate, MissingSecretError, OWNER_HEADERS, PreviewClient, PREVIEW_ORIGIN, readSecrets, redact, sayReply, type Reply,
} from './lib/sandbox-e2e/core'
import {
  contentFromLive, DEMO_NOTE, isDemoLibrary, libraryName, LiveReader, parseSeedArgs, slotFor, type LiveWorkshop,
} from './lib/demo-seed/core'

type Log = (line: string) => void

export interface SeedCtx {
  admin: PreviewClient
  staff: PreviewClient
  live: LiveReader
  log: Log
  now: Date
  dryRun: boolean
  made: string[]
  skipped: string[]
}

const DAY = 86_400_000

function ok(r: Reply, what: string, wanted = 200): any {
  if (r.status !== wanted) throw new Error(`${what}: ${sayReply(r)}`)
  return r.body
}

const adminGet = (ctx: SeedCtx, p: string) => ctx.admin.request('GET', p, { headers: OWNER_HEADERS })
const adminPost = (ctx: SeedCtx, p: string, body: unknown) => ctx.admin.request('POST', p, { body, headers: OWNER_HEADERS })

/** Reads a local .env value (the live Square token), never printed. */
function dotenv(key: string): string | null {
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8')
    for (const line of text.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '').trim() || null
    }
  } catch { /* no .env */ }
  return null
}

// ── Library and classes ────────────────────────────────────────────────────

export async function demoLibrary(ctx: SeedCtx, archived = false): Promise<any[]> {
  const body = ok(await adminGet(ctx, `/api/admin/classes/library.json${archived ? '?archived=1' : ''}`), 'Read the class library')
  return (body.data.library ?? []).filter(isDemoLibrary)
}

async function classesAround(ctx: SeedCtx): Promise<any[]> {
  const from = new Date(ctx.now.getTime() - DAY).toISOString()
  const to = new Date(ctx.now.getTime() + 400 * DAY).toISOString()
  const body = ok(await adminGet(ctx, `/api/admin/classes/classes.json?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`), 'Read the classes')
  return Array.isArray(body.data) ? body.data : body.data?.classes ?? []
}

/** Uploads a live photo through the preview's own class-photo upload; its preview URL, or null (said why). */
export async function copyPhoto(ctx: SeedCtx, liveUrl: string | null | undefined, name: string): Promise<string | null> {
  if (!liveUrl) return null
  try {
    const { bytes, type } = await ctx.live.photo(liveUrl)
    const form = new FormData()
    form.append('file', new Blob([bytes as BlobPart], { type }), type === 'image/png' ? 'photo.png' : type === 'image/webp' ? 'photo.webp' : 'photo.jpg')
    const r = await ctx.admin.upload('/api/admin/classes/photo.json', form, OWNER_HEADERS)
    return ok(r, `Upload the photo for ${name}`).data.url
  } catch (e) {
    ctx.skipped.push(`${name}: photo not copied (${e instanceof Error ? e.message : String(e)})`)
    return null
  }
}

/** The demo library entry with this name (made with the demo note, photo copied, on first sight). */
export async function ensureLibrary(ctx: SeedCtx, lib: any[], content: any, livePhoto: string | null | undefined): Promise<any> {
  const have = lib.find((l) => libraryName(l).toLowerCase() === String(content.name).toLowerCase())
  if (have) return have
  if (ctx.dryRun) { ctx.log(`  would add ${content.name} to the library`); return { id: `dry:${content.name}`, versions: [{ content }] } }
  const imageUrl = await copyPhoto(ctx, livePhoto, content.name)
  const saved = ok(await adminPost(ctx, '/api/admin/classes/library.json', { action: 'save', content: { ...content, imageUrl }, note: DEMO_NOTE }), `Add ${content.name} to the library`)
  const entry = saved.data.library
  lib.push(entry)
  ctx.made.push(`library: ${content.name}${imageUrl ? ' (with photo)' : ''}`)
  return entry
}

/** One class on the preview from a library entry, unless one already starts then (status not cancelled). */
export async function ensureClass(
  ctx: SeedCtx, classes: any[], entry: any, sessions: { startIso: string; endIso: string; capacity: number }[], extra: Record<string, unknown> = {},
): Promise<any | null> {
  const name = libraryName(entry)
  const first = sessions[0].startIso
  const have = classes.find((c) => c.libraryId === entry.id && c.status !== 'cancelled' && c.sessions?.[0]?.startIso === first)
  const when = `${chicagoDate(first)} ${new Date(first).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })}`
  if (have) { ctx.log(`  already there: ${name} ${when}`); return have }
  if (ctx.dryRun) { ctx.log(`  would schedule ${name} ${when}`); return null }
  const r = await adminPost(ctx, '/api/admin/classes/classes.json', { action: 'create', libraryId: entry.id, sessions, status: 'open', ...extra })
  if (r.status !== 200) {
    ctx.skipped.push(`${name} ${when}: ${sayReply(r)}`)
    ctx.log(`  NOT scheduled: ${name} ${when} (${sayReply(r)})`)
    return null
  }
  const cls = r.body.data.class
  classes.push(cls)
  ctx.made.push(`class: ${name} ${when}${r.body.warning ? ` (warning: ${r.body.warning})` : ''}`)
  ctx.log(`  scheduled ${name} ${when}${r.body.warning ? ` (warning: ${r.body.warning})` : ''}`)
  return cls
}

// ── Sections ───────────────────────────────────────────────────────────────

/** Every class on the live site today, copied at its own date and time (or the next week's when it's too soon). */
export async function seedLiveWorkshops(ctx: SeedCtx, lib: any[], classes: any[]): Promise<void> {
  ctx.log('\nThe live classes:')
  const live: LiveWorkshop[] = (await ctx.live.workshops()).filter((w) => w?.name && w.startTime && !/^TEST\b/i.test(w.name))
  ctx.log(`  the live site lists ${live.length}`)
  for (const w of live) {
    const content = contentFromLive(w)
    const entry = await ensureLibrary(ctx, lib, content, w.imageUrl)
    const slot = slotFor(w.startTime, content.defaultMinutes, ctx.now)
    await ensureClass(ctx, classes, entry, [{ ...slot, capacity: content.defaultCapacity }])
  }
}

/** --remove: cancel every class made from a demo library entry (never refunds), then archive the entries. */
export async function removeDemo(ctx: SeedCtx): Promise<void> {
  const lib = await demoLibrary(ctx)
  const ids = new Set(lib.map((l) => l.id))
  const classes = (await classesAround(ctx)).filter((c) => ids.has(c.libraryId) && c.status !== 'cancelled')
  for (const c of classes) {
    const r = await adminPost(ctx, '/api/admin/classes/classes.json', { action: 'cancel', id: c.id, expectedUpdatedAt: c.updatedAt })
    if (r.status === 200) ctx.made.push(`cancelled ${c.content?.name} ${chicagoDate(c.sessions[0].startIso)}`)
    else ctx.skipped.push(`cancel ${c.content?.name}: ${sayReply(r)}`)
  }
  for (const l of lib) {
    const r = await adminPost(ctx, '/api/admin/classes/library.json', { action: 'archive', id: l.id })
    if (r.status === 200) ctx.made.push(`archived ${libraryName(l)}`)
    else ctx.skipped.push(`archive ${libraryName(l)}: ${sayReply(r)}`)
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function preflight(ctx: SeedCtx, secrets: { adminPasscode: string }): Promise<void> {
  const a = await ctx.admin.post('/api/admin/login.json', { passcode: secrets.adminPasscode })
  ok(a, 'Sign in to /admin')
  if (!ctx.admin.jar.has('hg_admin')) throw new Error('Signed in to /admin but no cookie came back')
  actAsOwner(a.body?.data?.owners)
  const sandbox = ok(await adminGet(ctx, '/api/admin/classes/seed-sandbox.json'), 'Ask the preview which Square it uses')
  if (sandbox.data?.sandbox !== true) throw new Error('The preview is not on the Square sandbox. Stopping before anything is made.')
  const muted = ok(await adminGet(ctx, '/api/admin/preview-messages.json'), 'Ask the preview whether its emails and texts are muted')
  if (muted.data?.muted !== true) throw new Error('The preview would send real emails and texts (not muted). Stopping before anything is made.')
}

export async function main(argv: string[], env: Record<string, string | undefined>): Promise<number> {
  let args
  try { args = parseSeedArgs(argv) } catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 2 }
  if (args.help) { console.log('npx tsx scripts/seed-demo.ts [--dry-run] [--remove]   (see the header of this file)'); return 0 }
  let secrets
  try { secrets = readSecrets(env) } catch (e) {
    if (e instanceof MissingSecretError) { console.error(e.message.replace('scripts/sandbox-e2e.ts', 'scripts/seed-demo.ts')); return 2 }
    throw e
  }
  const liveToken = (env.SQUARE_ACCESS_TOKEN ?? '').trim() || dotenv('SQUARE_ACCESS_TOKEN')
  const hide = [secrets.adminPasscode, secrets.staffPasscode, liveToken]
  const log: Log = (line) => console.log(redact(line, hide))
  const ctx: SeedCtx = {
    admin: new PreviewClient(), staff: new PreviewClient(), live: new LiveReader(fetch, liveToken),
    log, now: new Date(), dryRun: args.dryRun, made: [], skipped: [],
  }
  try {
    await preflight(ctx, secrets)
    log(`Signed in to ${PREVIEW_ORIGIN} (sandbox, messages muted) as ${OWNER_HEADERS['X-Admin-Who']}.`)
    if (args.remove) {
      await removeDemo(ctx)
    } else {
      const lib = await demoLibrary(ctx)
      const classes = await classesAround(ctx)
      await seedLiveWorkshops(ctx, lib, classes)
    }
  } catch (e) {
    log(`Stopped: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  } finally {
    await ctx.admin.request('DELETE', '/api/admin/login.json').catch(() => undefined)
    if (ctx.staff.jar.has('hg_staff')) await ctx.staff.request('DELETE', '/api/staff/login.json').catch(() => undefined)
    log(`\n${args.remove ? 'Removed' : 'Made'} ${ctx.made.length}:`)
    for (const m of ctx.made) log(`  - ${m}`)
    if (ctx.skipped.length) { log(`Skipped ${ctx.skipped.length}:`); for (const s of ctx.skipped) log(`  - ${s}`) }
  }
  return ctx.skipped.length ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code))
}
