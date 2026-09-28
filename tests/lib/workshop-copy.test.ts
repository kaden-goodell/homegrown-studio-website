import { describe, it, expect } from 'vitest'
import { firstParagraph, notifyInterest, takeHomeLine } from '@lib/workshop-copy'

// The six descriptions live in Square on 27 Sep 2026, word for word. Four
// separate their paragraphs with one line break, two with a blank line.
const KINUSAIGA =
  'Kinusaiga is Japanese fabric art with no sewing: you tuck fabric into grooves cut in a foam board to build a picture.\nEveryone picks their design and fabrics, scores the board, and tucks piece by piece until the image appears. No needle, no thread, no experience needed.\nEach guest goes home with a finished fabric-art panel. Ages 12 and up.'
const EARRINGS =
  'Build your own fall earrings from a bar of glitter acrylic pieces: pumpkins, leaves, acorns, and more.\nEveryone picks a combo off the menu (two big and one medium, one big and three studs, and so on), then chooses their pieces and finishes from the trays and assembles them with our help. Sparkle level is up to you.\nEach guest goes home with their finished earrings on a card. Ages 12 and up.'
const EMBROIDERY =
  'Learn to run an embroidery machine and stitch a fall design onto something you take home.\nEveryone picks a design and thread colors, then learns to hoop the fabric, load the file, and run the machine with step-by-step help. Small class, so you get real time at the machine.\nEach guest goes home with a finished machine-embroidered piece. Ages 12 and up.'
const TALLOW =
  "Make your own tallow skin balm from scratch, the way it's been done for a very long time.\n\nEveryone renders and whips their own batch, then picks a scent from the oil bar to finish it. We'll cover what tallow is, why it works on skin, and how to keep it.\n\nEach guest goes home with a jar of balm they made. Ages 16 and up."
const CRAFT_NIGHT =
  'A craft night just for high schoolers: cover a bulletin board in fabric and make it yours.\nEveryone picks their fabric, wraps and pins the board, then adds ribbon, trim, and whatever else you want on it. Music on, no little siblings, no grown-ups at your table.\nEach guest goes home with a finished fabric bulletin board for their room. Grades 9–12 only.'
const NEEDLEPOINT =
  "Learn needlepoint on a small canvas you'll finish in one sitting.\n\nEveryone gets a printed canvas, wool, and a tapestry needle, then learns the tent stitch and how to read a canvas with step-by-step help. It's slower than it looks and very hard to put down.\n\nEach guest goes home with a finished piece and everything they need to keep going. Ages 12 and up."

describe('firstParagraph', () => {
  it('is the first paragraph, whether paragraphs are split by one line break or a blank line', () => {
    expect(firstParagraph(KINUSAIGA)).toBe(
      'Kinusaiga is Japanese fabric art with no sewing: you tuck fabric into grooves cut in a foam board to build a picture.',
    )
    expect(firstParagraph(TALLOW)).toBe(
      "Make your own tallow skin balm from scratch, the way it's been done for a very long time.",
    )
  })

  it('reads the six live descriptions', () => {
    expect(firstParagraph(EARRINGS)).toBe(
      'Build your own fall earrings from a bar of glitter acrylic pieces: pumpkins, leaves, acorns, and more.',
    )
    expect(firstParagraph(EMBROIDERY)).toBe(
      'Learn to run an embroidery machine and stitch a fall design onto something you take home.',
    )
    expect(firstParagraph(CRAFT_NIGHT)).toBe(
      'A craft night just for high schoolers: cover a bulletin board in fabric and make it yours.',
    )
    expect(firstParagraph(NEEDLEPOINT)).toBe("Learn needlepoint on a small canvas you'll finish in one sitting.")
  })

  it('is the whole text when there is one paragraph', () => {
    expect(firstParagraph('Learn the basics of wheel throwing.')).toBe('Learn the basics of wheel throwing.')
  })

  it('skips leading blank lines and tidies spacing', () => {
    expect(firstParagraph('\n\n  Make   a candle.  \nThen more.')).toBe('Make a candle.')
  })

  it('is empty when there is no description', () => {
    expect(firstParagraph('')).toBe('')
    expect(firstParagraph('   \n ')).toBe('')
    expect(firstParagraph(undefined)).toBe('')
    expect(firstParagraph(null)).toBe('')
  })
})

