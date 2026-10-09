import 'dotenv/config'

/**
 * Builds (or tops up) the "Hometown — Bookings & Traffic" dashboard in PostHog.
 * Safe to re-run: an insight that already exists by name gets this file's
 * description and query (edits here win).
 *
 *   npx tsx scripts/posthog-dashboards.ts
 */

const PROJECT = process.env.POSTHOG_PROJECT_ID || '656173'
const API = `https://us.posthog.com/api/projects/${PROJECT}`
const KEY = process.env.POSTHOG_PERSONAL_API_KEY
const DASHBOARD = 'Hometown — Bookings & Traffic'

const ev = (event: string, props: Record<string, string> = {}, extra: Record<string, unknown> = {}) => ({
  kind: 'EventsNode', event, name: event,
  properties: Object.entries(props).map(([key, value]) => ({ key, value, operator: 'exact', type: 'event' })),
  ...extra,
})
const funnel = (series: unknown[]) => ({
  kind: 'InsightVizNode',
  source: { kind: 'FunnelsQuery', series, dateRange: { date_from: '-30d' }, funnelsFilter: { funnelWindowInterval: 14, funnelWindowIntervalUnit: 'day', funnelVizType: 'steps' } },
})
const trend = (series: unknown[], breakdown?: string, opts: Record<string, unknown> = {}) => ({
  kind: 'InsightVizNode',
  source: {
    kind: 'TrendsQuery', series, interval: 'day', dateRange: { date_from: '-30d' },
    ...(breakdown ? { breakdownFilter: { breakdown, breakdown_type: 'event' } } : {}),
    ...opts,
  },
})
const table = { trendsFilter: { display: 'ActionsBarValue' } }

