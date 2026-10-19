// No imports: Netlify functions import this by a relative path (no @lib aliases there).

/**
 * The Netlify Blobs store a deployment really uses. STORE_NAMESPACE (set only
 * on a preview branch, e.g. "preview") keeps that branch's data in its own
 * stores ("preview-waivers"), so a preview running against Square's sandbox
 * never writes into the live site's records (Kaden, 18 Oct 2026). And sandbox
 * money must never land in live stores: on Netlify, SQUARE_ENVIRONMENT=sandbox
 * without a namespace is refused. Pure, so it is tested.
 */
export function blobStoreName(storeName: string, env: { STORE_NAMESPACE?: string; SQUARE_ENVIRONMENT?: string; NETLIFY?: string }): string {
  const ns = (env.STORE_NAMESPACE ?? '').trim()
  if (!ns && env.NETLIFY === 'true' && env.SQUARE_ENVIRONMENT === 'sandbox') {
    throw new Error(`Refusing the live "${storeName}" store: this deploy uses Square's sandbox but has no STORE_NAMESPACE`)
  }
  if (!ns) return storeName
  if (!/^[a-z0-9-]{1,30}$/.test(ns)) throw new Error(`STORE_NAMESPACE "${ns}" must be lowercase letters, digits or dashes`)
  return `${ns}-${storeName}`
}
