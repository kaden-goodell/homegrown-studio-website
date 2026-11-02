/** Home's "Need someone on" tile: the count, worked out from the one staffing read Home makes (Home.tsx). */

/** OWNER-6: the window Home's "Need someone on" counts (today and the next 13 studio days). */
export const HOME_STAFF_DAYS = 14

interface BoardRow { event: { status: string; endIso: string }; state: string; needed: number }

/** How many classes and parties in the next two weeks still need someone on (null while loading). */
export function countUnstaffed(rows: BoardRow[], now = Date.now()): number {
  return rows.filter((r) => r.event.status === 'on' && Date.parse(r.event.endIso) > now && r.needed > 0 && r.state !== 'staffed').length
}
