/**
 * The page behaviour of /quote/corky-christmas (moved out of the page so it can
 * be tested): picking a night, the monogram add-on in the dark reserve card,
 * the "Text us your pick" message, and the paid lock-in.
 *
 * What the deposit island needs is put on <body>: data-pick (the night's name),
 * data-pick-id, data-monogram ('true' when added). Paid state comes from
 * GET /api/quote/corky-status.json on load (any device, any reload) or from the
 * island's 'corky-held' window event right after paying (a simulated payment
 * holds for that page load only). Locked: the cards stop answering, the picked
 * one reads "✓ Your night", the others fade back, and the text link becomes a
 * plain "Text us".
 */

export const TOTE_ID = 'tote'
export const MONOGRAM_PER_GUEST = 15
export const STUDIO_SMS = 'sms:+12564641710?&body='
export const HELLO = "Hi! It's Jessyca from the Corky Child Care Collective."
export const HELD_EVENT = 'corky-held'

export interface Held {
  night: string | null
  monogram: boolean
}

const GOLD = ['#c8943c', '#b8860b', '#daa520', '#d4a040']

export function pickMessage(name: string, monogram: boolean): string {
  return `${HELLO} For our Dec 12 night we'd like ${name}${monogram ? ' with monograms' : ''}.`
}

