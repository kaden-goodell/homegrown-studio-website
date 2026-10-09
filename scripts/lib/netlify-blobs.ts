/**
 * Read and write PRODUCTION Netlify Blobs from a laptop, through the authed
 * `netlify` CLI — the same approach as scripts/set-event.ts. Site stores are
 * site-wide, so this is the data the live site and /staff see.
 *
 * Off Netlify, the app's own `makeKvStore` falls back to `.data/` on disk, so
 * a CLI that used it would quietly read and write the laptop instead.
 */
import { execFile, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Stop with a clear message unless the `netlify` CLI is installed and runs. */
export function requireNetlifyCli(): void {
  const r = spawnSync('netlify', ['--version'], { encoding: 'utf8' })
  if (r.error || r.status !== 0) {
    console.error(
      '✗ The `netlify` CLI is not available, so production can’t be reached.\n' +
        '  Install it (npm i -g netlify-cli), then run `netlify login` and `netlify link` in this repo.',
    )
    process.exit(1)
  }
  // --version passes even when not logged in or linked; a real list call proves
  // production is reachable before anything is created in Square.
  const l = spawnSync('netlify', ['blobs:list', 'gift-cards', '--json'], { encoding: 'utf8' })
  if (l.error || l.status !== 0) {
    console.error(
      '✗ The `netlify` CLI can’t read production blobs (not logged in or not linked?).\n' +
        '  Run `netlify login` and `netlify link` in this repo, then try again.\n' +
        `  ${(l.stderr || l.stdout || '').trim().split('\n')[0] ?? ''}`,
    )
    process.exit(1)
  }
}

/** Keys from `netlify blobs:list --json`, whichever shape the CLI prints. */
export function parseBlobKeys(stdout: string): string[] {
  const start = stdout.search(/[[{]/)
  if (start < 0) return []
  const parsed: unknown = JSON.parse(stdout.slice(start))
  const items: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { blobs?: unknown[] })?.blobs)
      ? (parsed as { blobs: unknown[] }).blobs
      : []
  return items
    .map((b) => (typeof b === 'string' ? b : (b as { key?: unknown })?.key))
    .filter((k): k is string => typeof k === 'string')
}

export async function blobKeys(store: string, prefix?: string): Promise<string[]> {
  const args = ['blobs:list', store, '--json', ...(prefix ? ['--prefix', prefix] : [])]
  const { stdout } = await run('netlify', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return parseBlobKeys(stdout)
}

/** The stored text, or null when the key doesn't exist. Any other failure throws. */
export async function blobGet(store: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await run('netlify', ['blobs:get', store, key], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    return stdout
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string }
    if (/does not exist in store/i.test(`${e.stderr ?? ''}\n${e.stdout ?? ''}`)) return null
    throw err
  }
}

export async function blobSet(store: string, key: string, text: string): Promise<void> {
  const file = join(mkdtempSync(join(tmpdir(), `${store}-`)), 'value.json')
  writeFileSync(file, text)
  await run('netlify', ['blobs:set', store, key, '--input', file], { encoding: 'utf8' })
}

/** Run `fn` over `items`, at most `limit` at a time, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}
