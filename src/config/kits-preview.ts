// No imports: site.config.ts is read by the browser bundle too.

/**
 * Take-home kits stay off on the live site (Kaden: "don't launch the take
 * home"). A branch preview can show them for clicking through when ALL of
 * these hold: KITS_ENABLED_PREVIEW=on, the deploy has its own STORE_NAMESPACE
 * (its own records, never the live ones) and it runs on Square's sandbox.
 * Production has neither a namespace nor the sandbox, so this can never turn
 * kits on there; a CONTEXT of "production" refuses it too. Pure, so it is
 * tested (tests/config/kits-preview.test.ts).
 */
export function kitsEnabledFor(
  base: boolean,
  env: { KITS_ENABLED_PREVIEW?: string; STORE_NAMESPACE?: string; SQUARE_ENVIRONMENT?: string; CONTEXT?: string } | undefined,
): boolean {
  if (base) return true
  if (!env) return false
  if ((env.KITS_ENABLED_PREVIEW ?? '').trim().toLowerCase() !== 'on') return false
  if (!(env.STORE_NAMESPACE ?? '').trim()) return false
  if ((env.SQUARE_ENVIRONMENT ?? '').trim() !== 'sandbox') return false
  if ((env.CONTEXT ?? '').trim() === 'production') return false
  return true
}

/** The server's env (process.env), or undefined in the browser. */
export function serverEnv(): Record<string, string | undefined> | undefined {
  return typeof process !== 'undefined' && process?.env ? process.env : undefined
}