/** Returns a function that stops listening for the paid event (tests). */
export function initCorkyPage(doc: Document = document): () => void {
  const ac = new AbortController()
  const win = doc.defaultView!
  const body = doc.body
  const cards = [...doc.querySelectorAll<HTMLButtonElement>('.theme')]
  const sum = doc.getElementById('sum')!
  const sumimg = doc.getElementById('sumimg') as HTMLImageElement
  const text = doc.getElementById('textpick') as HTMLAnchorElement
  const reserve = doc.querySelector<HTMLElement>('.reserve')!
  const monoHint = doc.getElementById('monohint')!
  const monoRow = doc.getElementById('monorow')!
  const monoBox = doc.getElementById('monogram') as HTMLInputElement
  const monoLabel = doc.getElementById('monolabel')!
  const namesDue = doc.getElementById('namesdue')!
  const price = Number(reserve.dataset.price) || 75
  const calm = !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const fade = (el: Element, ms = 450) => { if (!calm) (el as HTMLElement).animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'ease-out' }) }

  const current = () => cards.find((c) => c.getAttribute('aria-pressed') === 'true') ?? null
  const isTote = (c: HTMLElement | null) => c?.dataset.id === TOTE_ID

  // A few specks of gold glitter rise and fade where she tapped.
  function sparkle(card: HTMLElement, x: number, y: number) {
    if (calm || !card.animate) return
    const layer = doc.createElement('span')
    layer.className = 'sparkle'
    card.appendChild(layer)
    for (let i = 0; i < 14; i++) {
      const dot = doc.createElement('i')
      const size = 2 + Math.random() * 2.5
      dot.style.cssText = `left:${x + (Math.random() - 0.5) * 70}px;top:${y + (Math.random() - 0.5) * 40}px;width:${size}px;height:${size}px;background:${GOLD[i % GOLD.length]}`
      layer.appendChild(dot)
      dot.animate(
        [
          { transform: 'translate(-50%,-50%)', opacity: 0 },
          { opacity: 0.9, offset: 0.25 },
          { transform: `translate(calc(-50% + ${(Math.random() - 0.5) * 30}px), calc(-50% - ${30 + Math.random() * 40}px))`, opacity: 0 },
        ],
        { duration: 1100 + Math.random() * 600, delay: Math.random() * 180, easing: 'ease-out', fill: 'forwards' },
      )
    }
    win.setTimeout(() => layer.remove(), 2000)
  }

  /** Price line, monogram row and note, the text link, and <body> data for the island. */
  function render() {
    const card = current()
    const mono = isTote(card) && monoBox.checked
    if (card) {
      const name = card.dataset.name!
      sum.textContent = `${name} · $${price + (mono ? MONOGRAM_PER_GUEST : 0)} a guest`
      body.dataset.pick = name
      body.dataset.pickId = card.dataset.id
    }
    body.dataset.monogram = mono ? 'true' : 'false'
    namesDue.hidden = !mono
    const monoFine = doc.getElementById('monofine')
    if (monoFine) monoFine.hidden = !isTote(card)
    if (body.dataset.locked === 'true') return
    if (card) text.setAttribute('href', STUDIO_SMS + encodeURIComponent(pickMessage(card.dataset.name!, mono)))
  }

  function pick(card: HTMLButtonElement, x: number, y: number) {
    if (body.dataset.locked === 'true') return
    const was = card.getAttribute('aria-pressed') === 'true'
    const hadPick = !!current()
    cards.forEach((c) => {
      c.setAttribute('aria-pressed', c === card ? 'true' : 'false')
      c.querySelector('.tpick')!.textContent = c === card ? '✓ Picked' : 'Pick this one'
    })
    win.navigator.vibrate?.(12)
    const tick = card.querySelector('.tick') as HTMLElement | null
    if (!calm) tick?.animate?.([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 450, easing: 'ease-out' })
    if (!was) sparkle(card, x, y)
    reserve.style.setProperty('--accent', card.dataset.accent ?? '')
    sumimg.hidden = false
    if (!was) fade(sumimg, 600)
    sumimg.src = card.dataset.photo ?? sumimg.src
    monoHint.hidden = true
    if (isTote(card)) {
      if (monoRow.hidden) { monoRow.hidden = false; fade(monoRow) }
    } else {
      monoRow.hidden = true
      monoBox.checked = false
    }
    if (!hadPick) fade(sum, 350)
    render()
  }

  /** Paid: lock the night (if one was picked) and show the held state. */
  function hold(h: Held) {
    if (body.dataset.held === 'true') return
    body.dataset.held = 'true'
    const card = h.night ? cards.find((c) => c.dataset.name === h.night) ?? null : null
    if (!card) return // paid without a night: cards stay open, the island shows held
    body.dataset.locked = 'true'
    cards.forEach((c) => {
      const mine = c === card
      c.setAttribute('aria-pressed', mine ? 'true' : 'false')
      c.setAttribute('aria-disabled', 'true')
      c.tabIndex = -1
      c.classList.toggle('locked', true)
      c.classList.toggle('faded', !mine)
      c.querySelector('.tpick')!.textContent = mine ? '✓ Your night' : ''
      ;(c.querySelector('.tpick') as HTMLElement).hidden = !mine
    })
    reserve.style.setProperty('--accent', card.dataset.accent ?? '')
    sumimg.hidden = false
    sumimg.src = card.dataset.photo ?? sumimg.src
    monoHint.hidden = true
    const mono = isTote(card) && h.monogram
    monoBox.checked = mono
    monoBox.disabled = true
    monoRow.hidden = !mono
    monoRow.classList.toggle('locked', mono)
    monoLabel.textContent = '✓ Monograms added'
    text.textContent = 'Text us'
    text.setAttribute('href', STUDIO_SMS + encodeURIComponent(HELLO))
    render()
  }

  cards.forEach((c) => {
    c.addEventListener('pointerdown', () => { if (body.dataset.locked !== 'true') c.classList.add('down') })
    ;['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => c.addEventListener(ev, () => c.classList.remove('down')))
    c.addEventListener('click', (e) => {
      const r = c.getBoundingClientRect()
      const x = e.clientX ? e.clientX - r.left : r.width / 2
      const y = e.clientY ? e.clientY - r.top : r.height / 3
      pick(c, x, y)
    })
  })
  monoBox.addEventListener('change', render)
  win.addEventListener(HELD_EVENT, (e) => {
    const d = (e as CustomEvent<Partial<Held>>).detail ?? {}
    hold({ night: typeof d.night === 'string' ? d.night : null, monogram: d.monogram === true })
  }, { signal: ac.signal })
  render()

  // Already paid (another device, or a reload): lock it in. Any failure leaves the page as it was.
  win
    .fetch('/api/quote/corky-status.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => {
      if (s?.paid) {
        const h = { night: typeof s.night === 'string' ? s.night : null, monogram: s.monogram === true }
        hold(h)
        win.dispatchEvent(new win.CustomEvent(HELD_EVENT, { detail: h }))
      }
    })
    .catch(() => undefined)
  return () => ac.abort()
}
