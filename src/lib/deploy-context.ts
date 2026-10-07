/**
 * Which kind of deployment this code is running in.
 *
 * Netlify's `CONTEXT` env var exists at BUILD time but is not set while
 * functions serve requests, so the runtime global
 * (`Netlify.context.deploy.context`) is checked before it. Anything we can't
 * identify is 'unknown', and callers treat 'unknown' like production.
 */
import { createLogger } from '@lib/logger'

export type DeployContext = 'dev' | 'production' | 'deploy-preview' | 'branch-deploy' | 'unknown'

const KNOWN: DeployContext[] = ['production', 'deploy-preview', 'branch-deploy']

/** The resolution rule with its inputs passed in, so each source can be tested. */
export function resolveDeployContext(input: {
  dev: boolean
  netlify?: string
  env?: string
  host?: string
}): { context: DeployContext; source: 'import.meta.env.DEV' | 'Netlify.context' | 'process.env.CONTEXT' | 'request host' | 'none' } {
  if (input.dev) return { context: 'dev', source: 'import.meta.env.DEV' }
  const fromNetlify = KNOWN.find((c) => c === input.netlify)
  if (fromNetlify) return { context: fromNetlify, source: 'Netlify.context' }
  const fromEnv = KNOWN.find((c) => c === input.env)
  if (fromEnv) return { context: fromEnv, source: 'process.env.CONTEXT' }
  const fromHost = contextFromHost(input.host)
  if (fromHost) return { context: fromHost, source: 'request host' }
  return { context: 'unknown', source: 'none' }
}

/** deploy-preview-12--site.netlify.app, dev--site.netlify.app, site.netlify.app, our own domain. */
export function contextFromHost(rawHost: string | undefined): DeployContext | null {
  const host = (rawHost ?? '').toLowerCase().split(':')[0]
  if (!host) return null
  if (/^deploy-preview-\d+--/.test(host)) return 'deploy-preview'
  const branchLabel = /^([a-z0-9-]+)--[a-z0-9-]+\.netlify\.app$/.exec(host)?.[1]
  // `<24-hex-id>--site.netlify.app` is a permanent per-deploy link, which exists
  // for production deploys too: we can't tell which deploy it is, so treat it as production.
  if (branchLabel) return /^[0-9a-f]{20,}$/.test(branchLabel) ? 'production' : 'branch-deploy'
  if (/^[a-z0-9-]+\.netlify\.app$/.test(host)) return 'production'
  if (host === 'ourhometownstudio.com' || host.endsWith('.ourhometownstudio.com')) return 'production'
  if (host === 'homegrowncraftstudio.com' || host.endsWith('.homegrowncraftstudio.com')) return 'production'
  return null
}

function hostOf(request: Request): string | undefined {
  try {
    return new URL(request.url).host
  } catch {
    return undefined
  }
}

// The last context a request identified, per function instance. Request-less
// callers (the record stores) fall back to it, so a store never disagrees with
// the bypass that just wrote through it. Never holds 'unknown'.
let remembered: DeployContext | null = null
let lastLogged: DeployContext | null = null

/** Resolve, remembering what a request told us. Exported so the cache can be tested. */
export function resolveRemembering(input: Parameters<typeof resolveDeployContext>[0]): DeployContext {
  const { context, source } = resolveDeployContext(input)
  let result = context
  if (context !== 'unknown') {
    if (input.host !== undefined) remembered = context
  } else if (input.host === undefined && remembered) {
    result = remembered
  }
  if (result !== lastLogged) {
    lastLogged = result
    createLogger('deploy-context').info('Deploy context resolved', { context: result, source: result === context ? source : 'remembered' })
  }
  return result
}

export function _resetDeployContextForTests(): void {
  remembered = null
  lastLogged = null
}

export function deployContext(request?: Request): DeployContext {
  const metaEnv: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const netlify = (globalThis as any).Netlify?.context?.deploy?.context
  return resolveRemembering({
    dev: metaEnv.DEV === true || metaEnv.DEV === 'true',
    netlify: typeof netlify === 'string' ? netlify : undefined,
    env: typeof process !== 'undefined' ? process.env?.CONTEXT : undefined,
    host: request ? hostOf(request) : undefined,
  })
}

/** Local dev or a Netlify preview: the only places simulated data may appear. */
export function isPreviewOrDev(request?: Request): boolean {
  const c = deployContext(request)
  return c === 'dev' || c === 'deploy-preview' || c === 'branch-deploy'
}
