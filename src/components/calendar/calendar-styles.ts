/**
 * Month-calendar looks shared by the What's On calendar and the party date
 * picker, so a closed day and the month arrows look the same everywhere.
 */
import type { CSSProperties } from 'react'
import type { Holiday } from '@config/closures'

/** Stripes for a day closed for a holiday: pumpkin orange, warm brown, or a candy cane. */
export const HOLIDAY_STRIPES: Record<Holiday, string> = {
  halloween:
    'repeating-linear-gradient(135deg, color-mix(in srgb, var(--holiday-halloween) 30%, white) 0 7px, color-mix(in srgb, var(--holiday-halloween) 12%, white) 7px 14px)',
  thanksgiving:
    'repeating-linear-gradient(135deg, color-mix(in srgb, var(--holiday-thanksgiving) 28%, white) 0 7px, color-mix(in srgb, var(--holiday-thanksgiving) 10%, white) 7px 14px)',
  christmas:
    'repeating-linear-gradient(135deg, color-mix(in srgb, var(--holiday-christmas) 38%, white) 0 7px, white 7px 14px)',
}

/** A faint diagonal hatch: "closed", for a day with no holiday of its own. */
export const CLOSED_HATCH = 'repeating-linear-gradient(135deg, rgba(var(--color-primary-rgb),0.045) 0 2px, transparent 2px 9px)'

/** The round ‹ › month arrows. */
export function monthNavStyle(disabled: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2.5rem',
    height: '2.5rem',
    fontSize: '1.5rem',
    lineHeight: 1,
    color: 'var(--color-dark)',
    background: 'rgba(255,255,255,0.85)',
    border: '1px solid rgba(var(--color-primary-rgb),0.35)',
    borderRadius: '9999px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    boxShadow: disabled ? 'none' : '0 1px 4px rgba(0,0,0,0.06)',
    opacity: disabled ? 0.35 : 1,
  }
}
