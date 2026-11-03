// Seat questions can close before sign-ups do (Kaden, 2 Nov 2026), for our own classes.
import { describe, it, expect } from 'vitest'
import { answersClosedQuestion, openQuestions, questionsCloseAt, withoutClosedAnswers } from '@lib/classes/questions-close'
import { quote } from '@lib/classes/pricing'
import { defaultRules, validateContent } from '@lib/classes/validate'
import type { ClassContent, ClassRules, ScheduledClass } from '@lib/classes/types'

const TEE = { id: 'q_tee', label: 'Tee size', choices: ['Youth S', 'Youth M'] }
const sess = (id: string, iso: string) => ({ id, startIso: iso, endIso: new Date(Date.parse(iso) + 2 * 3_600_000).toISOString(), capacity: 10 })
// Christmas Embroidery 101: Sat Dec 12, 6 PM Chicago (midnight UTC).
const START = '2026-12-13T00:00:00.000Z'
const WEEK_OUT = new Date(Date.parse(START) - 168 * 3_600_000)

function make(rules: Partial<ClassRules> = {}, sessions = [sess('ses_a', START)]): ScheduledClass {
  const content: ClassContent = {
    name: 'Christmas Embroidery 101', description: '', imageUrl: null, instructor: null,
    rules: { ...defaultRules(), ...rules },
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [{ id: 'all', label: 'Full class', covers: { kind: 'all' } }, { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } }],
    prices: { all: { person: 4000 }, day: { person: 2500 } },
    questions: [TEE], addOns: [], defaultCapacity: 10, defaultMinutes: 120,
  }
  return {
    id: 'cls_tee1', libraryId: null, libraryVersion: null, content, sessions, status: 'open',
    square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by: { id: 'u', name: 'u' }, history: [],
  }
}
const before = new Date(WEEK_OUT.getTime() - 60_000)
const after = new Date(WEEK_OUT.getTime() + 60_000)

describe('questions close before sign-ups do', () => {
  it('no setting: the questions stay open as long as sign-ups do', () => {
    const cls = make()
    expect(questionsCloseAt(cls, ['ses_a'])).toBeNull()
    expect(openQuestions(cls, ['ses_a'], after)).toEqual([TEE])
  })

  it('168 hours: asked until a week out, then not asked', () => {
    const cls = make({ questionsCloseHours: 168 })
    expect(questionsCloseAt(cls, ['ses_a'])).toBe(WEEK_OUT.toISOString())
    expect(openQuestions(cls, ['ses_a'], before)).toEqual([TEE])
    expect(openQuestions(cls, ['ses_a'], after)).toEqual([])
  })

  it('a class that does not take people partway counts from its first session, whichever day is picked', () => {
    const later = new Date(Date.parse(START) + 7 * 86_400_000).toISOString()
    const cls = make({ questionsCloseHours: 168, joinPartway: false }, [sess('ses_a', START), sess('ses_b', later)])
    expect(openQuestions(cls, ['ses_b'], after)).toEqual([])
    const partway = make({ questionsCloseHours: 168, joinPartway: true }, [sess('ses_a', START), sess('ses_b', later)])
    expect(openQuestions(partway, ['ses_b'], after)).toEqual([TEE])
    // Nothing picked yet on a pick-a-day option: open while a date still has them open.
    expect(openQuestions(partway, [], after)).toEqual([TEE])
  })

  it('a late booking prices with no pick; an answer to a closed question is not required or charged', () => {
    const cls = make({ questionsCloseHours: 168 })
    const early = quote(cls, { passId: 'all', tickets: { person: 1 }, seats: [{ answers: {} }] }, before, 9)
    expect(early.ok).toBe(false)
    expect(!early.ok && early.error).toMatch(/needs a tee size/)
    const late = quote(cls, { passId: 'all', tickets: { person: 2 } }, after, 9)
    expect(late.ok && late.value.totalCents).toBe(8720)
  })

  it('spots and drops answers to closed questions, keeping extras', () => {
    const cls = make({ questionsCloseHours: 168 })
    const seats = [{ answers: { q_tee: 'Youth S' }, addOns: { add_x: 1 } }]
    expect(answersClosedQuestion(cls, seats, ['ses_a'], before)).toBe(false)
    expect(answersClosedQuestion(cls, seats, ['ses_a'], after)).toBe(true)
    expect(withoutClosedAnswers(cls, seats, ['ses_a'], after)).toEqual([{ answers: {}, addOns: { add_x: 1 } }])
    expect(withoutClosedAnswers(cls, seats, ['ses_a'], before)).toEqual(seats)
  })

  it('the class sheet saves 0–720 hours and refuses anything else', () => {
    const base = { name: 'Tee class', description: 'x', ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'Full class', covers: { kind: 'all' } }], prices: { all: { person: 4000 } }, questions: [TEE], defaultCapacity: 10, defaultMinutes: 120 }
    const ok = validateContent({ ...base, rules: { questionsCloseHours: 168 } })
    expect(ok.ok && ok.value.rules.questionsCloseHours).toBe(168)
    const none = validateContent({ ...base, rules: {} })
    expect(none.ok && none.value.rules.questionsCloseHours).toBeUndefined()
    const bad = validateContent({ ...base, rules: { questionsCloseHours: 1000 } })
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.field).toBe('rules.questionsCloseHours')
  })
})
