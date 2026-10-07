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
}): { context: DeployContext; source: 'import.meta.env.DEV' | 'Netlify.context' | 'process.env.CONTEXT' | 'none' } {
  if (input.dev) return { context: 'dev', source: 'import.meta.env.DEV' }
  const fromNetlify = KNOWN.find((c) => c === input.netlify)
  if (fromNetlify) return { context: fromNetlify, source: 'Netlify.context' }
  const fromEnv = KNOWN.find((c) => c === input.env)
  if (fromEnv) return { context: fromEnv, source: 'process.env.CONTEXT' }
  return { context: 'unknown', source: 'none' }
}

let logged = false

export function deployContext(): DeployContext {
  const metaEnv: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const netlify = (globalThis as any).Netlify?.context?.deploy?.context
  const { context, source } = resolveDeployContext({
    dev: metaEnv.DEV === true || metaEnv.DEV === 'true',
    netlify: typeof netlify === 'string' ? netlify : undefined,
    env: typeof process !== 'undefined' ? process.env?.CONTEXT : undefined,
  })
  if (!logged) {
    logged = true
    createLogger('deploy-context').info('Deploy context resolved', { context, source })
  }
  return context
}

/** Local dev or a Netlify preview: the only places simulated data may appear. */
export function isPreviewOrDev(): boolean {
  const c = deployContext()
  return c === 'dev' || c === 'deploy-preview' || c === 'branch-deploy'
}
