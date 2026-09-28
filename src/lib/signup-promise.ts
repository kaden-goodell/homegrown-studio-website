/**
 * What a "tell me when…" sign-up is promised, in one plain clause, worked out
 * from what they signed up for. Used by the email that confirms the sign-up.
 *
 * Nothing the visitor typed is ever repeated back. A workshop is named only
 * when it matches a workshop we actually list, and dates are rebuilt from
 * their parts. Anything unrecognised gets the general promise.
 */
const LONG_DAY: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }

function dayFrom(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ''
  const d = new Date(`${ymd}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { ...LONG_DAY, timeZone: 'UTC' })
}

function monthFrom(ym: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return ''
  return new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** The workshop named in "kind:Name 2026-10-16", if we list one by that name. */
function knownWorkshop(rest: string, names: string[]): string {
  const typed = rest.replace(/\s+\d{4}-\d{2}-\d{2}$/, '').trim().toLowerCase()
  if (!typed) return ''
  // Sign-ups cut long names to fit, so a listed name may be longer than what was sent.
  return names.find((n) => n.toLowerCase() === typed) ?? names.find((n) => typed.length >= 12 && n.toLowerCase().startsWith(typed)) ?? ''
}

export interface SignupPromise {
  /** Completes "We'll email you …" */
  when: string
  /** A second sentence, when there is something worth adding. */
  also?: string
}

export function signupPromise(
  interest: string,
  facts: { workshopNames?: string[]; timeZone?: string } = {},
): SignupPromise {
  const [kind, ...restParts] = interest.trim().split(':')
  const rest = restParts.join(':').trim()
  const names = facts.workshopNames ?? []

  switch (kind) {
    case 'party': {
      if (rest === 'more-dates') return { when: 'when more party dates open' }
      return { when: 'the day party booking opens' }
    }
    case 'party-date': {
      const day = dayFrom(rest)
      return { when: 'the day party booking opens', ...(day ? { also: `You were looking at ${day}.` } : {}) }
    }
    case 'party-time': {
      const at = new Date(rest)
      if (Number.isNaN(at.getTime())) return { when: 'the day party booking opens' }
      const timeZone = facts.timeZone ?? 'America/Chicago'
      const day = at.toLocaleDateString('en-US', { ...LONG_DAY, timeZone })
      const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
      return { when: 'the day party booking opens', also: `You were looking at ${day} at ${time}.` }
    }
    case 'party-craft':
      return { when: 'the day party booking opens' }
    case 'party-later': {
      const month = monthFrom(rest)
      return { when: month ? `the day party dates open for ${month}` : 'the day your party date opens' }
    }
    case 'workshops': {
      if (rest === 'new-dates') return { when: 'when new workshops are posted' }
      return { when: 'the day workshop booking opens' }
    }
    case 'workshop': {
      const name = knownWorkshop(rest, names)
      return { when: name ? `the day booking opens for ${name}` : 'the day workshop booking opens' }
    }
    case 'workshop-soon': {
      const name = knownWorkshop(rest, names)
      return { when: name ? `when ${name} opens for booking` : 'when that workshop opens for booking' }
    }
    case 'workshop-waitlist': {
      const name = knownWorkshop(rest, names)
      return {
        when: name ? `if a seat opens in ${name}` : 'if a seat opens in that workshop',
        also: 'A seat that opens goes to whoever books it first.',
      }
    }
    case 'kits':
    case 'kit-theme':
      return { when: 'when take-home kits are ready' }
    default:
      return { when: 'the day booking opens' }
  }
}
