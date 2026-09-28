import type { CSSProperties, ReactNode } from 'react'

/** Shared inline-style primitives for the staff console — every screen
 *  (Today, roster, kits) draws from these instead of a CSS framework. */

export const card: CSSProperties = {
  border: '1px solid rgba(var(--color-primary-rgb),0.16)',
  borderRadius: '1rem',
  padding: '1rem 1.1rem',
  boxShadow: '0 8px 24px rgba(var(--color-primary-rgb),0.08)',
  marginBottom: '0.9rem',
}

export const btn = (primary = false): CSSProperties => ({
  padding: '0.55rem 0.9rem',
  borderRadius: '0.625rem',
  border: primary ? 'none' : '1px solid rgba(var(--color-primary-rgb),0.3)',
  background: primary ? 'var(--color-primary)' : 'transparent',
  color: primary ? '#fff' : 'var(--color-dark)',
  fontSize: '0.8125rem',
  fontWeight: 600,
  cursor: 'pointer',
})

export const field: CSSProperties = {
  padding: '0.5rem 0.7rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(var(--color-primary-rgb),0.3)',
  fontSize: '0.875rem',
}

export function Badge({ tone, wrap, children }: { tone: 'alert' | 'muted'; wrap?: boolean; children: ReactNode }) {
  const t = tone === 'alert'
    ? { bg: 'rgba(185,28,28,0.1)', fg: '#b91c1c', bd: 'rgba(185,28,28,0.3)' }
    : { bg: 'rgba(90,90,90,0.08)', fg: '#4b5563', bd: 'rgba(90,90,90,0.22)' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.5rem', borderRadius: '0.5rem', fontSize: '0.7rem', fontWeight: 700, background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, whiteSpace: wrap ? 'normal' : 'nowrap' }}>
      {children}
    </span>
  )
}
