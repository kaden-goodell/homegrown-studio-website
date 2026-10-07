import { describe, it, expect, beforeEach } from 'vitest'
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

import { contextFromHost, resolveRemembering, _resetDeployContextForTests } from '@lib/deploy-context'

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

describe('host edge cases', () => {
  it('treats a per-deploy permalink as production (which deploy is unknown)', () => {
    expect(contextFromHost('65f1a2b3c4d5e6f708192a3b--iridescent-croissant-494fc3.netlify.app')).toBe('production')
  })
  it('still sees branch and preview hosts, any case', () => {
    expect(contextFromHost('dev--site.netlify.app')).toBe('branch-deploy')
    expect(contextFromHost('Deploy-Preview-12--Site.Netlify.App')).toBe('deploy-preview')
    expect(contextFromHost('DEV--SITE.NETLIFY.APP')).toBe('branch-deploy')
  })
  it('knows the old domain', () => {
    expect(contextFromHost('homegrowncraftstudio.com')).toBe('production')
    expect(contextFromHost('www.homegrowncraftstudio.com')).toBe('production')
  })
})

describe('remembering what a request said', () => {
  beforeEach(() => _resetDeployContextForTests())

  it('lets a later request-less call reuse a known context, and never caches unknown', () => {
    expect(resolveRemembering({ dev: false })).toBe('unknown')
    expect(resolveRemembering({ dev: false, host: 'example.org' })).toBe('unknown')
    expect(resolveRemembering({ dev: false })).toBe('unknown')
    expect(resolveRemembering({ dev: false, host: 'dev--site.netlify.app' })).toBe('branch-deploy')
    expect(resolveRemembering({ dev: false })).toBe('branch-deploy')
  })
  it('lets a later request overwrite it', () => {
    resolveRemembering({ dev: false, host: 'dev--site.netlify.app' })
    resolveRemembering({ dev: false, host: 'ourhometownstudio.com' })
    expect(resolveRemembering({ dev: false })).toBe('production')
  })
})
