/**
 * Where "something broke" texts go. Kaden only (16 Nov 2026: "I want all those
 * texts for me. not my wife."). Never the owners' Notifications list and never
 * OWNER_ALERT_NUMBERS: those can include Catherine.
 *
 * ALERT_PHONE (site setup) replaces the number without a code change.
 * Client-safe: no imports.
 */
export const ALERT_PHONE_DEFAULT = '+14029802907'

/** Repeat an urgent, unanswered text this often for the first REPEAT_FAST_TIMES repeats… */
export const REPEAT_FAST_MINUTES = 10
export const REPEAT_FAST_TIMES = 12
/** …then this often until "Got it" is tapped or it clears. */
export const REPEAT_SLOW_MINUTES = 60

/** An open booking problem with no new failures for this long closes quietly. */
export const QUIET_CLOSE_MINUTES = 120

/** Hosts whose failures text Kaden. Previews, branch deploys and localhost never do. */
export const LIVE_HOSTS = ['ourhometownstudio.com', 'www.ourhometownstudio.com']

/**
 * The robot customer runs this often (minutes; the 5-minute tick picks the
 * runs). Two failed runs in a row text Kaden. Each run is one in-site job: one
 * public-page request plus three in-process reads (payment setup, party
 * service, Square location). Estimate at 15 min: ~2,900 runs/month ≈ 4–5
 * Netlify credits, plus ~1 credit for the 5-minute repeat tick.
 */
export const WATCHDOG_EVERY_MINUTES = 15

/**
 * Where the alarm state lives. NOT 'incidents': that store holds the injury
 * reports (/staff 🚑 Incident, legal records). Never share a store with them.
 */
export const ALARM_STORE = 'booking-alarms'
