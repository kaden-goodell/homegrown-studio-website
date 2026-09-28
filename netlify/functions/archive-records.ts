import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { exportAll, buildArchiveAttachments, type ArchiveKvStore } from '../../src/lib/archive-export'

/**
 * Weekly self-archive (HOM-217, Audit finding H3): exports every legal
 * record (waivers, RSVPs, custody logs, incidents, event/open-studio meta)
 * to a blob snapshot AND emails a zip off-platform. "The site got deleted"
 * or "we moved off Netlify" must not take the evidence with it — a minor's
 * injury claim in Alabama tolls to age 21.
 *
 * Self-contained: Netlify functions can't resolve the `@lib/*` path aliases
 * the rest of the app uses, so this imports the pure exporter by a RELATIVE
 * path (esbuild bundles that fine) and duplicates the Gmail/nodemailer
 * transport from `src/lib/email.ts` inline rather than importing it.
 *
 * Sunday 03:00 America/Chicago is 08:00 UTC in CDT (summer) and 09:00 UTC in
 * CST (winter) — this cron is fixed at 08:00 UTC, so the run drifts to 02:00
 * local during CST. Accepted: it's a weekly background job, not a
 * customer-facing time, and drifting an hour earlier on a Sunday is harmless.
 */
export const config: Config = { schedule: '0 8 * * 0' }

const STORE_NAMES = [
  'waivers',
  'rsvps',
  'checkins',
  'incidents',
  'event-meta',
  'open-studio',
  // NOTE: the `otps` store (HOM-218, one-time SMS codes) is deliberately
  // excluded — it's throwaway data (10-minute TTL, consumed on use) with no
  // legal-retention value, not a record of anything that happened.
] as const

function blobKvStore(name: string): ArchiveKvStore {
  const store = getStore({ name, consistency: 'strong' })
  return {
    async list() {
      const { blobs } = await store.list()
      return blobs.map((b: { key: string }) => b.key)
    },
    async get(key: string) {
      return (await store.get(key, { type: 'text' })) ?? null
    },
  }
}

function gmailCreds(): { user: string; pass: string } | null {
  const user = process.env.GMAIL_USER || ''
  const pass = process.env.GMAIL_APP_PASSWORD || ''
  return user && pass ? { user, pass } : null
}

let transport: any = null

/** Duplicated from `src/lib/email.ts` (functions can't import `src/`) —
 *  same Gmail SMTP transport, same "skip, don't throw, when unconfigured"
 *  behavior. Returns whether it actually sent. */
async function sendMail(input: {
  to: string
  subject: string
  text: string
  attachments?: { filename: string; content: Buffer }[]
}): Promise<boolean> {
  const creds = gmailCreds()
  if (!creds) {
    console.warn('[archive-records] GMAIL_USER/GMAIL_APP_PASSWORD not set — skipping send', { subject: input.subject })
    return false
  }
  try {
    if (!transport) {
      const nm = await import('nodemailer')
      transport = (nm.default ?? nm).createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: creds.user, pass: creds.pass },
      })
    }
    await transport.sendMail({
      from: `"Hometown Studio Records" <${creds.user}>`,
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    })
    return true
  } catch (err) {
    console.error('[archive-records] send failed', err instanceof Error ? err.message : String(err))
    return false
  }
}

function archiveTo(): string {
  return process.env.ARCHIVE_TO || 'kaden@ourhometownstudio.com'
}

export default async () => {
  const to = archiveTo()
  const dryRun = process.env.ARCHIVE_DRY_RUN === '1'
  const dateStr = new Date().toISOString().slice(0, 10)

  try {
    const stores = STORE_NAMES.map((name) => ({ name, store: blobKvStore(name) }))
    const result = await exportAll(stores)

    // Snapshot the full export into its own blob store, independent of email
    // delivery — the off-platform email copy and the on-platform snapshot
    // are each a complete backup on their own.
    const archiveStore = getStore({ name: 'archive', consistency: 'strong' })
    await archiveStore.set(`archive/${dateStr}.json`, JSON.stringify(result, null, 2))

    const attachments = buildArchiveAttachments(result, [...STORE_NAMES])
    const subject =
      `Hometown Studio records archive — ${dateStr} — ` +
      `${result.counts.waivers ?? 0} signatures · ${result.counts.rsvps ?? 0} RSVPs · ${result.counts.incidents ?? 0} incidents`

    if (dryRun) {
      const { writeFile } = await import('node:fs/promises')
      if (attachments.length === 1) {
        await writeFile(`/tmp/archive-${dateStr}.zip`, attachments[0].content)
      } else {
        for (const a of attachments) await writeFile(`/tmp/${a.filename}`, a.content)
      }
      console.log('[archive-records] ARCHIVE_DRY_RUN — wrote to /tmp instead of emailing', {
        subject,
        counts: result.counts,
        files: attachments.map((a) => a.filename),
      })
      return new Response(JSON.stringify({ dryRun: true, subject, counts: result.counts }), { status: 200 })
    }

    let sent: boolean
    if (attachments.length === 1) {
      sent = await sendMail({
        to,
        subject,
        text: `Weekly records archive attached.\n\n${JSON.stringify(result.counts, null, 2)}`,
        attachments: [{ filename: attachments[0].filename, content: Buffer.from(attachments[0].content) }],
      })
    } else {
      // Attachment > 20 MB — split per store so one oversized store never
      // blocks the rest of the archive from going out.
      sent = true
      for (const a of attachments) {
        const one = await sendMail({
          to,
          subject: `${subject} — part: ${a.filename}`,
          text: `Archive split across multiple emails (combined zip exceeded 20 MB). This part: ${a.filename}.`,
          attachments: [{ filename: a.filename, content: Buffer.from(a.content) }],
        })
        sent = sent && one
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, subject, counts: result.counts }), { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[archive-records] Archive FAILED', message)
    // Never swallow — a failed archive with no failure email is a silent
    // gap in the legal record trail (the whole point of HOM-217).
    try {
      await sendMail({ to, subject: `Archive FAILED — ${message}`, text: `The weekly records archive failed:\n\n${message}` })
    } catch (mailErr) {
      console.error('[archive-records] Archive FAILED email also failed to send', mailErr)
    }
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500 })
  }
}
