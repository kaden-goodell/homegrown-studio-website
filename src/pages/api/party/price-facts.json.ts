import type { APIRoute } from 'astro'
import { getPartySettings } from '@lib/parties/settings-store'
import { cheapestPackageOf, partyCopyFacts } from '@config/party-content'
import { publicListHeaders } from '@lib/cache-headers'

export const prerender = false

/**
 * The few party numbers the pre-built pages quote (home "from $X", the
 * policy page's fee and craft minimum), from the owners' Parties setup or the
 * config until they save. Those pages carry the config's numbers in their
 * HTML and swap in these once loaded. Read never strict (the config stands in
 * when the store can't be read); cached at Netlify's edge for a minute.
 */
export const GET: APIRoute = async ({ request }) => {
  const settings = await getPartySettings()
  const data = { copy: partyCopyFacts(settings), from: cheapestPackageOf(settings) }
  return new Response(JSON.stringify({ data }), { status: 200, headers: publicListHeaders(request) })
}
