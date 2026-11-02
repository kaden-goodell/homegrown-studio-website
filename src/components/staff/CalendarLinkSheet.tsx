import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { btn, field } from '@components/staff/ui'

/**
 * "Calendar on my phone" (stage 3): a private link that puts the person's
 * shifts in their phone's calendar and keeps them up to date. The link is
 * shown once, when it's made (only a scrambled copy is kept), so "Make a new
 * link" is how to get it again, and it stops the old one. Every
 * are-you-sure is asked here in the sheet, never a browser pop-up.
 */

type View = 'start' | 'confirm-new' | 'confirm-stop' | 'links' | 'stopped'

const sheetBtn = (primary = false): CSSProperties => ({ ...btn(primary), minHeight: '3rem', fontSize: '1rem', width: '100%', textAlign: 'center' })
const help: CSSProperties = { margin: 0, fontSize: '0.95rem', color: 'var(--color-dark)', lineHeight: 1.5 }

export default function CalendarLinkSheet({ has, onClose, onChanged }: { has: boolean; onClose: () => void; onChanged: (has: boolean) => void }) {
  const [view, setView] = useState<View>('start')
  const [links, setLinks] = useState<{ https: string; webcal: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'yes' | 'manual' | null>(null)
  const firstRef = useRef<HTMLButtonElement | null>(null)
  const urlRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { firstRef.current?.focus() }, [view])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function make() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/staff/feed.json', { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Couldn’t make your link. Try again.'); return }
      setLinks(json.data)
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
      const res = await fetch('/api/staff/feed.json', { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Couldn’t stop your link. Try again.'); return }
      setLinks(null)
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

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="cal-link-title" style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-surface, #fff)', width: '100%', maxWidth: '32rem', maxHeight: '92vh', overflowY: 'auto', borderRadius: '1rem 1rem 0 0', padding: '1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom, 0px))', display: 'grid', gap: '0.75rem' }}>
        <h2 id="cal-link-title" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-dark)' }}>
          {view === 'links' ? 'Your calendar link' : view === 'stopped' ? 'Calendar link stopped' : 'My shifts on my phone'}
        </h2>

        {view === 'start' && !has && (
          <>
            <p style={help}>Get a private link that puts your shifts in your phone’s calendar. When Catherine or Kaden put you on something, or a time changes, your phone updates by itself.</p>
            <button ref={firstRef} type="button" disabled={busy} onClick={make} style={sheetBtn(true)}>{busy ? 'Making your link…' : 'Get my calendar link'}</button>
          </>
        )}

        {view === 'start' && has && (
          <>
            <p style={help}>You already have a calendar link. For your privacy it was only shown once, when it was made.</p>
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
            <p style={help}><strong>Stop your calendar link?</strong> Your shifts stop updating on any phone that has it. You can make a new one any time.</p>
            <button ref={firstRef} type="button" disabled={busy} onClick={stop} style={{ ...sheetBtn(true), background: '#b91c1c' }}>{busy ? 'Stopping…' : 'Yes, stop it'}</button>
            <button type="button" onClick={() => setView('start')} style={sheetBtn()}>Keep it</button>
          </>
        )}

        {view === 'links' && links && (
          <>
            <p style={{ ...help, fontWeight: 600 }}>This link is only shown now. Keep it private: anyone with it can see your shifts.</p>

            <section aria-labelledby="cal-iphone" style={{ display: 'grid', gap: '0.45rem' }}>
              <h3 id="cal-iphone" style={{ margin: 0, fontSize: '1rem', color: 'var(--color-dark)' }}>iPhone</h3>
              <a href={links.webcal} style={{ ...sheetBtn(true), display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', boxSizing: 'border-box' }}>Add to my iPhone calendar</a>
              <p style={help}>Tap it, then tap Subscribe. Your shifts show in the Calendar app.</p>
            </section>

            <section aria-labelledby="cal-android" style={{ display: 'grid', gap: '0.45rem' }}>
              <h3 id="cal-android" style={{ margin: 0, fontSize: '1rem', color: 'var(--color-dark)' }}>Android or Google Calendar</h3>
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
                <li>On a computer, open calendar.google.com (the phone app can’t add links).</li>
                <li>Next to “Other calendars”, tap +, then “From URL”.</li>
                <li>Paste the link and tap “Add calendar”.</li>
              </ol>
              <p style={{ ...help, color: 'var(--color-muted)' }}>It then shows on your Android phone. Google can take a few hours to show changes.</p>
            </section>
          </>
        )}

        {view === 'stopped' && (
          <>
            <p style={help}>Your calendar link is stopped. You can delete the “Hometown Studio · my shifts” calendar from your phone.</p>
            <button ref={firstRef} type="button" disabled={busy} onClick={make} style={sheetBtn()}>{busy ? 'Making your link…' : 'Get a new calendar link'}</button>
          </>
        )}

        {error && <p role="alert" style={{ margin: 0, color: 'var(--color-error)', fontWeight: 600 }}>{error}</p>}
        <button type="button" onClick={onClose} style={{ ...sheetBtn(), border: 'none' }}>{view === 'links' ? 'Done' : 'Close'}</button>
      </div>
    </div>
  )
}
