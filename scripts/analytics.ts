import 'dotenv/config'

/**
 * Ask PostHog anything (read-only). Needs POSTHOG_PERSONAL_API_KEY in .env
 * (PostHog → Settings → Personal API keys, read scopes).
 *
 *   npx tsx scripts/analytics.ts "SELECT event, count() FROM events WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY event ORDER BY 2 DESC"
 *   npx tsx scripts/analytics.ts --report overview [--days 7]
 *
 * Reports: overview, funnel, sources, pages, bookings, quits, problems, leads, devices, events
 * Event names: see src/lib/analytics.ts (browser) and src/lib/posthog-server.ts (booking_paid).
 */

const PROJECT = process.env.POSTHOG_PROJECT_ID || '656173'
const HOST = 'https://us.posthog.com'
const KEY = process.env.POSTHOG_PERSONAL_API_KEY

const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const days = Number(flag('days') ?? 7)
const since = `timestamp > now() - INTERVAL ${days} DAY`

const REPORTS: Record<string, string> = {
  overview: `SELECT
      uniq(person_id) AS visitors,
      uniq(properties.$session_id) AS visits,
      countIf(event = '$pageview') AS pageviews,
      countIf(event = 'begin_checkout') AS reached_payment,
      countIf(event = 'booking_paid') AS bookings,
      sumIf(toFloat(properties.revenue), event = 'booking_paid') AS revenue,
      countIf(event = 'generate_lead') AS call_text_email_taps
    FROM events WHERE ${since}`,
  funnel: `SELECT event, properties.item_list_name AS list, count() AS times, uniq(person_id) AS people
    FROM events WHERE ${since} AND event IN ('view_item_list','select_item','view_item','booking_choice','begin_checkout','add_payment_info','purchase','booking_paid','booking_abandoned')
    GROUP BY event, list ORDER BY people DESC`,
  sources: `SELECT coalesce(properties.$initial_utm_source, properties.$initial_referring_domain, '$direct') AS source,
      uniq(person_id) AS visitors, uniqIf(person_id, event = 'begin_checkout') AS reached_payment, uniqIf(person_id, event = 'purchase') AS booked
    FROM events WHERE ${since} GROUP BY source ORDER BY visitors DESC LIMIT 30`,
  pages: `SELECT properties.$pathname AS page, count() AS views, uniq(person_id) AS visitors,
      round(avg(toFloat(properties.$prev_pageview_max_scroll_percentage)) * 100) AS avg_scroll_pct
    FROM events WHERE ${since} AND event IN ('$pageview', '$pageleave') GROUP BY page ORDER BY views DESC LIMIT 40`,
  bookings: `SELECT timestamp, properties.booking_kind AS kind, properties.item_names AS what, properties.revenue AS revenue,
      properties.guests AS guests, properties.seats AS seats, properties.first_source AS first_source, properties.last_source AS last_source,
      properties.visits_before_booking AS visits, properties.days_ahead AS days_ahead
    FROM events WHERE ${since} AND event = 'booking_paid' ORDER BY timestamp DESC`,
  quits: `SELECT properties.booking_kind AS kind, properties.last_step AS step, count() AS times
    FROM events WHERE ${since} AND event = 'booking_abandoned' GROUP BY kind, step ORDER BY times DESC`,
  problems: `SELECT event, properties.booking_kind AS kind, properties.problem AS problem, properties.$exception_message AS error, count() AS times
    FROM events WHERE ${since} AND event IN ('booking_problem', '$exception') GROUP BY event, kind, problem, error ORDER BY times DESC LIMIT 40`,
  leads: `SELECT event, properties.method AS method, properties.label AS label, properties.where AS where_on_site, count() AS taps
    FROM events WHERE ${since} AND event IN ('contact_click', 'cta_click', 'notify_signup', 'share') GROUP BY event, method, label, where_on_site ORDER BY taps DESC LIMIT 50`,
  devices: `SELECT properties.$device_type AS device, properties.$os AS os, properties.$browser AS browser, properties.$geoip_city_name AS city, uniq(person_id) AS visitors
    FROM events WHERE ${since} AND event = '$pageview' GROUP BY device, os, browser, city ORDER BY visitors DESC LIMIT 40`,
  events: `SELECT event, count() AS times, uniq(person_id) AS people FROM events WHERE ${since} GROUP BY event ORDER BY times DESC`,
}

async function main() {
  if (!KEY) { console.error('POSTHOG_PERSONAL_API_KEY is not in .env'); process.exit(1) }
  const report = flag('report')
  const query = report ? REPORTS[report] : argv.find((a) => !a.startsWith('--') && a !== flag('days'))
  if (!query) { console.error(`Give a HogQL query or --report ${Object.keys(REPORTS).join('|')}`); process.exit(1) }
  const res = await fetch(`${HOST}/api/projects/${PROJECT}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  })
  const json: any = await res.json()
  if (!res.ok) { console.error(res.status, json?.detail ?? json); process.exit(1) }
  const cols: string[] = json.columns ?? []
  const rows: unknown[][] = json.results ?? []
  console.log(cols.join('\t'))
  for (const r of rows) console.log(r.map((v) => (v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))).join('\t'))
  console.error(`(${rows.length} rows${report ? `, last ${days} days` : ''})`)
}

main().catch((e) => { console.error(e); process.exit(1) })
