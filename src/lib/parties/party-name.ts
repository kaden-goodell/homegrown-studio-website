/**
 * The ONE name a party goes by on every owner and crew screen (UI review,
 * 3 Nov 2026): /admin, /staff, the calendars, crew texts and emails.
 *
 *   "Paige’s party · Decoupage Succulent Pots"
 *
 * The host's first name (how the admin screens already talk: "Move Paige’s
 * party", and crew never see a host's last name in staffing), then the craft
 * (what the crew prepare). In a sentence it's "Paige’s party" (`partyName` in
 * `@lib/conflicts`), so the words match. The host's own title ("Maya's party")
 * stays on the host's and guests' pages.
 *
 * Client-safe.
 */

/** "Paige" from "Paige Testparent"; null with no name. */
export function hostFirstName(hostName: string | null | undefined): string | null {
  return (hostName ?? '').trim().split(/\s+/).filter(Boolean)[0] ?? null
}

/** "Paige’s party", or "a party" / "the party" with no name. */
export function partyPhrase(hostName: string | null | undefined, none: 'a party' | 'the party' = 'a party'): string {
  const first = hostFirstName(hostName)
  return first ? `${first}’s party` : none
}

export function partyDisplayName(p: { hostName?: string | null; craftName?: string | null }): string {
  const first = hostFirstName(p.hostName)
  const craft = (p.craftName ?? '').trim()
  const who = first ? `${first}’s party` : 'Party'
  return craft ? `${who} · ${craft}` : who
}
