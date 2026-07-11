/**
 * Party-craft catalog lookup — the single place that turns Square's "Party
 * Crafts" category into the craft list both kit endpoints share.
 *
 * Extracted from api/kits/service-info.json.ts (which had duplicated it from
 * the party service-info during parallel development). service-info uses it to
 * render the menu; order.json uses it to resolve AUTHORITATIVE prices so a
 * tampered client can't name its own per-head price.
 */
import { createSquareClient } from '@providers/square/client'
import { siteConfig } from '@config/site.config'
import { partyConfig } from '@config/party.config'
import type { SquareConfig } from '@config/site.config'

export interface CatalogCraft {
  id: string
  name: string
  /** Cheapest positive variation price — what the customer is charged per head. */
  perHeadCents: number
  perHeadMaxCents: number
  description: string
  imageUrl: string | null
  personalized: boolean
  popular: boolean
}

export async function fetchPartyCrafts(): Promise<CatalogCraft[]> {
  const client = createSquareClient(siteConfig.providers.catalog.config as SquareConfig)

  const craftItems: any[] = []
  const imageIds = new Set<string>()
  for await (const obj of await client.catalog.list({ types: 'ITEM' })) {
    const o = obj as any
    const inCat = (o.itemData?.categories ?? []).some(
      (c: any) => c.id === partyConfig.square.partyCraftCategoryId
    )
    if (!inCat) continue
    craftItems.push(o)
    for (const id of o.itemData?.imageIds ?? []) imageIds.add(id)
  }

  const imageUrlById: Record<string, string> = {}
  if (imageIds.size > 0) {
    const imgResp = await client.catalog.batchGet({ objectIds: [...imageIds] })
    for (const img of ((imgResp as any).objects ?? [])) {
      imageUrlById[img.id] = img.imageData?.url ?? ''
    }
  }

  return craftItems
    .map((o) => {
      const prices = (o.itemData?.variations ?? [])
        .map((vr: any) => Number(vr.itemVariationData?.priceMoney?.amount ?? 0n))
        .filter((n: number) => n > 0)
      const minCents = prices.length ? Math.min(...prices) : 0
      const maxCents = prices.length ? Math.max(...prices) : 0
      const firstImage = (o.itemData?.imageIds ?? [])[0]
      const personalized = (o.itemData?.categories ?? []).some(
        (c: any) => c.id === partyConfig.square.personalizedCategoryId
      )
      const popular = (o.itemData?.categories ?? []).some(
        (c: any) => c.id === partyConfig.square.popularCategoryId
      )
      return {
        id: o.id as string,
        name: (o.itemData?.name ?? '') as string,
        perHeadCents: minCents,
        perHeadMaxCents: maxCents,
        description: (o.itemData?.descriptionPlaintext ?? o.itemData?.description ?? '') as string,
        imageUrl: firstImage ? imageUrlById[firstImage] ?? null : null,
        personalized,
        popular,
      }
    })
    .sort((a, b) => Number(!!b.popular) - Number(!!a.popular) || a.name.localeCompare(b.name))
}
