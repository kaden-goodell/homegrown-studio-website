/**
 * What saving the studio settings touches beyond the settings themselves:
 *   - what is already booked on newly closed days (shown to the owners; it
 *     stays booked, nothing is cancelled or refunded)
 *   - how to reach the Square café item (cafe-windows.ts does the write)
 * Server only.
 */
import { siteConfig, type SquareConfig } from '@config/site.config'
import { partyConfig } from '@config/party.config'
import { createSquareClient } from '@providers/square/client'
import { onSandbox } from '@lib/parties/legacy-square'
import { localToUtcISO } from '@lib/party-slots'
import { busyBetween } from '@lib/classes/studio-schedule'
import { addDays, type CafeCatalogClient } from '@lib/cafe-windows'
import type { StoredClosure } from '@lib/studio-settings'

export interface BookedOnClosure {
  closureId: string
  name: string
  from: string
  to: string
  items: { kind: 'class' | 'legacy-class' | 'party'; id: string; label: string; startIso: string; endIso: string }[]
}

/** Classes and parties already on these closed days. `failed` when they couldn't all be read. */
export async function settingsBooked(closures: StoredClosure[]): Promise<{ list: BookedOnClosure[]; failed: boolean }> {
  const list: BookedOnClosure[] = []
  let failed = false
  for (const c of closures) {
    try {
      const busy = await busyBetween(localToUtcISO(c.from, '00:00'), localToUtcISO(addDays(c.to, 1), '00:00'))
      const items = busy
        .filter((b): b is typeof b & { kind: 'class' | 'legacy-class' | 'party' } => b.kind === 'class' || b.kind === 'legacy-class' || b.kind === 'party')
        .map((b) => ({ kind: b.kind, id: b.id, label: b.label, startIso: b.startIso, endIso: b.endIso }))
      if (items.length) list.push({ closureId: c.id, name: c.name, from: c.from, to: c.to, items })
    } catch {
      failed = true
    }
  }
  return { list, failed }
}

/** The live Square client and café item for rewriteCafeWindows. */
export function cafeSquareDeps(): { client: CafeCatalogClient; itemId: string; sandbox: boolean } {
  return {
    client: createSquareClient(siteConfig.providers.catalog.config as SquareConfig) as unknown as CafeCatalogClient,
    itemId: partyConfig.square.openStudioItemId,
    sandbox: onSandbox(),
  }
}
