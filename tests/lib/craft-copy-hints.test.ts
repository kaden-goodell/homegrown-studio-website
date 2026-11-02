import { describe, it, expect } from 'vitest'
import { CRAFT_COPY_EXAMPLE, craftCopyNotes } from '@lib/crafts/craft-copy-hints'

describe('craft copy notes (the approved voice, as gentle suggestions)', () => {
  it('the example reads right: no notes', () => {
    expect(craftCopyNotes(CRAFT_COPY_EXAMPLE)).toEqual([])
  })
  it('empty: nothing to say yet', () => {
    expect(craftCopyNotes('  ')).toEqual([])
  })
  it('flags colons, party/birthday words, kid words, lessons, a missing ages line and one long paragraph', () => {
    const notes = craftCopyNotes('Learn to make a birthday keychain for girls: so fun!!')
    expect(notes).toEqual(expect.arrayContaining([
      'Try 3 short paragraphs, with an empty line between them.',
      'Leave out colons. Use a period or a comma.',
      'Leave out “party” and “birthday”. Crafts are for everyone, any occasion.',
      'Say “everyone” or “each guest” rather than girls, boys or kids.',
      'People come to make it, not to take a lesson. Say what they make and do.',
      'One exclamation mark at most.',
      'End with the ages, like “Ages 8 and up.”',
    ]))
  })
  it('made to order wants a Heads up paragraph, and its colon is fine', () => {
    expect(craftCopyNotes(CRAFT_COPY_EXAMPLE, { personalized: true })).toContain('Made to order: add a last paragraph starting “Heads up:” that says it’s made ahead and can’t be changed or refunded.')
    const withHeadsUp = `${CRAFT_COPY_EXAMPLE}\n\nHeads up: it is made to order, so it can’t be changed or refunded once made.`
    expect(craftCopyNotes(withHeadsUp, { personalized: true })).toEqual([])
  })
})
