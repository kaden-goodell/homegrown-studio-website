import 'dotenv/config'

/**
 * Manual run of the weekly self-archive (HOM-217) — the same exporter the
 * scheduled `netlify/functions/archive-records.ts` runs, against the real
 * stores via `makeKvStore` (Netlify Blobs in a linked-site context,
 * `.data/*` on disk otherwise — see `@lib/blob-store`).
 *
 * Usage:
 *   npx tsx scripts/archive-records.ts --out ./archive-2026-09-28.zip   # write locally
 *   npx tsx scripts/archive-records.ts                                   # email it (ARCHIVE_TO, default kaden@ourhometownstudio.com)
 */
import { writeFile } from 'node:fs/promises'
import { makeKvStore } from '../src/lib/blob-store'
import { exportAll, buildArchiveAttachments, type ArchiveStoreSpec } from '../src/lib/archive-export'
import { sendEmail } from '../src/lib/email'

// Same store/fsDir names every store module uses (@lib/waiver-store,
// @lib/rsvp-store, @lib/checkin-store, @lib/incident-store, @lib/event-meta,
// @lib/open-studio-store) — identical for every one of them today.
const STORE_NAMES = ['waivers', 'rsvps', 'checkins', 'incidents', 'event-meta', 'open-studio'] as const
// NOTE: `otps` (HOM-218) deliberately excluded — throwaway 10-minute-TTL
// data, no legal-retention value. Same call as the scheduled function.

function parseOut(): string | null {
  const idx = process.argv.indexOf('--out')
  return idx !== -1 ? process.argv[idx + 1] ?? null : null
}

async function main() {
  const out = parseOut()
  const stores: ArchiveStoreSpec[] = STORE_NAMES.map((name) => ({ name, store: makeKvStore(name, name) }))
  const result = await exportAll(stores)
  const attachments = buildArchiveAttachments(result, [...STORE_NAMES])
  const dateStr = result.generatedAt.slice(0, 10)
  const subject =
    `Hometown Studio records archive — ${dateStr} — ` +
    `${result.counts.waivers ?? 0} signatures · ${result.counts.rsvps ?? 0} RSVPs · ${result.counts.incidents ?? 0} incidents`

  if (out) {
    if (attachments.length === 1) {
      await writeFile(out, attachments[0].content)
      console.log(`Wrote ${out}`)
    } else {
      for (const a of attachments) {
        const path = out.replace(/\.zip$/, '') + `-${a.filename}`
        await writeFile(path, a.content)
        console.log(`Wrote ${path}`)
      }
    }
    console.log('Counts:', result.counts)
    return
  }

  const to = process.env.ARCHIVE_TO || 'kaden@ourhometownstudio.com'
  const countsBlock = JSON.stringify(result.counts, null, 2)
  if (attachments.length === 1) {
    const { sent } = await sendEmail({
      to,
      subject,
      text: `Weekly records archive attached.\n\n${countsBlock}`,
      html: `<p>Weekly records archive attached.</p><pre>${countsBlock}</pre>`,
      attachments: [
        {
          filename: attachments[0].filename,
          content: Buffer.from(attachments[0].content).toString('base64'),
          contentType: 'application/zip',
          encoding: 'base64',
        },
      ],
    })
    console.log(sent ? `Emailed archive to ${to}` : 'Email NOT configured/failed — see logs above.', result.counts)
  } else {
    let allSent = true
    for (const a of attachments) {
      const { sent } = await sendEmail({
        to,
        subject: `${subject} — part: ${a.filename}`,
        text: `Archive split across multiple emails (combined zip exceeded 20 MB). This part: ${a.filename}.`,
        html: `<p>Archive split across multiple emails (&gt;20MB). This part: ${a.filename}.</p>`,
        attachments: [
          { filename: a.filename, content: Buffer.from(a.content).toString('base64'), contentType: 'application/zip', encoding: 'base64' },
        ],
      })
      allSent = allSent && sent
    }
    console.log(allSent ? `Emailed archive (split, ${attachments.length} parts) to ${to}` : 'One or more parts NOT sent — see logs above.', result.counts)
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
