/**
 * Meta (Facebook/Instagram) Pixel — lets Kaden show ads to people who already
 * visited and lets Meta aim boosts at people who book. Live site only, never
 * on the waiver, staff or party host pages (families' details are on those pages), and
 * with Meta's automatic form scraping turned off.
 *
 * Page changes inside the site (view transitions) don't reload the page, so
 * each `astro:page-load` sends its own PageView.
 */

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { callMethod?: unknown; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown }
    _fbq?: unknown
  }
}

const PIXEL_ID = import.meta.env.PUBLIC_META_PIXEL_ID || ''
const PRIVATE_PATHS = /^\/(waiver|staff|party)(\/|$)/

export function metaPixelAllowed(hostname: string, pathname: string): boolean {
  return !!PIXEL_ID && /(^|\.)ourhometownstudio\.com$/.test(hostname) && !PRIVATE_PATHS.test(pathname)
}

let started = false

function start(): void {
  if (started) return
  started = true
  // Meta's standard loader, unchanged.
  /* eslint-disable */
  // @ts-ignore
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq!('set', 'autoConfig', false, PIXEL_ID)
  window.fbq!('init', PIXEL_ID)
}

function onPage(): void {
  if (!metaPixelAllowed(location.hostname, location.pathname)) return
  start()
  window.fbq?.('track', 'PageView')
}

if (typeof document !== 'undefined') document.addEventListener('astro:page-load', onPage)

/** Our event names → Meta's standard events (the ones ads can optimize for). */
export function toMetaEvent(event: string, props: Record<string, unknown> = {}): [string, Record<string, unknown>] | null {
  const value = typeof props.value === 'number' ? { value: props.value, currency: 'USD' } : {}
  switch (event) {
    case 'view_item': return ['ViewContent', value]
    case 'begin_checkout': return ['InitiateCheckout', value]
    case 'add_payment_info': return ['AddPaymentInfo', value]
    case 'newsletter_subscribed':
    case 'notify_me_signup': return ['Lead', {}]
    case 'generate_lead': return ['Contact', {}]
    default: return null
  }
}
