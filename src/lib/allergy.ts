/**
 * Is this stored allergy text an actual allergy? The waiver's "None" chip saves
 * the literal text, and "n/a", "no", "nka" are what people type — none of those
 * should raise a warning badge or count toward "n with allergies". Pure, so
 * client and server share it. (Printed rosters show the literal text.)
 */
const NONE_TOKENS = ['none', 'n/a', 'na', 'no', 'nka', 'nkda']
const clean = (value: string | null | undefined) => (value ?? '').trim().toLowerCase().replace(/[.!]+$/, '')

/** Is this text the person saying "none"? (Also how a parent explicitly clears
 *  a may-NOT-collect note: blank keeps what's on file, "None" removes it.) */
export function isNoneToken(value: string | null | undefined): boolean {
  return NONE_TOKENS.includes(clean(value))
}

export function hasAllergy(value: string | null | undefined): boolean {
  return clean(value) !== '' && !isNoneToken(value)
}