describe('takeHomeLine', () => {
  it('turns "Each guest goes home with… Ages N and up." into one short line', () => {
    expect(takeHomeLine(KINUSAIGA)).toBe('Take home a finished fabric-art panel · Ages 12+')
    expect(takeHomeLine(EMBROIDERY)).toBe('Take home a finished machine-embroidered piece · Ages 12+')
  })

  it('speaks to the reader: "their" and "they" become "your" and "you"', () => {
    expect(takeHomeLine(EARRINGS)).toBe('Take home your finished earrings on a card · Ages 12+')
    expect(takeHomeLine(TALLOW)).toBe('Take home a jar of balm you made · Ages 16+')
    expect(takeHomeLine(NEEDLEPOINT)).toBe(
      'Take home a finished piece and everything you need to keep going · Ages 12+',
    )
  })

  it('keeps a different who-it-is-for sentence as written', () => {
    expect(takeHomeLine(CRAFT_NIGHT)).toBe(
      'Take home a finished fabric bulletin board for your room · Grades 9–12 only',
    )
  })

  it('works with no who-it-is-for sentence', () => {
    expect(takeHomeLine('One.\nTwo.\nEach guest goes home with a candle.')).toBe('Take home a candle')
  })

  it('drops a long or second extra sentence rather than crowd the line', () => {
    expect(
      takeHomeLine(
        'One.\nTwo.\nEach guest goes home with a candle. Children under twelve must bring a grown-up who stays for the whole class.',
      ),
    ).toBe('Take home a candle')
    expect(takeHomeLine('One.\nTwo.\nEach guest goes home with a candle. Ages 8 and up. Bring an apron.')).toBe(
      'Take home a candle · Ages 8+',
    )
  })

  it('is empty when no later paragraph has that shape', () => {
    expect(takeHomeLine('Learn the basics of wheel throwing.')).toBe('')
    expect(takeHomeLine('One.\nTwo.\nYou will love it. Ages 12 and up.')).toBe('')
    expect(takeHomeLine('One.\nTwo.\nEach guest goes home with.')).toBe('')
    expect(takeHomeLine('')).toBe('')
    expect(takeHomeLine(undefined)).toBe('')
  })

  it('never reads the first paragraph as the take-home line', () => {
    expect(takeHomeLine('Each guest goes home with a candle. Ages 8 and up.')).toBe('')
  })

  it('does not touch words that only contain "they" or "them"', () => {
    expect(takeHomeLine('One.\nTwo.\nEach guest goes home with a themed anthem print. Ages 8 and up.')).toBe(
      'Take home a themed anthem print · Ages 8+',
    )
  })
})

describe('notifyInterest', () => {
  it('names the kind of sign-up, the workshop and its date', () => {
    expect(notifyInterest('workshop-waitlist', 'Kinusaiga', '2026-10-16')).toBe('workshop-waitlist:Kinusaiga 2026-10-16')
    expect(notifyInterest('workshop-soon', 'Kinusaiga', '2026-10-16')).toBe('workshop-soon:Kinusaiga 2026-10-16')
  })

  it('cuts a long name so the whole thing fits in 80 characters, date intact', () => {
    const long = 'Needlepoint'.repeat(8)
    const interest = notifyInterest('workshop-waitlist', long, '2026-10-16')
    expect(interest).toBe(`workshop-waitlist:${long.slice(0, 51)} 2026-10-16`)
    expect(interest.length).toBe(80)
    expect(notifyInterest('workshop-soon', long, '2026-10-16').length).toBe(80)
  })

  it('leaves no space before the date when the cut lands on one', () => {
    // 51 characters fit after "workshop-waitlist:"; the 51st here is a space.
    const name = `${'x'.repeat(50)} and more`
    expect(notifyInterest('workshop-waitlist', name, '2026-10-16')).toBe(`workshop-waitlist:${'x'.repeat(50)} 2026-10-16`)
  })
})
