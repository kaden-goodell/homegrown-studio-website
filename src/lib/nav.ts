/**
 * The site menu, read by the header and the footer so they never disagree.
 * Client-safe: no env reads here; the caller says whether kits are showing.
 */
import type { NavItem, SiteConfig } from '@config/site.config'
import { normalizePath } from '@lib/site-header'

export type { NavItem }

/** Used only when site.config has no `nav`. */
function fallbackNav(config: SiteConfig): NavItem[] {
  const items: NavItem[] = [{ label: 'Home', href: '/' }, { label: 'About', href: '/about' }]
  if (config.features.workshops) items.push({ label: 'Workshops', href: '/workshops' })
  if (config.features.programs?.enabled) items.push({ label: 'Programs', href: '/programs' })
  if (config.features.parties.enabled) items.push({ label: 'Book a Party', href: '/book' })
  if (config.features.gallery) items.push({ label: 'Gallery', href: '/gallery' })
  return items
}

/**
 * The menu as shown. /kits is left out while kits are closed, and a group
 * left with nothing in it is dropped.
 */
export function buildNav(config: SiteConfig, { kitsVisible }: { kitsVisible: boolean }): NavItem[] {
  const keep = (i: NavItem) => kitsVisible || i.href !== '/kits'
  const items = config.nav && config.nav.length > 0 ? config.nav : fallbackNav(config)
  return items
    .filter(keep)
    .map((i) => (i.children ? { ...i, children: i.children.filter(keep) } : i))
    .filter((i) => !i.children || i.children.length > 0)
}

/** Every page in the menu, in order, groups opened up (the footer's row). */
export function flatNav(items: NavItem[]): NavItem[] {
  return items.flatMap((i) => (i.children ? flatNav(i.children) : i.href ? [i] : []))
}

/** Is the page being shown this item, or one of its group's pages? */
export function navHoldsPath(item: NavItem, pathname: string): boolean {
  const here = normalizePath(pathname)
  return flatNav([item]).some((i) => !!i.href && normalizePath(i.href) === here)
}
