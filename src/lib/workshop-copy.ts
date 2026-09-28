/**
 * What a workshop card says about a workshop, taken from the workshop's own
 * description in Square. Nothing here writes copy: it picks out sentences the
 * studio already wrote.
 *
 * The studio writes every description as three short paragraphs: what it is,
 * "Everyone…" (what you do), and "Each guest goes home with… Ages N and up."
 *
 * Client-safe: no imports, no env.
 */

/** Square separates paragraphs with one line break or a blank line, depending on who typed it. */
function paragraphs(description?: string | null): string[] {
  return (description ?? '')
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** The card's description: the first paragraph. Empty when there is none. */
export function firstParagraph(description?: string | null): string {
  return paragraphs(description)[0] ?? ''
}

const TAKE_HOME = /^Each guest goes home with\s+(\S.*)$/i
const AGES_AND_UP = /^Ages (\d{1,2}) and up$/i
/** A who-it-is-for sentence longer than this is left off rather than crowd the line. */
const AUDIENCE_MAX = 30

/** The description speaks about guests ("their earrings"); the card speaks to the reader ("your earrings"). */
const TO_THE_READER: [RegExp, string][] = [
  [/\bthemselves\b/gi, 'yourself'],
  [/\btheirs\b/gi, 'yours'],
  [/\btheir\b/gi, 'your'],
  [/\bthem\b/gi, 'you'],
  [/\bthey\b/gi, 'you'],
]

/**
 * "Take home a finished fabric-art panel · Ages 12+", from the paragraph that
 * reads "Each guest goes home with a finished fabric-art panel. Ages 12 and up."
 *
 * The sentence after it says who the workshop is for: "Ages N and up" becomes
 * "Ages N+", anything else short ("Grades 9–12 only") is kept as written.
 * Empty when no paragraph after the first has that shape.
 */
export function takeHomeLine(description?: string | null): string {
  const paragraph = paragraphs(description)
    .slice(1)
    .find((p) => TAKE_HOME.test(p))
  if (!paragraph) return ''

  const [first, second = ''] = paragraph
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/[.!?]+$/, '').trim())
  const what = (first.match(TAKE_HOME)?.[1] ?? '').trim()
  if (!what) return ''

  const toReader = TO_THE_READER.reduce((text, [from, to]) => text.replace(from, to), what)
  const ages = second.match(AGES_AND_UP)
  const audience = ages ? `Ages ${ages[1]}+` : second.length <= AUDIENCE_MAX ? second : ''

  return [`Take home ${toReader}`, audience].filter(Boolean).join(' · ')
}

/** The most the sign-up endpoint keeps of an `interest`. */
const INTEREST_MAX = 80

/**
 * What a "tell me" sign-up on a card is filed under, e.g.
 * "workshop-waitlist:Kinusaiga 2026-10-16". A long name is cut so the whole
 * thing fits and the date is never lost.
 */
export function notifyInterest(kind: 'workshop-soon' | 'workshop-waitlist', name: string, date: string): string {
  const room = INTEREST_MAX - kind.length - 1 - 1 - date.length
  return `${kind}:${name.trim().slice(0, Math.max(room, 0)).trim()} ${date}`
}
