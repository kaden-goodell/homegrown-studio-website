/**
 * LEGACY FALLBACK — delete after 2027-01-15 (this file).
 *
 * The old Square booking stays available as a fallback until this day
 * (studio-local YYYY-MM-DD), then it's gone: 4 weeks after the last class
 * booked in Square (Sat Dec 19, 2026). Kaden, 16 Nov 2026: "a guaranteed end".
 *
 * After it: /admin › More › Online booking no longer offers "Old Square
 * booking", every kind reads as the new booking system, and
 * tests/legacy-fallback-sunset.test.ts FAILS until the fallback code is
 * deleted (docs/handbook/notes/legacy-square-fallback.md lists exactly what).
 */
export const LEGACY_FALLBACK_UNTIL = '2027-01-15'
