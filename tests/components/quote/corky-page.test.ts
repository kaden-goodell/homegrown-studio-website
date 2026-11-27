/**
 * The page behaviour of /for/corky-christmas-2026 (src/lib/quote/corky-page.ts)
 * on a copy of the page's markup: picking, the monogram add-on, the text link,
 * and the paid lock-in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initCorkyPage, HELD_EVENT, HELLO, STUDIO_SMS } from '@lib/quote/corky-page'

const NIGHTS = [
  { id: 'mosaic', name: 'Mosaics & Plant Bar' },
  { id: 'tote', name: 'Tote & Keychain Bar' },
  { id: 'ornament', name: 'Ornament Bar' },
]

function mount() {
  document.body.innerHTML = `
    ${NIGHTS.map((n) => `<button type="button" class="theme" data-id="${n.id}" data-name="${n.name}" data-photo="/${n.id}.jpg" data-accent="#000" aria-pressed="false"><span class="tick"></span><span class="tpick">Pick this one</span></button>`).join('')}
    <section class="reserve" data-price="75">
      <img id="sumimg" src="/mosaic.jpg" hidden />
      <p id="sum">$75 a guest · 40 to 50 guests</p>
      <p id="monohint">Monograms on the tote night, +$15 a guest</p>
      <label id="monorow" hidden><input type="checkbox" id="monogram" /><span id="monolabel">Add monograms · +$15 a guest</span></label>
      <p id="namesdue" hidden>Names due Sat, Dec 5.</p>
      <a id="textpick" href="sms:+12564641710">Text us your pick</a>
    </section>`
}

const $ = (id: string) => document.getElementById(id)!
const card = (id: string) => document.querySelector<HTMLButtonElement>(`.theme[data-id="${id}"]`)!
const box = () => $('monogram') as HTMLInputElement
const smsBody = () => decodeURIComponent($('textpick').getAttribute('href')!.slice(STUDIO_SMS.length))
const toggle = () => { box().click() }

let status: { ok: boolean; body: unknown } | 'throw'
let stop: (() => void) | null = null
async function start() {
  stop = initCorkyPage(document)
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  status = { ok: true, body: { paid: false, night: null, monogram: false, paidAt: null } }
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (status === 'throw') throw new TypeError('offline')
    const s = status
    return { ok: s.ok, json: async () => s.body }
  }))
  mount()
  for (const k of Object.keys(document.body.dataset)) delete document.body.dataset[k]
})
afterEach(() => {
  stop?.()
  stop = null
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('picking and the monogram add-on', () => {
  it('before any pick: the quiet monogram line shows, the switch does not', async () => {
    await start()
    expect($('monohint').hidden).toBe(false)
    expect($('monorow').hidden).toBe(true)
    expect(document.body.dataset.monogram).toBe('false')
  })

  it('the tote night shows the switch; on → $90, names due, the text and <body> say monograms', async () => {
    await start()
    card('tote').click()
    expect($('monohint').hidden).toBe(true)
    expect($('monorow').hidden).toBe(false)
    expect($('sum').textContent).toBe('Tote & Keychain Bar · $75 a guest')
    expect(smsBody()).toBe(`${HELLO} For our Dec 12 night we'd like Tote & Keychain Bar.`)
    toggle()
    expect($('sum').textContent).toBe('Tote & Keychain Bar · $90 a guest')
    expect($('namesdue').hidden).toBe(false)
    expect(smsBody()).toBe(`${HELLO} For our Dec 12 night we'd like Tote & Keychain Bar with monograms.`)
    expect(document.body.dataset).toMatchObject({ pick: 'Tote & Keychain Bar', pickId: 'tote', monogram: 'true' })
  })

  it('another night hides the switch and turns it off', async () => {
    await start()
    card('tote').click()
    toggle()
    card('ornament').click()
    expect($('monorow').hidden).toBe(true)
    expect(box().checked).toBe(false)
    expect($('namesdue').hidden).toBe(true)
    expect($('sum').textContent).toBe('Ornament Bar · $75 a guest')
    expect(document.body.dataset.monogram).toBe('false')
    expect(smsBody()).toBe(`${HELLO} For our Dec 12 night we'd like Ornament Bar.`)
    card('tote').click()
    expect(box().checked).toBe(false)
    expect($('sum').textContent).toBe('Tote & Keychain Bar · $75 a guest')
  })
})

describe('paid lock-in', () => {
  it('paid with the tote night and monograms: cards locked, "✓ Your night", others faded, monograms locked, plain "Text us"', async () => {
    status = { ok: true, body: { paid: true, night: 'Tote & Keychain Bar', monogram: true, paidAt: '2026-11-18T15:02:00Z' } }
    const heard = vi.fn()
    window.addEventListener(HELD_EVENT, heard)
    await start()
    window.removeEventListener(HELD_EVENT, heard)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(document.body.dataset.held).toBe('true')
    for (const n of NIGHTS) expect(card(n.id)).toHaveAttribute('aria-disabled', 'true')
    expect(card('tote')).toHaveAttribute('aria-pressed', 'true')
    expect(card('tote').querySelector('.tpick')!.textContent).toBe('✓ Your night')
    expect(card('mosaic').classList.contains('faded')).toBe(true)
    expect(card('ornament').classList.contains('faded')).toBe(true)
    expect(card('tote').classList.contains('faded')).toBe(false)
    expect($('sum').textContent).toBe('Tote & Keychain Bar · $90 a guest')
    expect($('monorow').hidden).toBe(false)
    expect(box().disabled).toBe(true)
    expect(box().checked).toBe(true)
    expect($('monolabel').textContent).toBe('✓ Monograms added')
    expect($('textpick').textContent).toBe('Text us')
    expect(smsBody()).toBe(HELLO)
    // Locked: a tap changes nothing.
    card('ornament').click()
    expect(card('tote')).toHaveAttribute('aria-pressed', 'true')
    expect($('sum').textContent).toBe('Tote & Keychain Bar · $90 a guest')
  })

  it('paid with another night: no monogram row at all', async () => {
    status = { ok: true, body: { paid: true, night: 'Ornament Bar', monogram: false, paidAt: 'x' } }
    await start()
    expect($('monorow').hidden).toBe(true)
    expect($('monohint').hidden).toBe(true)
    expect($('sum').textContent).toBe('Ornament Bar · $75 a guest')
  })

  it('paid with no night: held, but the cards stay open and the link still says "Text us your pick"', async () => {
    status = { ok: true, body: { paid: true, night: null, monogram: false, paidAt: 'x' } }
    await start()
    expect(document.body.dataset.held).toBe('true')
    expect(document.body.dataset.locked).toBeUndefined()
    expect(card('tote')).not.toHaveAttribute('aria-disabled')
    expect($('textpick').textContent).toBe('Text us your pick')
    card('tote').click()
    expect(card('tote')).toHaveAttribute('aria-pressed', 'true')
  })

  it('the deposit sheet’s own "held" event locks it for this page load', async () => {
    await start()
    card('tote').click()
    toggle()
    window.dispatchEvent(new CustomEvent(HELD_EVENT, { detail: { night: 'Tote & Keychain Bar', monogram: true } }))
    expect(card('tote').querySelector('.tpick')!.textContent).toBe('✓ Your night')
    expect($('monolabel').textContent).toBe('✓ Monograms added')
  })

  it('status unreachable: the page stays as it is', async () => {
    status = 'throw'
    await start()
    expect(document.body.dataset.held).toBeUndefined()
    card('mosaic').click()
    expect(card('mosaic')).toHaveAttribute('aria-pressed', 'true')
  })
})
