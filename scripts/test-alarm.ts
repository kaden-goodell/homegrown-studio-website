/**
 * Sends ONE test alarm to Kaden, the way a real one goes: a Pushover emergency
 * (rings through silent) when Pushover is set up, else a text from the studio
 * number. Prints only "sent" or "not sent" — never a key.
 *
 * The production keys are passed in by the caller, straight from Netlify:
 *
 *   PUSHOVER_APP_TOKEN="$(npx netlify env:get PUSHOVER_APP_TOKEN --context production)" \
 *   PUSHOVER_USER_KEY="$(npx netlify env:get PUSHOVER_USER_KEY --context production)" \
 *   QUO_API_KEY="$(npx netlify env:get QUO_API_KEY --context production)" \
 *   QUO_FROM_NUMBER="$(npx netlify env:get QUO_FROM_NUMBER --context production)" \
 *   npx tsx scripts/test-alarm.ts
 *
 * Nothing is stored: it is not an incident, so there are no repeats and no
 * "Got it" link to tap. Opening it in Pushover stops Pushover's own repeats.
 */
import { sendPushover, pushoverConfigured } from '../src/lib/pushover'
import { quoConfigured, sendQuoText } from '../src/lib/quo'
import { ALERT_PHONE_DEFAULT } from '../src/config/alerts'

const message = 'TEST ALARM: this is what a real one looks like. Nothing is broken. Open it to stop the ringing.'

async function main() {
  if (pushoverConfigured()) {
    const r = await sendPushover({ title: 'TEST ALARM', message, priority: 2 })
    console.log(r.sent ? 'sent (Pushover emergency)' : 'not sent (Pushover refused it; check the two keys)')
    if (r.sent) return
  } else {
    console.log('Pushover is not set up (PUSHOVER_APP_TOKEN / PUSHOVER_USER_KEY); trying a text')
  }
  if (!quoConfigured()) return console.log('not sent (no Quo keys either)')
  try {
    await sendQuoText({ to: process.env.ALERT_PHONE || ALERT_PHONE_DEFAULT, content: message })
    console.log('sent (text)')
  } catch {
    console.log('not sent (the text failed)')
  }
}

main()
