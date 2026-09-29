/**
 * Is this stored allergy text an actual allergy? The waiver's "None" chip saves
 * the literal text, and "n/a", "no", "nka" are what people type — none of those
 * should raise a warning badge or count toward "n with allergies". Pure, so
 * client and server share it. (Printed rosters show the literal text.)
 */
export function hasAllergy(value: string | null | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase().replace(/[.!]+$/, '')
  return v !== '' && !['none', 'n/a', 'na', 'no', 'nka', 'nkda'].includes(v)
}
