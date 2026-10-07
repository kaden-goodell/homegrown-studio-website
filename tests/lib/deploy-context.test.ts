import { describe, it, expect } from 'vitest'
import { resolveDeployContext } from '@lib/deploy-context'

describe('resolveDeployContext', () => {
  it('is dev under the dev server, whatever else is set', () => {
    expect(resolveDeployContext({ dev: true, netlify: 'production', env: 'production' })).toEqual({ context: 'dev', source: 'import.meta.env.DEV' })
  })
  it('reads the Netlify runtime global', () => {
    expect(resolveDeployContext({ dev: false, netlify: 'branch-deploy' })).toEqual({ context: 'branch-deploy', source: 'Netlify.context' })
    expect(resolveDeployContext({ dev: false, netlify: 'production' }).context).toBe('production')
  })
  it('prefers the runtime global over the build-time env var', () => {
    expect(resolveDeployContext({ dev: false, netlify: 'production', env: 'deploy-preview' }).context).toBe('production')
  })
  it('falls back to process.env.CONTEXT', () => {
    expect(resolveDeployContext({ dev: false, env: 'deploy-preview' })).toEqual({ context: 'deploy-preview', source: 'process.env.CONTEXT' })
  })
  it('is unknown when nothing identifies the deployment, or the value is unrecognised', () => {
    expect(resolveDeployContext({ dev: false })).toEqual({ context: 'unknown', source: 'none' })
    expect(resolveDeployContext({ dev: false, netlify: 'dev', env: 'whatever' }).context).toBe('unknown')
  })
})

import { contextFromHost } from '@lib/deploy-context'

describe('host hint', () => {
  it('maps Netlify and own hosts', () => {
    expect(contextFromHost('deploy-preview-12--iridescent-croissant-494fc3.netlify.app')).toBe('deploy-preview')
    expect(contextFromHost('dev--iridescent-croissant-494fc3.netlify.app')).toBe('branch-deploy')
    expect(contextFromHost('iridescent-croissant-494fc3.netlify.app')).toBe('production')
    expect(contextFromHost('ourhometownstudio.com')).toBe('production')
    expect(contextFromHost('www.ourhometownstudio.com:443')).toBe('production')
    expect(contextFromHost('example.org')).toBeNull()
    expect(contextFromHost('localhost:4321')).toBeNull()
    expect(contextFromHost(undefined)).toBeNull()
  })

  it('is the last resort, after every other source', () => {
    const host = 'dev--iridescent-croissant-494fc3.netlify.app'
    expect(resolveDeployContext({ dev: false, host })).toEqual({ context: 'branch-deploy', source: 'request host' })
    expect(resolveDeployContext({ dev: false, netlify: 'production', host }).context).toBe('production')
    expect(resolveDeployContext({ dev: false, env: 'deploy-preview', host }).context).toBe('deploy-preview')
    expect(resolveDeployContext({ dev: false, host: 'example.org' }).context).toBe('unknown')
  })
})
