/**
 * When the studio is shut and when Craft Café runs: the closed days and the
 * café hours, as one value the date rules take. Owners edit both on /admin;
 * the server loads them (src/lib/studio-settings.ts → getStudioDays()) and
 * hands them to these pure rules, and pages in the browser get them in their
 * API payload. Until an owner first saves, it is exactly the config
 * (CONFIG_STUDIO_DAYS), so the site behaves as it always has.
 *
 * Client-safe: no env, no server imports.
 */
import { closures, type Closure } from './closures'
import { CONFIG_CAFE_HOURS, type CafeHours } from './hours'

export interface StudioDays {
  closures: Closure[]
  cafe: CafeHours
}

export const CONFIG_STUDIO_DAYS: StudioDays = { closures, cafe: CONFIG_CAFE_HOURS }
