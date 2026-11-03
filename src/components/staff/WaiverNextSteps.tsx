import { useState } from 'react'
import QrModal from '@components/staff/QrModal'
import { signOnIpad } from '@components/staff/DoorSearch'
import { btn } from '@components/staff/ui'
import { SITE_URL } from '@config/site-url'
import type { EventKind } from '@lib/events'

/**
 * The next step for a family who needs to sign for this event (crew review
 * I2): sign on this iPad (lands back on this roster), show the event's QR,
 * or text them the link. A household with a waiver on file is texted at its
 * signed phone (`recordId`); a class booker who never signed is found by the
 * email on their booking (`email`). The phone number never reaches this page.
 */
export default function WaiverNextSteps({
  kind,
  id,
  title,
  day,
  recordId,
  email,
  signLabel = 'Sign on this iPad',
}: {
  kind: EventKind
  id: string
  title: string
  day?: string
  recordId?: string
  email?: string
  signLabel?: string
}) {
  const [qrOpen, setQrOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<null | { text: string; ok: boolean }>(null)
  const canText = !!(recordId || email)

  async function text() {
    if (sending) return
    setSending(true)
    setNote(null)
    try {
      const res = await fetch('/api/staff/send-waiver-link.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, ...(recordId ? { recordId } : { email }) }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) setNote({ text: json?.error ?? 'The text didn’t send. Show them the QR code instead.', ok: false })
      else if (json?.data?.sent) setNote({ text: 'Texted. They can sign on their phone now.', ok: true })
      else setNote({ text: 'The text didn’t send. Show them the QR code instead.', ok: false })
    } catch {
      setNote({ text: 'Couldn’t reach the website — check wifi, or show them the QR code.', ok: false })
    } finally {
      setSending(false)
    }
  }

  return (
    <div data-testid="waiver-next-steps">
      <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => signOnIpad({ kind, id, title, ...(day ? { day } : {}) })} style={{ ...btn(true), flex: '1 1 9rem' }}>{signLabel}</button>
        {canText && (
          <button type="button" disabled={sending} onClick={text} style={{ ...btn(), flex: '1 1 9rem', ...(sending ? { opacity: 0.6 } : {}) }}>
            {sending ? 'Sending…' : 'Text them the link'}
          </button>
        )}
        <button type="button" onClick={() => setQrOpen(true)} style={{ ...btn(), flex: '0 1 auto' }}>Show QR</button>
      </div>
      {note && (
        <p role={note.ok ? 'status' : 'alert'} style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', fontWeight: 600, color: note.ok ? 'rgb(21,128,61)' : '#b91c1c' }}>{note.text}</p>
      )}
      {qrOpen && <QrModal url={`${SITE_URL}/waiver?${kind}=${encodeURIComponent(id)}`} onClose={() => setQrOpen(false)} />}
    </div>
  )
}
