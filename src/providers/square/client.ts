import { SquareClient, SquareEnvironment } from 'square'
import type { SquareConfig } from '../../config/site.config'
import { noteSquareAnswer } from '../../lib/outbound-health'

/**
 * Every Square SDK call goes through this fetch, so Home can warn when Square
 * refuses the site's key (G2). Only a refused key counts (401, or a 403 that
 * says the token is unauthorized, expired or revoked); a 403 for one missing
 * permission is ignored (H1); any other answer means the key works. The
 * global fetch is looked up per call (tests replace it).
 */
const watchedFetch: typeof fetch = async (input, init) => {
  const res = await globalThis.fetch(input, init)
  let body: unknown = null
  if (res.status === 403) body = await res.clone().json().catch(() => null)
  await noteSquareAnswer(res.status, body)
  return res
}

export function createSquareClient(config: SquareConfig): SquareClient {
  const environment = config.environment === 'production'
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox

  return new SquareClient({
    token: config.accessToken,
    environment,
    fetch: watchedFetch,
  })
}
