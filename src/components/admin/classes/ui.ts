import type { CSSProperties } from 'react'

/** Shared inline styles for the /admin class screens. Buttons use the site's .btn (48px tall). */
export const row: CSSProperties = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }
export const box: CSSProperties = {
  display: 'grid', gap: '0.6rem', padding: '1rem', borderRadius: '1rem',
  border: '1px solid var(--color-line)', background: 'var(--color-surface)', minWidth: 0,
}
export const muted: CSSProperties = { color: 'var(--color-muted)', margin: 0 }
export const errorText: CSSProperties = { color: '#b91c1c', margin: 0, fontWeight: 600 }
export const warnText: CSSProperties = { color: '#92400e', margin: 0, fontWeight: 600 }
/** 16px so iPad Safari doesn't zoom on focus. */
export const input: CSSProperties = { fontSize: '1rem', minHeight: '2.75rem', width: '100%', boxSizing: 'border-box' }
