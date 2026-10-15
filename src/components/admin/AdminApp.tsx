import { useEffect, useState, type FormEvent } from 'react'
import type { ArtistApplication, ApplicationStatus } from '@lib/artist-applications'

const STATUSES: [ApplicationStatus, string][] = [['new', 'New'], ['talking', 'Talking'], ['booked', 'Booked'], ['not-now', 'Not now']]
const AUDIENCE: Record<string, string> = { kids: 'Kids & teens', adults: 'Adults', both: 'Both' }
const OFTEN: Record<string, string> = { 'one-time': 'One-time', monthly: 'Monthly', series: 'A series' }

/**
 * /admin: owner-only tools. For now, the artist applications from /teach,
 * each moved along New → Talking → Booked → Not now.
 */
export default function AdminApp() {
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready' | 'error'>('loading')
  const [apps, setApps] = useState<ArtistApplication[]>([])
  const [passcode, setPasscode] = useState('')
  const [loginError, setLoginError] = useState('')
  const [show, setShow] = useState<ApplicationStatus | 'all'>('all')

  async function load() {
    setState('loading')
    try {
      const res = await fetch('/api/admin/applications.json', { cache: 'no-store' })
      if (res.status === 401) return setState('signed-out')
      if (!res.ok) throw new Error(String(res.status))
      setApps((await res.json()).data.applications)
      setState('ready')
    } catch {
      setState('error')
    }
  }
  useEffect(() => { load() }, [])

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setLoginError('')
    const res = await fetch('/api/admin/login.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) })
    if (!res.ok) return setLoginError((await res.json().catch(() => null))?.error ?? 'That didn’t work.')
    setPasscode('')
    load()
  }

  async function move(id: string, status: ApplicationStatus) {
    const res = await fetch('/api/admin/applications.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    if (res.ok) {
      const { application } = (await res.json()).data
      setApps((list) => list.map((a) => (a.id === id ? application : a)))
    }
  }

  if (state === 'loading') return <p style={{ color: 'var(--color-muted)' }}>Loading…</p>
  if (state === 'error') return <p role="alert">Couldn’t load just now. <button type="button" className="btn btn-secondary" onClick={load}>Try again</button></p>
  if (state === 'signed-out') {
    return (
      <form onSubmit={signIn} className="glass rounded-2xl" style={{ padding: '1.5rem', display: 'grid', gap: '0.75rem', maxWidth: '22rem' }}>
        <h1 className="font-heading" style={{ margin: 0, fontSize: '1.5rem', color: 'var(--color-dark)' }}>Admin</h1>
        <label className="field-label" htmlFor="admin-passcode">Passcode</label>
        <input id="admin-passcode" className="field-input" type="password" autoComplete="current-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        {loginError && <p role="alert" className="field-error">{loginError}</p>}
        <button type="submit" className="btn btn-primary">Sign in</button>
      </form>
    )
  }

  const shown = apps.filter((a) => show === 'all' || a.status === show)
  const count = (s: ApplicationStatus) => apps.filter((a) => a.status === s).length
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <h1 className="font-heading" style={{ margin: 0, fontSize: '1.75rem', color: 'var(--color-dark)' }}>Teacher applications</h1>
      <div role="group" aria-label="Show" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {([['all', `All (${apps.length})`], ...STATUSES.map(([s, l]) => [s, `${l} (${count(s)})`])] as [ApplicationStatus | 'all', string][]).map(([s, l]) => (
          <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)} className={show === s ? 'btn btn-primary' : 'btn btn-secondary'} style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}>{l}</button>
        ))}
      </div>
      {shown.length === 0 && <p style={{ color: 'var(--color-muted)' }}>{apps.length === 0 ? 'No applications yet. They’ll show up here when artists use ourhometownstudio.com/teach.' : 'None here.'}</p>}
      {shown.map((a) => <Application key={a.id} app={a} onMove={move} />)}
    </div>
  )
}

function Application({ app, onMove }: { app: ArtistApplication; onMove: (id: string, s: ApplicationStatus) => void }) {
  const c = app.classIdea
  const row = (k: string, v: string) => (v ? <p style={{ margin: 0 }}><strong style={{ color: 'var(--color-dark)' }}>{k}</strong> {v}</p> : null)
  const link = (label: string, href: string) => {
    if (!href) return null
    const url = /^https?:\/\//.test(href) ? href : href.startsWith('@') && label === 'Instagram' ? `https://instagram.com/${href.slice(1)}` : href.startsWith('@') && label === 'TikTok' ? `https://www.tiktok.com/${href}` : `https://${href}`
    return <a key={label} href={url} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>{label}</a>
  }
  return (
    <article className="glass rounded-2xl" style={{ padding: '1.25rem', display: 'grid', gap: '0.6rem', fontSize: '0.95rem', color: 'var(--color-text)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 className="font-heading" style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-dark)' }}>{app.about.name}{app.about.business ? ` · ${app.about.business}` : ''}</h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-muted)' }}>{new Date(app.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })}{app.about.city ? ` · ${app.about.city}` : ''}</p>
        </div>
        <div role="group" aria-label={`Status for ${app.about.name}`} style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {STATUSES.map(([s, l]) => (
            <button key={s} type="button" aria-pressed={app.status === s} onClick={() => onMove(app.id, s)} className={app.status === s ? 'btn btn-primary' : 'btn btn-secondary'} style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>{l}</button>
          ))}
        </div>
      </div>
      <p style={{ margin: 0, display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <a href={`mailto:${app.about.email}`} style={{ color: 'var(--color-primary)' }}>{app.about.email}</a>
        <a href={`tel:${app.about.phone.replace(/[^\d+]/g, '')}`} style={{ color: 'var(--color-primary)' }}>{app.about.phone}</a>
        {link('Instagram', app.links.instagram)}{link('Website', app.links.website)}{link('TikTok', app.links.tiktok)}{link('Etsy', app.links.etsy)}{link('Video', app.links.video)}
      </p>
      {row('Class:', c.what)}
      {row('Takes home:', c.takeHome)}
      {row('For:', [AUDIENCE[c.audience], c.dropOffOk === 'yes' ? 'drop-off OK' : c.dropOffOk === 'no' ? 'no drop-off' : ''].filter(Boolean).join(', '))}
      {row('Length:', c.length)}
      {row('Group:', [c.groupMin, c.groupMax].filter(Boolean).join(' to '))}
      {row('Price per person:', c.price)}
      {row('Supplies per person:', c.suppliesCost)}
      {row('Needs from us:', c.needs)}
      {row('Experience:', app.experience)}
      {row('When:', [app.when.days, OFTEN[app.when.howOften]].filter(Boolean).join(' · '))}
      {app.photos > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(7rem, 1fr))', gap: '0.5rem' }}>
          {Array.from({ length: app.photos }, (_, n) => {
            const src = `/api/admin/application-photo?id=${encodeURIComponent(app.id)}&n=${n}`
            return <a key={n} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`${app.about.name}, photo ${n + 1}`} loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '0.5rem', display: 'block' }} /></a>
          })}
        </div>
      )}
    </article>
  )
}
