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

/** iPad-at-the-counter sizes: 44px tap targets, 15px button text. */
export const btn = (primary = false): CSSProperties => ({
  padding: '0.6rem 1rem',
  minHeight: '2.75rem',
  borderRadius: '0.625rem',
  border: primary ? 'none' : '1px solid rgba(var(--color-primary-rgb),0.3)',
  background: primary ? 'var(--color-primary)' : 'transparent',
  color: primary ? '#fff' : 'var(--color-dark)',
  fontSize: '0.9375rem',
  fontWeight: 600,
  cursor: 'pointer',
})

/** 16px text: anything smaller makes iPad Safari zoom the page on focus. */
export const field: CSSProperties = {
  padding: '0.65rem 0.8rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(var(--color-primary-rgb),0.3)',
  fontSize: '1rem',
}

export function Badge({ tone, wrap, children }: { tone: 'alert' | 'warn' | 'muted'; wrap?: boolean; children: ReactNode }) {
  const t = tone === 'alert'
    ? { bg: 'rgba(185,28,28,0.1)', fg: '#b91c1c', bd: 'rgba(185,28,28,0.3)' }
    : tone === 'warn'
      ? { bg: 'rgba(217,119,6,0.14)', fg: '#92400e', bd: 'rgba(217,119,6,0.45)' }
      : { bg: 'rgba(90,90,90,0.08)', fg: '#4b5563', bd: 'rgba(90,90,90,0.22)' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.2rem 0.55rem', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 700, background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, whiteSpace: wrap ? 'normal' : 'nowrap' }}>
      {children}
    </span>
  )
}

/** A full-width flag that can't be missed: red for allergies, amber for no photos. */
export function FlagBanner({ tone, testId, children }: { tone: 'alert' | 'warn'; testId?: string; children: ReactNode }) {
  const t = tone === 'alert'
    ? { bg: 'rgba(185,28,28,0.1)', fg: '#991b1b', bd: '#dc2626' }
    : { bg: 'rgba(217,119,6,0.14)', fg: '#92400e', bd: '#d97706' }
  return (
    <div data-testid={testId} role="note" style={{ background: t.bg, color: t.fg, borderLeft: `5px solid ${t.bd}`, borderRadius: '0.5rem', padding: '0.55rem 0.75rem', fontWeight: 800, fontSize: '0.95rem', lineHeight: 1.35 }}>
      {children}
    </div>
  )
}
