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
  if (/^[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/.test(host)) return 'branch-deploy'
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

let logged = false

export function deployContext(request?: Request): DeployContext {
  const metaEnv: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const netlify = (globalThis as any).Netlify?.context?.deploy?.context
  const { context, source } = resolveDeployContext({
    dev: metaEnv.DEV === true || metaEnv.DEV === 'true',
    netlify: typeof netlify === 'string' ? netlify : undefined,
    env: typeof process !== 'undefined' ? process.env?.CONTEXT : undefined,
    host: request ? hostOf(request) : undefined,
  })
  if (!logged) {
    logged = true
    createLogger('deploy-context').info('Deploy context resolved', { context, source })
  }
  return context
}

/** Local dev or a Netlify preview: the only places simulated data may appear. */
export function isPreviewOrDev(request?: Request): boolean {
  const c = deployContext(request)
  return c === 'dev' || c === 'deploy-preview' || c === 'branch-deploy'
}