const INSIGHTS: { name: string; description: string; query: unknown }[] = [
  { name: 'Revenue booked online (by kind)', description: 'booking_paid from the server — the source of truth. Party = $300 room fee (crafts paid at the studio).',
    query: trend([ev('booking_paid', {}, { math: 'sum', math_property: 'revenue' })], 'booking_kind', { interval: 'week' }) },
  { name: 'Bookings by first source', description: 'Where each booker FIRST came from (utm / ad / referrer / direct).',
    query: trend([ev('booking_paid')], 'first_source', table) },
  { name: 'Party funnel: gallery → booked', description: 'Saw the craft gallery → picked a craft → reached payment → entered payment → paid.',
    query: funnel([ev('view_item_list', { item_list_name: 'party_crafts' }), ev('select_item', { item_list_name: 'party_crafts' }), ev('begin_checkout', { booking_kind: 'party' }), ev('add_payment_info', { booking_kind: 'party' }), ev('payment_completed', { kind: 'party' })]) },
  { name: 'Workshop funnel: list → booked', description: 'Saw the class list → opened a class → reached payment → entered payment → paid.',
    query: funnel([ev('view_item_list', { item_list_name: 'workshops' }), ev('select_item', { item_list_name: 'workshops' }), ev('begin_checkout', { booking_kind: 'workshop' }), ev('add_payment_info', { booking_kind: 'workshop' }), ev('payment_completed', { kind: 'workshop' })]) },
  { name: 'Visitors by referring site', description: 'Unique visitors per day by where they came from.',
    query: trend([ev('$pageview', {}, { math: 'dau' })], '$referring_domain') },
  { name: 'Visitors by campaign (utm_source)', description: 'Tagged links: flyers, ads, emails, party invites, texts.',
    query: trend([ev('$pageview', {}, { math: 'dau' })], 'utm_source', table) },
  { name: 'Top pages', description: 'Pageviews by page.',
    query: trend([ev('$pageview')], '$pathname', table) },
  { name: 'Where people quit a booking', description: 'Closed the booking popup without paying, by the step they were on.',
    query: trend([ev('booking_abandoned')], 'last_step', table) },
  { name: 'Booking problems', description: 'Things that went wrong for people trying to book.',
    query: trend([ev('booking_problem')], 'problem', table) },
  { name: 'Calls, texts, emails, directions', description: 'Lead taps by method.',
    query: trend([ev('contact_click')], 'method', table) },
  { name: 'Which crafts get picked', description: 'Party crafts tapped in the gallery (interest, before booking).',
    query: trend([ev('select_item', { item_list_name: 'party_crafts' })], 'item_name', table) },
  { name: 'Sign-ups (tell me when…)', description: 'Email sign-ups saved by the server, by what they asked about.',
    query: trend([ev('signup_saved')], 'interest_kind', table) },
  { name: 'Book-button taps by place', description: 'Which buttons and page sections send people into booking.',
    query: trend([ev('cta_click')], 'where', table) },
  { name: 'Kit funnel: list → ordered', description: 'Saw kit crafts → picked one → reached payment → entered payment → paid (kits are hidden until launch).',
    query: funnel([ev('view_item_list', { item_list_name: 'kit_crafts' }), ev('select_item', { item_list_name: 'kit_crafts' }), ev('begin_checkout', { booking_kind: 'kit' }), ev('add_payment_info', { booking_kind: 'kit' }), ev('payment_completed', { kind: 'kit' })]) },
  { name: 'Calendar: what people click', description: 'Events tapped on /calendar, by kind.',
    query: trend([ev('calendar_event_click')], 'event_kind', table) },
  { name: 'Waitlist demand (sold out / coming soon)', description: '"Tell me" opened on classes that are full or not open yet, by class.',
    query: trend([ev('waitlist_opened')], 'item_name', table) },
  { name: 'Agreements signed', description: 'Server count of signed agreements, by event kind.',
    query: trend([ev('agreement_signed')], 'event_kind', table) },
  { name: 'Shares and invites', description: 'Shares by what was shared (party invites are the word-of-mouth engine).',
    query: trend([ev('share')], 'content_type', table) },
  { name: 'FAQ questions opened', description: 'Which questions people open on the party page — copy to answer up front.',
    query: trend([ev('faq_open')], 'question', table) },
  { name: 'All Square revenue by week (online + in studio)', description: 'Every completed Square payment minus refunds — includes Craft Café, party crafts paid at the studio and the register. From the Square data sync.',
    query: { kind: 'DataVisualizationNode', source: { kind: 'HogQLQuery', query: `SELECT toStartOfWeek(parseDateTimeBestEffort(toString(created_at))) AS week,
        round(sum(ifNull(toFloat(JSONExtractInt(toString(total_money), 'amount')), 0) - ifNull(toFloat(JSONExtractInt(toString(refunded_money), 'amount')), 0)) / 100, 2) AS net_revenue,
        count() AS payments
      FROM square_payments WHERE status = 'COMPLETED' GROUP BY week ORDER BY week` } } },
  { name: 'Site errors', description: 'Crashes and errors visitors hit.',
    query: trend([ev('$exception')], '$exception_message', table) },
]

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)
  return json
}

async function main() {
  if (!KEY) { console.error('POSTHOG_PERSONAL_API_KEY is not in .env'); process.exit(1) }
  const dashes = await api('/dashboards/?limit=200')
  let dash = dashes.results.find((d: any) => d.name === DASHBOARD && !d.deleted)
  if (!dash) dash = await api('/dashboards/', { method: 'POST', body: JSON.stringify({ name: DASHBOARD, description: 'Built by scripts/posthog-dashboards.ts. Revenue + sources come from the server (booking_paid).', pinned: true }) })
  console.log(`Dashboard ${dash.id}: https://us.posthog.com/project/${PROJECT}/dashboard/${dash.id}`)

  const existing = await api(`/insights/?limit=500&saved=true`)
  for (const ins of INSIGHTS) {
    const found = existing.results.find((x: any) => x.name === ins.name && !x.deleted)
    if (found) {
      await api(`/insights/${found.id}/`, { method: 'PATCH', body: JSON.stringify({ description: ins.description, query: ins.query }) })
      console.log(`= ${ins.name}`)
      continue
    }
    await api('/insights/', { method: 'POST', body: JSON.stringify({ name: ins.name, description: ins.description, query: ins.query, dashboards: [dash.id], saved: true }) })
    console.log(`+ ${ins.name}`)
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
