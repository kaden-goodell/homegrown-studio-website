import { SquareClient, SquareEnvironment } from 'square'
import type { SquareConfig } from '../../config/site.config'

export function createSquareClient(config: SquareConfig): SquareClient {
  const environment = config.environment === 'production'
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox

  return new SquareClient({
    token: config.accessToken,
    environment,
  })
}
