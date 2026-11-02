import { describe, it, expect } from 'vitest'
import { build, toForm } from '@components/admin/classes/class-form'
import { content } from '../sheets/harness'

describe('class form: the early-bird round-trips (review Important 5)', () => {
  const two = content({
    ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
    prices: { pas_full: { adult: 3000, kid: 2000 } },
    earlyBird: { untilYmd: '2031-03-01', prices: { pas_full: { adult: 2500, kid: 1500 } } },
  })
  it('toForm → build gives back the same early-bird', () => {
    const b = build(toForm(two))
    expect(b.ok && b.content.earlyBird).toEqual(two.earlyBird)
  })
  it('off drops it; a class without one gets none', () => {
    const b = build({ ...toForm(two), ebOn: false })
    expect(b.ok && 'earlyBird' in b.content).toBe(false)
    const plain = build(toForm(content()))
    expect(plain.ok && 'earlyBird' in plain.content).toBe(false)
  })
  it('only seat prices still sold keep theirs; a seat kind removed takes its early-bird with it', () => {
    const f = toForm(two)
    const b = build({ ...f, ticketTypes: [f.ticketTypes[0]], prices: { pas_full: { adult: '30' } } })
    expect(b.ok && b.content.earlyBird).toEqual({ untilYmd: '2031-03-01', prices: { pas_full: { adult: 2500 } } })
  })
  it('names what to fix: no last day, no price, not lower', () => {
    const f = toForm(two)
    expect(build({ ...f, ebUntil: '' })).toMatchObject({ ok: false, errors: { earlybird: 'Pick the last day of the early-bird.' } })
    expect(build({ ...f, ebPrices: {} })).toMatchObject({ ok: false, errors: { earlybird: 'Add an early-bird price, or turn the early-bird off.' } })
    expect(build({ ...f, ebPrices: { pas_full: { adult: '30' } } })).toMatchObject({ ok: false, errors: { earlybird: 'The Adult early-bird price has to be lower than $30.' } })
  })
  it('an early-bird that has ended never blocks a save over a lowered regular price (the server leaves it off, M9)', () => {
    const ended = { ...two, earlyBird: { untilYmd: '2020-01-01', prices: { pas_full: { adult: 2500 } } } }
    const f = toForm(ended)
    const b = build({ ...f, prices: { pas_full: { adult: '20', kid: '20' } } })
    expect(b.ok).toBe(true)
  })
  it('M-a: an ended early-bird is never sent, so removing a seat kind can\'t turn it into a refused save', () => {
    const ended = { ...two, earlyBird: { untilYmd: '2020-01-01', prices: { pas_full: { adult: 2500, kid: 1500 } } } }
    const f = toForm(ended)
    const b = build({ ...f, ticketTypes: [f.ticketTypes[0]], prices: { pas_full: { adult: '30' } } })
    expect(b.ok).toBe(true)
    expect(b.ok && 'earlyBird' in b.content).toBe(false)
  })
})
