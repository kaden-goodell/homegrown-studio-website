import { useEffect, useRef, useState, type CSSProperties } from 'react'
import QRCode from 'qrcode'
import { btn, field } from '@components/staff/ui'

/**
 * "Calendar on my phone" (stage 3): a private link that puts the person's
 * shifts in their phone's calendar and keeps them up to date. The link is
 * shown once, when it's made (only a scrambled copy is kept), so "Make a new
 * link" is how to get it again, and it stops the old one. Every
 * are-you-sure is asked here in the sheet, never a browser pop-up.
 *
 * The studio iPad is shared, so:
 *   - the sheet says to do this on your own phone, and offers a code to scan
 *     with your own phone's camera (made here, on the device: no outside service);
 *   - a fresh link stays hidden until "Show my link", and hides itself again
 *     after a few minutes;
 *   - a stray tap outside the sheet doesn't close it while the link is out;
 *   - the sheet lives inside My shifts, which is rebuilt for each person, so
 *     Switch person or Log out closes it and forgets the link.
 */

type View = 'start' | 'confirm-new' | 'confirm-stop' | 'links' | 'stopped' | 'hidden'

/**
 * The words that differ between a crew member's own shifts (/staff) and an
 * owner's whole-studio link (/admin › More › Staff). An owner never reads
 * "When Catherine or Kaden put you on something".
 */
export interface LinkCopy {
  title: string
  linksTitle: string
  intro: string
  has: string
  calendarName: string
  privacy: string
  iphoneShows: string
  androidOnIpad: string
  googleSlow: string
  confirmStop: string
  startButton: string
}

export const CREW_COPY: LinkCopy = {
  title: 'My shifts on my phone',
  linksTitle: 'Your calendar link',
  intro: 'Get a private link that puts your shifts in your phone’s calendar. When you’re put on something, or a time changes, your phone updates by itself.',
  has: 'You already have a calendar link. For your privacy it was only shown once, when it was made.',
  calendarName: 'Hometown Studio · my shifts',
  privacy: 'This link is only shown now. Keep it private: anyone with it can see your shifts.',
  iphoneShows: 'Tap it, tap Subscribe, then tap Add. Your shifts show in the Calendar app.',
  androidOnIpad: 'Do these steps on your own phone. On the iPad? Open ourhometownstudio.com/staff on your phone and make your link there.',
  googleSlow: 'Google can take up to a day to show changes. The text from the studio is the quick way to hear.',
  confirmStop: 'Your shifts stop updating on any phone that has it. You can make a new one any time.',
  startButton: 'Get my calendar link',
}

export const OWNER_COPY: LinkCopy = {
  title: 'The studio on my phone',
  linksTitle: 'Your calendar link',
  intro: 'Get a private link that puts every class, party, closed day and blocked time in your phone’s calendar, with who’s on each one. Anything that still needs someone starts with ⚠. When something changes, your phone updates by itself.',
  has: 'You already have a calendar link for the whole studio. For your privacy it was only shown once, when it was made.',
  calendarName: 'Hometown Studio',
  privacy: 'This link is only shown now. Keep it private: anyone with it can see the studio’s schedule and who’s working.',
  iphoneShows: 'Tap it, tap Subscribe, then tap Add. The studio’s schedule shows in the Calendar app.',
  androidOnIpad: 'Do these steps on your own phone. On the iPad? Open ourhometownstudio.com/admin on your phone, go to More, Staff, and make your link there.',
  googleSlow: 'Google can take up to a day to show changes. This page always has the latest.',
  confirmStop: 'The studio’s schedule stops updating on any phone that has it. You can make a new one any time.',
  startButton: 'Get my calendar link',
}

/** A shown link hides itself after this long (someone may walk away from the iPad). */
export const LINK_SHOW_MS = 3 * 60_000

