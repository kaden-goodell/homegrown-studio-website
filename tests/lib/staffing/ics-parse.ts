/** A small iCalendar reader for tests: unfolds lines, reads VEVENTs, unescapes TEXT. */
export function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, '').split('\r\n').filter((l) => l.length > 0)
}

const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

export interface ParsedEvent { [prop: string]: string }

export function parseIcs(ics: string): { cal: Record<string, string>; events: ParsedEvent[] } {
  const cal: Record<string, string> = {}
  const events: ParsedEvent[] = []
  let cur: ParsedEvent | null = null
  for (const line of unfold(ics)) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue }
    if (line === 'END:VEVENT') { events.push(cur!); cur = null; continue }
    const i = line.indexOf(':')
    const name = line.slice(0, i), value = unescape(line.slice(i + 1))
    if (cur) cur[name] = value
    else cal[name] = value
  }
  return { cal, events }
}
