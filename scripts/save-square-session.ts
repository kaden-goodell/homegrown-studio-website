/**
 * Save your Square sign-in so the site can add comped seats without anyone
 * opening Square. Square ends the session now and then; when /staff says the
 * Square connection expired, run this again.
 *
 *   1. Chrome, signed in at app.squareup.com → View → Developer → Developer Tools
 *      → Network tab → reload → right-click any app.squareup.com request
 *      → Copy → Copy as cURL
 *   2. npx tsx scripts/save-square-session.ts          (reads the clipboard)
 *
 * Saves to: production (Netlify Blobs, takes effect at once — no deploy),
 * local dev (.data/square-session), and captures/.square-session (the
 * class-creation script). Never prints the session.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkSession, cookieFromCurl, saveSession } from '../src/lib/square-dashboard'
import { requireNetlifyCli } from './lib/netlify-blobs'

async function firstScheduleId(): Promise<string> {
  const res = await fetch('https://ourhometownstudio.com/api/workshops.json')
  const body: any = await res.json()
  const list: any[] = Array.isArray(body) ? body : body.workshops ?? body.data ?? []
  const id = list.find((w) => typeof w.classScheduleId === 'string')?.classScheduleId
  if (!id) throw new Error('No upcoming class to test the sign-in against.')
  return id
}

async function main() {
  // Piped in (`… < file`) or, by default, the clipboard.
  const fromStdin = !process.stdin.isTTY
  const pasted = fromStdin ? readFileSync(0, 'utf8') : execFileSync('pbpaste', { encoding: 'utf8' })
  const cookie = cookieFromCurl(pasted)
  if (!cookie) {
    console.error('✗ The clipboard has no Square sign-in in it. Copy a request to app.squareup.com as cURL (see the top of this file) and run again.')
    process.exit(1)
  }
  requireNetlifyCli()

  const scheduleId = await firstScheduleId()
  const check = await checkSession(scheduleId, cookie)
  if (check.state !== 'connected') {
    console.error(`✗ Square didn't accept that sign-in (${check.state === 'expired' ? 'signed out' : JSON.stringify(check)}). Sign in to Square in Chrome, copy a fresh request, and run again.`)
    process.exit(1)
  }
  console.log('✓ Square accepts the sign-in from this Mac.')

  const savedAt = new Date().toISOString()
  const dir = mkdtempSync(join(tmpdir(), 'sqs-'))
  try {
    const file = join(dir, 'value.json')
    writeFileSync(file, JSON.stringify({ cookie, savedAt }), { mode: 0o600 })
    const r = spawnSync('netlify', ['blobs:set', 'square-session', 'cookie', '--input', file], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`netlify blobs:set failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log('✓ Saved for the live site and previews.')

  await saveSession(cookie, savedAt)
  mkdirSync('captures', { recursive: true })
  writeFileSync('captures/.square-session', cookie, { mode: 0o600 })
  console.log('✓ Saved for local dev and the class-creation script.')
  // Clear the clipboard so the sign-in isn't left lying around.
  if (!fromStdin) {
    spawnSync('pbcopy', { input: '' })
    console.log('Clipboard cleared.')
  }
}

main().catch((err) => {
  console.error('✗', err instanceof Error ? err.message : err)
  process.exit(1)
})