const sheetBtn = (primary = false): CSSProperties => ({ ...btn(primary), minHeight: '3rem', fontSize: '1rem', width: '100%', textAlign: 'center' })
const help: CSSProperties = { margin: 0, fontSize: '0.95rem', color: 'var(--color-dark)', lineHeight: 1.5 }
const ownPhone: CSSProperties = { ...help, padding: '0.7rem 0.85rem', borderRadius: '0.75rem', background: 'rgba(var(--color-primary-rgb),0.08)' }

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function CalendarLinkSheet({ has, onClose, onChanged, endpoint = '/api/staff/feed.json', headers, copy: words = CREW_COPY }: {
  has: boolean
  onClose: () => void
  onChanged: (has: boolean) => void
  /** Where the link is made and stopped: the crew's own (/api/staff/feed.json) or an owner's (/api/admin/feed.json). */
  endpoint?: string
  /** Extra headers (an owner's X-Admin-Who). */
  headers?: Record<string, string>
  copy?: LinkCopy
}) {
  const [view, setView] = useState<View>('start')
  const [links, setLinks] = useState<{ https: string; webcal: string } | null>(null)
  const [shown, setShown] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'yes' | 'manual' | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const firstRef = useRef<HTMLButtonElement | null>(null)
  const urlRef = useRef<HTMLInputElement | null>(null)

  // Focus goes into the sheet, and back to whatever opened it when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    return () => { if (opener && document.contains(opener)) opener.focus() }
  }, [])
  useEffect(() => { firstRef.current?.focus() }, [view, shown])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      // Keep Tab inside the sheet (it's modal).
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0], last = items[items.length - 1]
      const at = document.activeElement
      if (e.shiftKey && (at === first || !panelRef.current.contains(at))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (at === last || !panelRef.current.contains(at))) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The code to scan, drawn here from the iPhone link (works with wifi down; nothing leaves the device).
  useEffect(() => {
    if (!links || !shown) { setQr(null); return }
    let live = true
    QRCode.toString(links.webcal, { type: 'svg', margin: 1 }).then((svg) => { if (live) setQr(svg) }).catch(() => { if (live) setQr(null) })
    return () => { live = false }
  }, [links, shown])

  // A shown link hides itself after a few minutes.
  useEffect(() => {
    if (!shown) return
    // It forgets the link too, so the next person at the iPad can't bring it back (review m1).
    const t = setTimeout(() => { setShown(false); setCopied(null); setLinks(null); setView('hidden') }, LINK_SHOW_MS)
    return () => clearTimeout(t)
  }, [shown])

  async function make() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { ...(headers ?? {}) } })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Couldn’t make your link. Try again.'); return }
      setLinks(json.data)
      setShown(false)
      setCopied(null)
      setView('links')
      onChanged(true)
    } catch {
      setError('Couldn’t reach the studio server. Check wifi and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...(headers ?? {}) }, body: '{}' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Couldn’t stop your link. Try again.'); return }
      setLinks(null)
      setShown(false)
      setView('stopped')
      onChanged(false)
    } catch {
      setError('Couldn’t reach the studio server. Check wifi and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!links) return
    try {
      await navigator.clipboard.writeText(links.https)
      setCopied('yes')
    } catch {
      // No clipboard (older phone, or permission): show the link selected to copy by hand.
      setCopied('manual')
      setTimeout(() => urlRef.current?.select(), 0)
    }
  }

  const linkOut = view === 'links' && !!links

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cal-link-title"
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      // A stray tap outside doesn't throw away a fresh link; Done does.
      onClick={() => { if (!linkOut) onClose() }}
    >
      <div ref={panelRef} onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-surface, #fff)', width: '100%', maxWidth: '32rem', maxHeight: '92vh', overflowY: 'auto', borderRadius: '1rem 1rem 0 0', padding: '1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom, 0px))', display: 'grid', gap: '0.75rem' }}>
        <h2 id="cal-link-title" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-dark)' }}>
          {view === 'links' ? words.linksTitle : view === 'stopped' ? 'Calendar link stopped' : view === 'hidden' ? 'Link hidden' : words.title}
        </h2>

        {(view === 'start' || view === 'links') && (
          <p style={ownPhone} data-testid="own-phone">
            <strong>Do this on your own phone.</strong> On the studio iPad, scan the code with your phone’s camera instead. A link opened on the iPad goes into the iPad’s calendar, not yours.
          </p>
        )}

        {view === 'start' && !has && (
          <>
            <p style={help}>{words.intro}</p>
            <button ref={firstRef} type="button" disabled={busy} onClick={make} style={sheetBtn(true)}>{busy ? 'Making your link…' : words.startButton}</button>
          </>
        )}

        {view === 'start' && has && (
          <>
            <p style={help}>{words.has}</p>
            <p style={help}>To add it to a new phone, or if you lost it, make a new link. The old one stops working.</p>
            <button ref={firstRef} type="button" onClick={() => setView('confirm-new')} style={sheetBtn(true)}>Make a new link</button>
            <button type="button" onClick={() => setView('confirm-stop')} style={sheetBtn()}>Stop my calendar link</button>
          </>
        )}

        {view === 'confirm-new' && (
          <>
            <p style={help}><strong>Make a new link?</strong> Any phone using your old link stops getting updates. You’ll add the new one instead.</p>
            <button ref={firstRef} type="button" disabled={busy} onClick={make} style={sheetBtn(true)}>{busy ? 'Making your link…' : 'Yes, make a new link'}</button>
            <button type="button" onClick={() => setView('start')} style={sheetBtn()}>Keep my old link</button>
          </>
        )}

        {view === 'confirm-stop' && (
          <>
            <p style={help}><strong>Stop your calendar link?</strong> {words.confirmStop}</p>
            <button ref={firstRef} type="button" disabled={busy} onClick={stop} style={{ ...sheetBtn(true), background: '#b91c1c' }}>{busy ? 'Stopping…' : 'Yes, stop it'}</button>
            <button type="button" onClick={() => setView('start')} style={sheetBtn()}>Keep it</button>
          </>
        )}

        {view === 'links' && links && !shown && (
          <>
            <p style={help}>Your link is ready. It’s only shown now, so have your phone with you, then tap Show my link.</p>
            <button ref={firstRef} type="button" onClick={() => setShown(true)} style={sheetBtn(true)}>Show my link</button>
          </>
        )}

        {view === 'links' && links && shown && (
          <>
            <p style={{ ...help, fontWeight: 600 }}>{words.privacy}</p>

            <section aria-labelledby="cal-qr" style={{ display: 'grid', gap: '0.45rem', justifyItems: 'center' }}>
              <h3 id="cal-qr" style={{ margin: 0, fontSize: '1rem', color: 'var(--color-dark)', justifySelf: 'start' }}>On the iPad? Scan with your iPhone</h3>
              <div
                role="img"
                aria-label="Code to scan with your iPhone camera. It opens your calendar link."
                data-testid="cal-qr"
                style={{ width: '12rem', maxWidth: '100%', aspectRatio: '1', background: '#fff', padding: '0.4rem', borderRadius: '0.5rem' }}
                dangerouslySetInnerHTML={qr ? { __html: qr } : undefined}
              />
              <p style={{ ...help, justifySelf: 'start' }}>Point your iPhone’s camera at the code, tap the link that pops up, tap Subscribe, then tap Add.</p>
            </section>

            <section aria-labelledby="cal-iphone" style={{ display: 'grid', gap: '0.45rem' }}>
              <h3 id="cal-iphone" style={{ margin: 0, fontSize: '1rem', color: 'var(--color-dark)' }}>On your iPhone</h3>
              <a href={links.webcal} style={{ ...sheetBtn(true), display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', boxSizing: 'border-box' }}>Add to my iPhone calendar</a>
              <p style={help}>{words.iphoneShows}</p>
            </section>

            <section aria-labelledby="cal-android" style={{ display: 'grid', gap: '0.45rem' }}>
              <h3 id="cal-android" style={{ margin: 0, fontSize: '1rem', color: 'var(--color-dark)' }}>Android or Google Calendar</h3>
              <p style={help}>{words.androidOnIpad}</p>
              <button ref={firstRef} type="button" onClick={copy} style={sheetBtn()}>{copied === 'yes' ? '✓ Link copied' : 'Copy my link'}</button>
              <p role="status" aria-live="polite" style={{ ...help, minHeight: 0, color: copied === 'yes' ? '#15803d' : 'var(--color-dark)', fontWeight: copied ? 600 : 400 }}>
                {copied === 'yes' ? 'Copied. Now paste it in Google Calendar.' : copied === 'manual' ? 'Press and hold the link below, then tap Copy.' : ''}
              </p>
              {copied === 'manual' && (
                <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.9rem', fontWeight: 600 }}>
                  Your link
                  <input ref={urlRef} readOnly value={links.https} onFocus={(e) => e.currentTarget.select()} style={{ ...field, width: '100%', minHeight: '2.75rem' }} />
                </label>
              )}
              <ol style={{ ...help, paddingLeft: '1.2rem', display: 'grid', gap: '0.2rem' }}>
                <li>Copy your link.</li>
                <li>Open calendar.google.com in Chrome. On a phone, tap ⋮ and tick Desktop site first. Use the same Google account as your phone.</li>
                <li>Next to Other calendars, tap +, then From URL. Paste and tap Add calendar.</li>
                <li>{`On your phone, open the Google Calendar app › Settings › ${words.calendarName}, and turn on Sync.`}</li>
              </ol>
              <p style={{ ...help, color: 'var(--color-muted)' }}>{words.googleSlow}</p>
            </section>

            <button type="button" onClick={() => { setShown(false); setCopied(null) }} style={sheetBtn()}>Hide my link</button>
          </>
        )}

        {view === 'stopped' && (
          <>
            <p style={help}>{`Your calendar link is stopped. You can delete the “${words.calendarName}” calendar from your phone.`}</p>
            <button ref={firstRef} type="button" disabled={busy} onClick={make} style={sheetBtn()}>{busy ? 'Making your link…' : 'Get a new calendar link'}</button>
          </>
        )}

        {view === 'hidden' && (
          <>
            <p style={help}>Your link was hidden after a few minutes, so nobody else at this screen can see it. Make a new link to see one again. The old one stops working.</p>
            <button ref={firstRef} type="button" disabled={busy} onClick={make} style={sheetBtn(true)}>{busy ? 'Making your link…' : 'Make a new link'}</button>
          </>
        )}

        {error && <p role="alert" style={{ margin: 0, color: 'var(--color-error)', fontWeight: 600 }}>{error}</p>}
        {linkOut && <p style={{ ...help, fontSize: '0.875rem', color: 'var(--color-muted)', textAlign: 'center' }}>Closing hides your link for good. You can always make a new one.</p>}
        <button type="button" onClick={onClose} style={{ ...sheetBtn(), border: 'none' }}>{view === 'links' ? 'Done' : 'Close'}</button>
      </div>
    </div>
  )
}
