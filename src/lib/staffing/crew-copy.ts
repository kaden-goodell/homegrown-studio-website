/**
 * Crew-facing words shared by the server (calendar links) and the /staff
 * screens (My shifts). Client-safe: strings only.
 */

/**
 * The line crew see on a party in their phone calendar and in My shifts.
 *
 * TODO(owner, Kaden): this states a staff arrival rule as fact on everyone's
 * phone. Confirm the 30 minutes, change it, or set it to '' to drop the line
 * everywhere at once. The plan's first wording, "Doors 30 minutes early",
 * meant something different (when guests may come in), so it was not used.
 */
export const PARTY_ARRIVAL = 'Be there 30 minutes before it starts.'

/** What crew hear when they try something only an owner can do. */
export const OWNERS_ASSIGN = 'Only an owner can put people on a class or party. Ask Catherine or Kaden.'

/**
 * A person's mark for one event, in the words crew use themselves, for owner
 * screens ("Who can work", the Staff section). Never a pronoun: "they".
 *   can → "Can" · cant → "Can't" or "Can't (dentist)" · partly → "Part (4–9 PM)"
 *   outside → "Outside the hours they gave (4–9 PM)" · unknown → "Hasn’t said if free"
 */
export function verdictLabel(p: { verdict: 'can' | 'cant' | 'partly' | 'outside' | 'unknown'; markNote?: string; hours?: string }): string {
  const paren = (s: string | undefined) => (s ? ` (${s})` : '')
  switch (p.verdict) {
    case 'can': return 'Can'
    case 'cant': return `Can’t${paren(p.markNote)}`
    case 'partly': return `Part${paren(p.hours)}`
    case 'outside': return `Outside the hours they gave${paren(p.hours)}`
    // UI review (3 Nov): "Not said" was unclear on the owners' Staff tab.
    default: return 'Hasn’t said if free'
  }
}
