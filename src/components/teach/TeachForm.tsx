import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import '../../styles/booking-panel.css'
import { suggestEmailFix } from '@lib/email-typos'

const MAX_PHOTOS = 6
/** Photos are shrunk on the phone before they're sent, so they upload fast on any signal. */
const MAX_EDGE = 1600

type Photo = { key: string; dataUrl: string }

/** A picked photo as a ~1600px JPEG. Null when the browser can't read it. */
async function shrink(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return null
  }
}

const EMPTY = {
  name: '', business: '', email: '', phone: '', city: '',
  instagram: '', website: '', tiktok: '', etsy: '', video: '',
  what: '', takeHome: '', audience: '', dropOffOk: '', length: '', groupMin: '', groupMax: '', price: '', suppliesCost: '', needs: '',
  experience: '', days: '', howOften: '', company: '',
}
type Values = typeof EMPTY

/**
 * /teach: an outside artist tells us about themselves and the class they'd
 * teach (Kaden, 15 Oct 2026). Only name, email, phone, the class idea and one
 * photo are required.
 */
export default function TeachForm() {
  const id = useId()
  const [v, setV] = useState<Values>(EMPTY)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [problem, setProblem] = useState<{ field: string; error: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  const errorFor = (field: string) => (problem?.field === field ? problem.error : '')

  async function addPhotos(files: FileList | null) {
    if (!files) return
    const room = MAX_PHOTOS - photos.length
    const picked = Array.from(files).slice(0, room)
    const shrunk = await Promise.all(picked.map(shrink))
    const good = shrunk.filter((d): d is string => !!d).map((dataUrl) => ({ key: `${Date.now()}-${Math.random()}`, dataUrl }))
    setPhotos((p) => [...p, ...good].slice(0, MAX_PHOTOS))
    if (good.length < picked.length) setProblem({ field: 'photos', error: 'One of the photos couldn’t be read. Try a different one.' })
    else if (problem?.field === 'photos') setProblem(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (sending) return
    setProblem(null)
    setSending(true)
    try {
      const res = await fetch('/api/teach/apply.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          about: { name: v.name, business: v.business, email: v.email, phone: v.phone, city: v.city },
          links: { instagram: v.instagram, website: v.website, tiktok: v.tiktok, etsy: v.etsy, video: v.video },
          classIdea: { what: v.what, takeHome: v.takeHome, audience: v.audience, dropOffOk: v.dropOffOk, length: v.length, groupMin: v.groupMin, groupMax: v.groupMax, price: v.price, suppliesCost: v.suppliesCost, needs: v.needs },
          experience: v.experience,
          when: { days: v.days, howOften: v.howOften },
          photos: photos.map((p) => p.dataUrl),
          company: v.company,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const field = data?.field ?? 'form'
        setProblem({ field, error: data?.error ?? 'We couldn’t send that just now. Please try again in a minute.' })
        document.getElementById(`${id}-${field}`)?.scrollIntoView?.({ block: 'center' })
        return
      }
      setDone(true)
      window.scrollTo?.({ top: 0 })
    } catch {
      setProblem({ field: 'form', error: 'We couldn’t send that just now. Check your connection and try again.' })
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div role="status" className="glass rounded-2xl" style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
        <p className="font-heading" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-dark)' }}>Thanks, we got it.</p>
        <p style={{ margin: '0.5rem 0 0', color: 'var(--color-text)' }}>We’ll be in touch.</p>
      </div>
    )
  }

  const input = (k: keyof Values, label: string, opts: { required?: boolean; type?: string; inputMode?: 'email' | 'tel' | 'url' | 'numeric' | 'text'; autoComplete?: string; placeholder?: string } = {}) => (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-${k}`}>
        {label}
        {!opts.required && <span className="field-optional"> (optional)</span>}
      </label>
      <input
        id={`${id}-${k}`}
        className="field-input"
        type={opts.type ?? 'text'}
        inputMode={opts.inputMode}
        autoComplete={opts.autoComplete ?? 'off'}
        placeholder={opts.placeholder}
        required={opts.required}
        value={v[k]}
        onChange={set(k)}
        aria-invalid={errorFor(k) ? true : undefined}
      />
      {k === 'email' && suggestEmailFix(v.email) && (
        <p className="field-hint" style={{ margin: '0.25rem 0 0', fontSize: '0.875rem' }}>
          Did you mean{' '}
          <button type="button" onClick={() => setV((x) => ({ ...x, email: suggestEmailFix(x.email)! }))} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--color-primary)', textDecoration: 'underline', cursor: 'pointer' }}>
            {suggestEmailFix(v.email)}
          </button>
          ?
        </p>
      )}
      {errorFor(k) && <p role="alert" className="field-error">{errorFor(k)}</p>}
    </div>
  )

  const textarea = (k: keyof Values, label: string, opts: { required?: boolean; hint?: string } = {}) => (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-${k}`}>
        {label}
        {!opts.required && <span className="field-optional"> (optional)</span>}
      </label>
      {opts.hint && <p style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', color: 'var(--color-muted)' }}>{opts.hint}</p>}
      <textarea id={`${id}-${k}`} className="field-input" rows={3} required={opts.required} value={v[k]} onChange={set(k)} aria-invalid={errorFor(k) ? true : undefined} style={{ resize: 'vertical' }} />
      {errorFor(k) && <p role="alert" className="field-error">{errorFor(k)}</p>}
    </div>
  )

  const choice = (k: keyof Values, label: string, options: [string, string][]) => (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label">{label}<span className="field-optional"> (optional)</span></legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {options.map(([value, text]) => (
          <button
            key={value}
            type="button"
            aria-pressed={v[k] === value}
            onClick={() => setV((x) => ({ ...x, [k]: x[k] === value ? '' : value }))}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '999px',
              border: `1px solid ${v[k] === value ? 'var(--color-primary)' : 'var(--color-field-border)'}`,
              background: v[k] === value ? 'var(--color-primary)' : 'var(--color-surface)',
              color: v[k] === value ? 'var(--color-button-text)' : 'var(--color-dark)',
              font: 'inherit',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  )

  const section = (title: string, children: ReactNode) => (
    <section className="glass rounded-2xl" style={{ padding: '1.25rem', display: 'grid', gap: '1rem' }}>
      <h2 className="font-heading" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-dark)' }}>{title}</h2>
      {children}
    </section>
  )
  const pair = (a: ReactNode, b: ReactNode) => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '1rem' }}>{a}{b}</div>

  return (
    <form onSubmit={submit} noValidate style={{ display: 'grid', gap: '1.25rem' }}>
      {section('About you', <>
        {input('name', 'Your name', { required: true, autoComplete: 'name' })}
        {input('business', 'Business name', { autoComplete: 'organization' })}
        {pair(input('email', 'Email', { required: true, type: 'email', inputMode: 'email', autoComplete: 'email' }), input('phone', 'Phone', { required: true, type: 'tel', inputMode: 'tel', autoComplete: 'tel' }))}
        {input('city', 'City', { autoComplete: 'address-level2' })}
        {pair(input('instagram', 'Instagram', { placeholder: '@yourname' }), input('website', 'Website', { type: 'url', inputMode: 'url' }))}
        {pair(input('tiktok', 'TikTok', { placeholder: '@yourname' }), input('etsy', 'Etsy'))}
      </>)}

      {section('Your class', <>
        {textarea('what', 'What would you teach?', { required: true, hint: 'A sentence or two about the class.' })}
        {input('takeHome', 'What do people take home?')}
        {choice('audience', 'Who is it for?', [['kids', 'Kids & teens'], ['adults', 'Adults'], ['both', 'Both']])}
        {(v.audience === 'kids' || v.audience === 'both') && choice('dropOffOk', 'Could parents drop kids off?', [['yes', 'Yes'], ['no', 'No']])}
        {pair(input('length', 'How long', { placeholder: 'e.g. 2 hours' }), pair(input('groupMin', 'Fewest people', { inputMode: 'numeric' }), input('groupMax', 'Most people', { inputMode: 'numeric' })))}
        {pair(input('price', 'Price you’d like per person', { placeholder: 'e.g. $45' }), input('suppliesCost', 'Supplies cost per person', { placeholder: 'e.g. $12' }))}
        {textarea('needs', 'What would you need from us?', { hint: 'Tables, outlets, a sink, an oven, how messy it gets.' })}
      </>)}

      {section('Your work', <>
        <div className="field" id={`${id}-photos`}>
          <p className="field-label" style={{ margin: 0 }}>Photos of your work</p>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: 'var(--color-muted)' }}>Finished pieces or past classes. At least one, up to {MAX_PHOTOS}.</p>
          {photos.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(5.5rem, 1fr))', gap: '0.5rem' }}>
              {photos.map((p, i) => (
                <li key={p.key} style={{ position: 'relative' }}>
                  <img src={p.dataUrl} alt={`Photo ${i + 1}`} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '0.5rem', display: 'block' }} />
                  <button
                    type="button"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => setPhotos((list) => list.filter((x) => x.key !== p.key))}
                    style={{ position: 'absolute', top: 4, right: 4, width: 26, height: 26, borderRadius: '50%', border: 0, background: 'rgba(0,0,0,.6)', color: '#fff', cursor: 'pointer', lineHeight: 1 }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {photos.length < MAX_PHOTOS && (
            <label className="btn btn-secondary" style={{ display: 'inline-flex', cursor: 'pointer' }}>
              {photos.length ? 'Add more photos' : 'Add photos'}
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
            </label>
          )}
          {errorFor('photos') && <p role="alert" className="field-error">{errorFor('photos')}</p>}
        </div>
        {input('video', 'Link to a video', { type: 'url', inputMode: 'url', placeholder: 'Instagram reel, TikTok or YouTube' })}
        {textarea('experience', 'Teaching experience', { hint: 'Where you’ve taught, and for how long.' })}
      </>)}

      {section('When', <>
        {textarea('days', 'Which days and times work for you?')}
        {choice('howOften', 'How often?', [['one-time', 'One-time'], ['monthly', 'Monthly'], ['series', 'A series']])}
      </>)}

      {/* People never see this; bots fill it in. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>Company<input tabIndex={-1} autoComplete="off" value={v.company} onChange={set('company')} /></label>
      </div>

      {errorFor('form') && <p role="alert" className="field-error">{errorFor('form')}</p>}
      <button type="submit" className="btn btn-primary" disabled={sending} style={{ width: '100%' }}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </form>
  )
}
