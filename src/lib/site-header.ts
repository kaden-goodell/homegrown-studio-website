/**
 * Behaviour for the site header (src/components/shared/Header.astro): the
 * phone menu button, the scrolled state, and the underline on the current
 * page's link.
 *
 * Everything listens on `document` and looks the header up when it is needed,
 * so it keeps working after in-site navigation whether the header was carried
 * over or replaced by the next page's copy.
 *
 * Client-safe: no imports, no env.
 */

const MENU_BUTTON = '#menu-button'
const MENU = '#mobile-menu'
/** The menu's booking button is a button, not a page in the nav. */
const NAV_LINKS = '.header-link, .mobile-link:not(.mobile-link-cta)'

/** "/about/" and "/about" are the same page. The homepage stays "/". */
export function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/** Does a nav link's href point at the page being shown? */
export function isActivePath(href: string | null, pathname: string): boolean {
  if (!href) return false
  return normalizePath(href.split(/[?#]/)[0]) === normalizePath(pathname)
}

function menuButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>(MENU_BUTTON)
}

export function isMenuOpen(): boolean {
  return menuButton()?.getAttribute('aria-expanded') === 'true'
}

/** Opens the phone menu and puts focus on its first link. */
export function openMenu(): void {
  const button = menuButton()
  if (!button) return
  button.setAttribute('aria-expanded', 'true')
  document.querySelector<HTMLElement>(`${MENU} a, ${MENU} button`)?.focus({ preventScroll: true })
}

/** Closes the phone menu. `returnFocus` hands focus back to the menu button. */
export function closeMenu({ returnFocus = false }: { returnFocus?: boolean } = {}): void {
  const button = menuButton()
  if (!button) return
  button.setAttribute('aria-expanded', 'false')
  if (returnFocus) button.focus({ preventScroll: true })
}

/** Underline the link for the page being shown, and tell screen readers. */
export function syncActiveLinks(pathname: string = window.location.pathname): void {
  document.querySelectorAll(NAV_LINKS).forEach((el) => {
    const active = isActivePath(el.getAttribute('href'), pathname)
    el.classList.toggle('is-active', active)
    if (active) el.setAttribute('aria-current', 'page')
    else el.removeAttribute('aria-current')
  })
}

function syncScrolled(): void {
  document.getElementById('site-header')?.classList.toggle('scrolled', window.scrollY > 8)
}

let bound = false

export function initSiteHeader(): void {
  if (typeof document === 'undefined') return
  syncScrolled()
  if (bound) return
  bound = true

  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest(MENU_BUTTON)) {
      if (isMenuOpen()) closeMenu({ returnFocus: true })
      else openMenu()
      return
    }
    // A link in the menu was chosen, or the press landed outside the menu.
    if (isMenuOpen() && (!target?.closest(MENU) || target.closest('a'))) closeMenu()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isMenuOpen()) closeMenu({ returnFocus: true })
  })

  // Tabbing on past the last link leaves the menu; don't leave it hanging open.
  document.addEventListener('focusout', (e) => {
    if (!isMenuOpen()) return
    const next = e.relatedTarget instanceof Element ? e.relatedTarget : null
    if (next && !next.closest(`${MENU}, ${MENU_BUTTON}`)) closeMenu()
  })

  let ticking = false
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        syncScrolled()
        ticking = false
      })
    },
    { passive: true },
  )

  document.addEventListener('astro:page-load', () => {
    syncActiveLinks()
    closeMenu()
    syncScrolled()
  })
}
