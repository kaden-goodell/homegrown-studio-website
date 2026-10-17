import { useRef, type ReactNode } from 'react'
import '../../styles/booking-panel.css'
import { suggestEmailFix } from '@lib/email-typos'

/**
 * The pieces the public request forms share (/teach, /private-events): a
 * titled card, labelled fields with "(optional)", pill choices, the photo
 * picker, and the hidden field that catches bots.
 */

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="glass rounded-2xl" style={{ padding: '1.25rem', display: 'grid', gap: '1rem' }}>
      <div>
        <h2 className="font-heading" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-dark)' }}>{title}</h2>
        {hint && <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem', color: 'var(--color-muted)' }}>{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** Two fields side by side that stack on a narrow phone. */
export function Pair({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '1rem' }}>{children}</div>
}

/** Two short fields side by side, even on a phone. */
export function Side({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>{children}</div>
}

function Label({ htmlFor, label, required }: { htmlFor?: string; label: string; required?: boolean }) {
  return (
    <label className="field-label" htmlFor={htmlFor}>
      {label}
      {!required && <span className="field-optional"> (optional)</span>}
    </label>
  )
}

export function FieldError({ error }: { error?: string }) {
  return error ? <p role="alert" className="field-error">{error}</p> : null
}

export interface TextFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  type?: string
  inputMode?: 'email' | 'tel' | 'url' | 'numeric' | 'text'
  autoComplete?: string
  placeholder?: string
  min?: string
  hint?: string
  error?: string
}

export function TextField({ id, label, value, onChange, required, type = 'text', inputMode, autoComplete = 'off', placeholder, min, hint, error }: TextFieldProps) {
  const fix = type === 'email' ? suggestEmailFix(value) : null
  return (
    <div className="field">
      <Label htmlFor={id} label={label} required={required} />
      {hint && <p style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', color: 'var(--color-muted)' }}>{hint}</p>}
      <input
        id={id}
        className="field-input"
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        min={min}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
      {fix && (
        <p className="field-hint" style={{ margin: '0.25rem 0 0', fontSize: '0.875rem' }}>
          Did you mean{' '}
          <button type="button" onClick={() => onChange(fix)} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--color-primary)', textDecoration: 'underline', cursor: 'pointer' }}>
            {fix}
          </button>
          ?
        </p>
      )}
      <FieldError error={error} />
    </div>
  )
}

export function TextArea({ id, label, value, onChange, required, hint, error, rows = 3 }: { id: string; label: string; value: string; onChange: (v: string) => void; required?: boolean; hint?: string; error?: string; rows?: number }) {
  return (
    <div className="field">
      <Label htmlFor={id} label={label} required={required} />
      {hint && <p style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', color: 'var(--color-muted)' }}>{hint}</p>}
      <textarea id={id} className="field-input" rows={rows} required={required} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} style={{ resize: 'vertical' }} />
      <FieldError error={error} />
    </div>
  )
}

/** One-tap pill choices. Tapping the chosen pill again clears it. */
export function Choice({ id, label, value, options, onChange, required, error, compact }: { id?: string; label: string; value: string; options: [string, string][]; onChange: (v: string) => void; required?: boolean; error?: string; compact?: boolean }) {
  return (
    <fieldset id={id} className="field" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="field-label">{label}{!required && <span className="field-optional"> (optional)</span>}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? '0.35rem' : '0.5rem' }}>
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(value === v ? '' : v)}
            style={{
              padding: compact ? '0.4rem 0.65rem' : '0.5rem 1rem',
              borderRadius: '999px',
              border: `1px solid ${value === v ? 'var(--color-primary)' : 'var(--color-field-border)'}`,
              background: value === v ? 'var(--color-primary)' : 'var(--color-surface)',
              color: value === v ? 'var(--color-button-text)' : 'var(--color-dark)',
              font: 'inherit',
              fontSize: compact ? '0.8rem' : '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {text}
          </button>
        ))}
      </div>
      <FieldError error={error} />
    </fieldset>
  )
}

/** Photos are shrunk on the phone before they're sent, so they upload fast on any signal. */
const MAX_EDGE = 1600

/** A picked photo as a ~1600px JPEG. Null when the browser can't read it. */
export async function shrinkPhoto(file: File): Promise<string | null> {
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

export type Photo = { key: string; dataUrl: string }

export function PhotoPicker({ id, label, hint, photos, onChange, max, error, onError, required }: {
  id: string
  label: string
  hint: string
  photos: Photo[]
  onChange: (photos: Photo[]) => void
  max: number
  error?: string
  /** A photo couldn't be read (message), or every photo was fine (null). */
  onError: (error: string | null) => void
  required?: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  async function add(files: FileList | null) {
    if (!files) return
    const picked = Array.from(files).slice(0, max - photos.length)
    const shrunk = await Promise.all(picked.map(shrinkPhoto))
    const good = shrunk.filter((d): d is string => !!d).map((dataUrl) => ({ key: `${Date.now()}-${Math.random()}`, dataUrl }))
    onChange([...photos, ...good].slice(0, max))
    onError(good.length < picked.length ? 'One of the photos couldn’t be read. Try a different one.' : null)
    if (fileRef.current) fileRef.current.value = ''
  }
  return (
    <div className="field" id={id}>
      <p className="field-label" style={{ margin: 0 }}>{label}{!required && <span className="field-optional"> (optional)</span>}</p>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: 'var(--color-muted)' }}>{hint}</p>
      {photos.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(5.5rem, 1fr))', gap: '0.5rem' }}>
          {photos.map((p, i) => (
            <li key={p.key} style={{ position: 'relative' }}>
              <img src={p.dataUrl} alt={`Photo ${i + 1}`} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '0.5rem', display: 'block' }} />
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => onChange(photos.filter((x) => x.key !== p.key))}
                style={{ position: 'absolute', top: 4, right: 4, width: 26, height: 26, borderRadius: '50%', border: 0, background: 'rgba(0,0,0,.6)', color: '#fff', cursor: 'pointer', lineHeight: 1 }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {photos.length < max && (
        <label className="btn btn-secondary" style={{ display: 'inline-flex', cursor: 'pointer' }}>
          {photos.length ? 'Add more photos' : 'Add photos'}
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={(e) => add(e.target.files)} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
        </label>
      )}
      <FieldError error={error} />
    </div>
  )
}

/** People never see this; bots fill it in. The server keeps nothing when it's filled. */
export function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
      <label>Company<input tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} /></label>
    </div>
  )
}

/** The "Thanks, we got it." card both forms end on. */
export function SentCard() {
  return (
    <div role="status" className="glass rounded-2xl" style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
      <p className="font-heading" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-dark)' }}>Thanks, we got it.</p>
      <p style={{ margin: '0.5rem 0 0', color: 'var(--color-text)' }}>We’ll be in touch.</p>
    </div>
  )
}

/**
 * Sends a form's JSON. On a refusal it returns the field to point at (or
 * 'form'), so the page can scroll to it.
 */
export async function sendForm(url: string, body: unknown): Promise<{ ok: true } | { ok: false; field: string; error: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, field: data?.field ?? 'form', error: data?.error ?? 'We couldn’t send that just now. Please try again in a minute.' }
    return { ok: true }
  } catch {
    return { ok: false, field: 'form', error: 'We couldn’t send that just now. Check your connection and try again.' }
  }
}
