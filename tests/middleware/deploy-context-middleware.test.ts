import { describe, it, expect, vi } from 'vitest'

const deployContext = vi.fn((_request?: Request) => 'branch-deploy')
vi.mock('@lib/deploy-context', () => ({ deployContext: (request?: Request) => deployContext(request) }))

import { onRequest } from '../../src/middleware'

describe('middleware — deploy context is resolved from every request', () => {
  it('hands the request to deployContext before passing through', async () => {
    const request = new Request('https://dev--site.netlify.app/staff')
    const next = vi.fn(async () => new Response('ok'))
    const res = await (onRequest as any)({ request }, next)
    expect(deployContext).toHaveBeenCalledWith(request)
    expect(next).toHaveBeenCalledOnce()
    expect(await res.text()).toBe('ok')
  })
})
