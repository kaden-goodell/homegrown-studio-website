/**
 * Two background jobs whose failure nobody would otherwise see, as owner-only
 * Home lines (and in the daily email):
 *
 *   archive-stale        (final concurrency review I-9) the weekly records
 *                        archive's newest snapshot is more than 8 days old, or
 *                        its last run started and never finished.
 *   webhook-url-mismatch (final money review M14) Square's notices arrive
 *                        signed for a different web address than the one the
 *                        site was set up with. The site checks the signature
 *                        against the address the notice actually came to and,
 *                        when that matches, takes it (so refunds made in
 *                        Square still land); this line says the setup is off.
 *
 * Read only for the warnings; never throws. Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import type { Warning } from '@lib/warnings'

const logger = createLogger('system-checks')
const checks = makeKvStore('system-checks', 'system-checks')
const archive = makeKvStore('archive', 'archive')

export const ARCHIVE_STALE_DAYS = 8
const WEBHOOK_KEY = 'webhook-url'
const WEBHOOK_SHOWN_DAYS = 7

/** The webhook route: a notice verified only against the address it came to. Best effort. */
export async function noteWebhookUrlMismatch(cameTo: string, now = new Date()): Promise<void> {
  try {
    await checks.set(WEBHOOK_KEY, JSON.stringify({ at: now.toISOString(), cameTo }))
  } catch (err) {
    logger.error('Webhook address note not saved', { error: String(err) })
  }
}

async function webhookLine(now: Date): Promise<Warning | null> {
  const raw = await checks.get(WEBHOOK_KEY)
  if (!raw) return null
  const { at, cameTo } = JSON.parse(raw) as { at: string; cameTo: string }
  if (now.getTime() - Date.parse(at) > WEBHOOK_SHOWN_DAYS * 86_400_000) return null
  return {
    code: 'webhook-url-mismatch', eventKind: 'workshop', eventId: '', when: at, title: 'Square notices', itemId: 'webhook-url-mismatch',
    detail: `Square’s notices (payments and refunds made in Square) come to ${cameTo}, not the address the site was set up with. The site takes them anyway, so nothing is lost.`,
    action: `Nothing to do today. To clear this line, the website’s “Square notices address” setting (SQUARE_WEBHOOK_URL, in the hosting settings, see Help › Square notices) should be ${cameTo}.`,
  }
}

async function archiveLine(now: Date): Promise<Warning | null> {
  const [keys, progressRaw] = await Promise.all([
    archive.list('archive/').then((k) => k.filter((x) => x.startsWith('archive/'))),
    archive.get('progress/last.json'),
  ])
  const progress = progressRaw ? (JSON.parse(progressRaw) as { startedAt?: string; finishedAt?: string | null }) : null
  // A site where the weekly archive has never run (a test site: scheduled jobs don't run there) shows nothing.
  if (!keys.length && !progress) return null
  const newest = keys.map((k) => k.slice('archive/'.length, 'archive/'.length + 10)).sort().at(-1) ?? null
  const ageDays = newest ? (now.getTime() - Date.parse(`${newest}T12:00:00Z`)) / 86_400_000 : Infinity
  const unfinished = !!progress?.startedAt && !progress.finishedAt && now.getTime() - Date.parse(progress.startedAt) > 60 * 60_000
  if (ageDays <= ARCHIVE_STALE_DAYS && !unfinished) return null
  return {
    code: 'archive-stale', eventKind: 'workshop', eventId: '', when: now.toISOString(), title: 'Records backup', itemId: 'archive-stale',
    detail: newest
      ? `The weekly records backup hasn’t finished since ${newest}${unfinished ? ' (the last one started and was stopped)' : ''}. Nothing was deleted.`
      : 'The weekly records backup started and was stopped before it finished. Nothing was deleted.',
    action: 'Save a copy now: More › Records › Everything › Download records. The weekly backup tries again on Sunday.',
  }
}

/** The owner-only system lines. Never throws (a check that can't be read is left out and logged). */
export async function systemWarnings(now = new Date()): Promise<Warning[]> {
  const out: Warning[] = []
  for (const [what, fn] of [['webhook', webhookLine], ['archive', archiveLine]] as const) {
    try {
      const w = await fn(now)
      if (w) out.push(w)
    } catch (err) {
      logger.error(`System check failed: ${what}`, { error: String(err) })
    }
  }
  return out
}
