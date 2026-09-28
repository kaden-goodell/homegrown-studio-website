/**
 * Shared inline-style primitives for the waiver flow — split out of
 * `WaiverFlow.tsx` (HOM-212) so `PickupFields.tsx` can draw from the same
 * look without a circular import back into the flow component.
 */
import type { CSSProperties } from 'react'

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.65rem 0.85rem',
  borderRadius: '0.625rem',
  border: '1px solid rgba(150, 112, 91, 0.25)',
  background: 'rgba(255, 255, 255, 0.85)',
  fontSize: '0.9375rem',
  color: 'var(--color-dark)',
  outline: 'none',
}

export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: 'var(--color-dark)',
  marginBottom: '0.3rem',
}

export const sectionHeadingStyle: CSSProperties = {
  fontSize: '1.0625rem',
  fontFamily: 'var(--font-heading)',
  fontWeight: 600,
  color: 'var(--color-dark)',
  margin: '0 0 0.25rem',
}

export const sectionNoteStyle: CSSProperties = {
  fontSize: '0.8125rem',
  color: 'var(--color-muted)',
  margin: '0 0 0.9rem',
  lineHeight: 1.5,
}

/** Scrollable legal-text box — shared by the agreement and the drop-off
 *  addendum so they read as the same kind of thing. */
export const scrollBoxStyle: CSSProperties = {
  maxHeight: '20rem',
  overflowY: 'auto',
  border: '1px solid rgba(150, 112, 91, 0.18)',
  borderRadius: '0.75rem',
  padding: '1rem 1.1rem',
  background: 'rgba(255, 255, 255, 0.9)',
}

export const cardStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.72)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border: '1px solid rgba(150, 112, 91, 0.16)',
  borderRadius: '1.25rem',
  padding: '1.5rem',
  boxShadow: '0 18px 44px rgba(150, 112, 91, 0.12)',
  marginBottom: '1.25rem',
}
