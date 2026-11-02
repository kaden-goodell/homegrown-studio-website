import { SquareClient, SquareEnvironment } from 'square'
import type { SquareConfig } from '../../config/site.config'
import { noteFailure, noteOk } from '../../lib/outbound-health'

/**
 * Every Square SDK call goes through this fetch, so Home can warn when Square
 * refuses the site's key (401/403, G2). Anything else Square answers means
 * the key works. The global fetch is looked up per call (tests replace it).
 */
const watchedFetch: typeof fetch = async (input, init) => {
  const res = await globalThis.fetch(input, init)
  if (res.status === 401 || res.status === 403) await noteFailure('square', 'auth')
  else await noteOk('square')
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
