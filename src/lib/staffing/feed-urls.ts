/** The two ways to add a calendar link: https (Google "From URL", Copy) and webcal (iPhone subscribes on tap). Client-safe. */
export function feedUrls(origin: string, token: string): { https: string; webcal: string } {
  const host = new URL(origin).host
  return { https: `https://${host}/api/calendar/feed/${token}.ics`, webcal: `webcal://${host}/api/calendar/feed/${token}.ics` }
}
