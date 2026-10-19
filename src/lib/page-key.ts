/**
 * Private party pages (S2-R9a): `/party/<id>?key=…` (the host page, which
 * shows other families' children and allergies) and `/party/pay/<id>?k=…`
 * (the payment link). Their keys must never reach GA4, Meta or PostHog.
 *
 *   - Layout leaves out GA4 and the Meta Pixel on them and never
 *     session-records them (PostHog pageviews only, with no query string).
 *   - `PAGE_KEY_SCRIPT` runs first in <head>, before any analytics: it moves
 *     the key from the address bar into sessionStorage (so a refresh still
 *     works, see `rememberedPageKey`) and leaves the URL as the bare path.
 *     It also makes every link into a private page a full page load, so a
 *     key never rides an in-site (view transition) page change that the
 *     analytics already on the page would report.
 *   - `<meta name="referrer" content="same-origin">` keeps the page's address
 *     from going to other sites.
 *
 * Client-safe: no imports.
 */

/** /party/… (host page, payment link). */
export const PRIVATE_PARTY_PATH = /^\/party(\/|$)/

export function isPrivatePartyPage(pathname: string): boolean {
  return PRIVATE_PARTY_PATH.test(pathname)
}

const STORE_PREFIX = 'hs-page-key:'

/** The key this tab moved out of the address bar for this page, or ''. */
export function rememberedPageKey(pathname: string = typeof location !== 'undefined' ? location.pathname : ''): string {
  try {
    return globalThis.sessionStorage?.getItem(STORE_PREFIX + pathname) ?? ''
  } catch {
    return ''
  }
}

/**
 * Inline, first in <head>. Never throws. Also defines `window.__hsScrubKeys`,
 * which PostHog's `before_send` runs on every event: any `key=` / `k=` query
 * parameter in any string of the event (current URL, referrer, a clicked
 * link's href in `$elements` / `$elements_chain`) is removed.
 */
export const PAGE_KEY_SCRIPT = `(function(){try{
var w=window,d=document,P=${PRIVATE_PARTY_PATH.toString()};
if(!w.__hsScrubKeys){var S=function(s){return s.indexOf('=')<0?s:s.replace(/([?&])(?:key|k)=[^&#\\s"']*&?/g,'$1').replace(/[?&](?=$|#|["'\\s])/g,'')};var W=function(v,n){if(n>8||v==null)return v;if(typeof v==='string')return S(v);if(typeof v==='object'){for(var i in v){if(Object.prototype.hasOwnProperty.call(v,i))v[i]=W(v[i],n+1)}}return v};w.__hsScrubKeys=function(e){try{return W(e,0)}catch(_){return e}}}
if(!w.__hsPageKeyGuard){w.__hsPageKeyGuard=1;d.addEventListener('click',function(e){try{var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var u=new URL(a.href,location.href);if(u.origin===location.origin&&P.test(u.pathname))a.setAttribute('data-astro-reload','')}catch(_){}} ,true)}
var u=new URL(location.href);if(!P.test(u.pathname))return;
var k=u.searchParams.get('k')||u.searchParams.get('key');
if(k){try{sessionStorage.setItem('${STORE_PREFIX}'+u.pathname,k)}catch(_){}}
if(u.search){history.replaceState(history.state,'',u.pathname+u.hash)}
}catch(_){}})();`
