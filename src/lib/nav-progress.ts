/**
 * A thin line across the top of the screen while the next page loads.
 *
 * Moving between pages swaps them in place (view transitions), so until the
 * new page arrives the old one just sits there and a tap looks ignored. Fast
 * loads (most of them) finish before the line would show, so it never
 * flickers; a slow one gets the line straight away.
 *
 * The line lives on <html>, outside <body>, so the page swap never removes it.
 */

const SHOW_AFTER_MS = 120

let bar: HTMLDivElement | null = null
let showTimer: ReturnType<typeof setTimeout> | undefined

function ensureBar(): HTMLDivElement {
  if (bar && bar.isConnected) return bar
  bar = document.createElement('div')
  bar.setAttribute('aria-hidden', 'true')
  bar.dataset.navProgress = ''
  Object.assign(bar.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    height: '3px',
    width: '0%',
    background: 'var(--color-primary, #7a4a2e)',
    zIndex: '2000',
    opacity: '0',
    pointerEvents: 'none',
    transition: 'width 8s cubic-bezier(0.1, 0.7, 0.2, 1), opacity 0.2s ease',
  } satisfies Partial<CSSStyleDeclaration>)
  document.documentElement.appendChild(bar)
  return bar
}

export function startNavProgress(): void {
  clearTimeout(showTimer)
  showTimer = setTimeout(() => {
    const b = ensureBar()
    b.style.transition = 'none'
    b.style.width = '0%'
    b.style.opacity = '1'
    void b.offsetWidth // restart from zero
    b.style.transition = 'width 8s cubic-bezier(0.1, 0.7, 0.2, 1), opacity 0.2s ease'
    b.style.width = '85%' // creeps toward 85% and waits there for the page
  }, SHOW_AFTER_MS)
}

export function finishNavProgress(): void {
  clearTimeout(showTimer)
  if (!bar || bar.style.opacity !== '1') return
  const b = bar
  b.style.transition = 'width 0.2s ease, opacity 0.3s ease 0.15s'
  b.style.width = '100%'
  b.style.opacity = '0'
}

if (typeof document !== 'undefined') {
  document.addEventListener('astro:before-preparation', startNavProgress)
  document.addEventListener('astro:after-swap', finishNavProgress)
  // A failed or cancelled load never swaps; the next page-load still clears it.
  document.addEventListener('astro:page-load', finishNavProgress)
}
