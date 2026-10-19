// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { applyPartyNumbers, loadPartyNumbers } from '@lib/party-numbers-live'
import { policySections } from '@config/policy-content'
import { CONFIG_COPY_FACTS } from '@config/party-content'

function page(): Document {
  const doc = document.implementation.createHTMLDocument('t')
  const party = policySections[0]
  doc.body.innerHTML = `
    <span data-party-from>Whole studio · from $300</span>
    <p data-policy-text="parties:intro">${party.intro}</p>
    ${party.rules.map((r, i) => `<dd data-policy-text="parties:${i}">${r.body}</dd>`).join('')}
    <dd data-policy-text="workshops:0">untouched</dd>`
  return doc
}

afterEach(() => vi.restoreAllMocks())

describe('party numbers on the pre-built pages', () => {
  it('with today’s numbers, changes nothing', () => {
    const doc = page()
    const before = doc.body.innerHTML
    applyPartyNumbers(doc, { copy: CONFIG_COPY_FACTS, from: { name: 'Whole studio', priceCents: 30000 } })
    expect(doc.body.innerHTML).toBe(before)
  })

  it('swaps in the saved fee, minimum and cheapest package', () => {
    const doc = page()
    applyPartyNumbers(doc, { copy: { ...CONFIG_COPY_FACTS, feeCents: 35000, minGuests: 12 }, from: { name: 'Table party', priceCents: 15000 } })
    expect(doc.querySelector('[data-party-from]')!.textContent).toBe('Table party · from $150')
    expect(doc.querySelector('[data-policy-text="parties:intro"]')!.textContent).toMatch(/^Your \$350 studio fee/)
    expect(doc.body.textContent).toContain('with a 12-craft minimum')
    expect(doc.querySelector('[data-policy-text="workshops:0"]')!.textContent).toBe('untouched')
  })

  it('leaves the page as built when the request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response)
    const doc = page()
    const before = doc.body.innerHTML
    await loadPartyNumbers(doc)
    expect(doc.body.innerHTML).toBe(before)
  })
})
