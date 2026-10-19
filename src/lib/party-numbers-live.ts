/**
 * Browser side of /api/party/price-facts.json: the prerendered home and
 * policies pages ship the config's party numbers, then swap in the ones from
 * the owners' Parties setup. Until an owner saves, the answer is the config's,
 * so nothing changes on screen. A failed request leaves the page as it was.
 *
 * Marks it fills:
 *   [data-party-from]                      "Whole studio · from $300"
 *   [data-policy-text="<section>:intro"]   a policy section's intro
 *   [data-policy-text="<section>:<i>"]     rule i's body
 * Client-safe: DOM + client-safe config only.
 */
import type { PartyCopyFacts } from '@config/party-content'
import { POLICY_ANCHORS, policySectionsFor } from '@config/policy-content'
import { formatMoney } from '@lib/money'

export interface PartyNumbersPayload {
  copy: PartyCopyFacts
  from: { name: string; priceCents: number }
}

const isCents = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

export function applyPartyNumbers(doc: Document, data: PartyNumbersPayload): void {
  const from = data?.from
  if (from && typeof from.name === 'string' && isCents(from.priceCents)) {
    for (const el of doc.querySelectorAll('[data-party-from]')) setText(el, `${from.name} · from ${formatMoney(from.priceCents)}`)
  }
  const copy = data?.copy
  if (copy && isCents(copy.feeCents) && Number.isInteger(copy.minGuests)) {
    const party = policySectionsFor({ feeCents: copy.feeCents, minGuests: copy.minGuests }).find((s) => s.id === POLICY_ANCHORS.parties)
    if (!party) return
    for (const el of doc.querySelectorAll<HTMLElement>(`[data-policy-text^="${party.id}:"]`)) {
      const key = el.dataset.policyText!.slice(party.id.length + 1)
      const text = key === 'intro' ? party.intro : party.rules[Number(key)]?.body
      if (typeof text === 'string') setText(el, text)
    }
  }
}

export async function loadPartyNumbers(doc: Document = document): Promise<void> {
  if (!doc.querySelector('[data-party-from], [data-policy-text]')) return
  try {
    const res = await fetch('/api/party/price-facts.json')
    if (!res.ok) return
    const json = await res.json()
    if (json?.data) applyPartyNumbers(doc, json.data as PartyNumbersPayload)
  } catch {
    // The page keeps the numbers it was built with.
  }
}
