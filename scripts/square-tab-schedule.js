// scripts/square-tab-schedule.js
/**
 * Create or move a Square class from the browser, with the party guard first.
 * HARD RULE: a class is never put over a booked party, and nothing here
 * touches a booking.
 *
 * Two tabs, because the studio's staff cookie is SameSite=Lax and never rides
 * on a request made from app.squareup.com:
 *
 *   1. In a tab on the studio site, signed in at /staff, paste this file, then
 *        const clearance = await HometownSchedule.checkStudio({ start: '2026-10-18T18:00:00.000Z', minutes: 120 })
 *      It asks /api/staff/conflicts.json (the one place the rule lives).
 *   2. In the signed-in app.squareup.com tab, paste this file, then
 *        await HometownSchedule.scheduleInSquare({ clearance, body })                                   // create
 *        await HometownSchedule.scheduleInSquare({ clearance, body, method: 'PUT', scheduleId: 'clssch_…' }) // move
 *      `body` is { class_schedule: { … } } as built in scripts/create-class.ts
 *      (for a move: GET /appointments/api/class-schedules/<id>, change start_at).
 *      It refuses unless the clearance is ok, under 10 minutes old, and for the
 *      same start_at and duration_minutes.
 *
 * The clearance is a convention guard for the person pasting the snippet, not
 * a cryptographic one, and it is single-use: it is marked used after one
 * successful Square call. A move first reads the class and refuses if it has
 * any bookings. After a create it prints the set-event.ts line that saves the
 * class's capacity (Square's buyer API doesn't report it).
 *
 * Claude runs both through the Chrome javascript tool. Nothing runs on its own.
 */
;(function (root) {
  var MAX_AGE_MS = 10 * 60 * 1000
  var SCHEDULES = '/appointments/api/class-schedules'

  async function checkStudio(opts) {
    var origin = opts.origin || root.location.origin
    var url =
      origin +
      '/api/staff/conflicts.json?kind=workshop&start=' +
      encodeURIComponent(opts.start) +
      '&minutes=' +
      encodeURIComponent(String(opts.minutes))
    var base = { start: opts.start, minutes: opts.minutes, checkedAt: Date.now() }
    var res
    try {
      res = await root.fetch(url, { credentials: 'same-origin', cache: 'no-store' })
    } catch (err) {
      return Object.assign({ ok: false, message: 'Could not reach the studio site. Not scheduling.' }, base)
    }
    var json = await res.json().catch(function () {
      return null
    })
    if (!res.ok || !json || !json.data) {
      return Object.assign({ ok: false, message: (json && json.error) || 'The party check failed (' + res.status + '). Not scheduling.' }, base)
    }
    return Object.assign({ ok: json.data.ok === true, message: String(json.data.message || '') }, base)
  }

  function refuse(message) {
    return { done: false, message: message }
  }

  async function scheduleInSquare(opts) {
    var c = opts.clearance
    if (!c || c.ok !== true) return refuse((c && c.message) || 'Run checkStudio in the studio tab first.')
    if (c.used === true) return refuse('That party check was already used. Run it again.')
    var age = Date.now() - Number(c.checkedAt)
    if (!(age >= 0 && age <= MAX_AGE_MS)) return refuse('That party check is missing, from the future, or more than 10 minutes old. Run it again.')
    var sendBody = JSON.parse(JSON.stringify(opts.body || {}))
    var cs = sendBody.class_schedule
    if (!cs || Date.parse(cs.start_at) !== Date.parse(c.start) || Number(cs.duration_minutes) !== Number(c.minutes)) {
      return refuse('The party check was for a different start or length. Run it again for this class.')
    }
    var method = opts.method === 'PUT' ? 'PUT' : 'POST'
    if (method === 'PUT' && !opts.scheduleId) return refuse('Moving a class needs its scheduleId (clssch_…).')
    // Square answers 404 NOT_FOUND class_schedule.resource_id when it is left empty.
    if (cs.resource_id === '') delete cs.resource_id
    var csrf = (/(?:^|; )_js_csrf=([^;]+)/.exec(root.document.cookie) || [])[1]
    if (!csrf) return refuse('No _js_csrf cookie: sign in to app.squareup.com in this tab first.')
    var url = method === 'PUT' ? SCHEDULES + '/' + encodeURIComponent(opts.scheduleId) : SCHEDULES
    var headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf-token': csrf,
      'x-requested-with': 'XMLHttpRequest',
    }
    if (method === 'PUT') {
      // Never move a class that has bookings: those are paying customers' plans.
      var cur
      try {
        cur = await root.fetch(url, { method: 'GET', credentials: 'include', headers: headers })
      } catch (err) {
        return refuse('Couldn\u2019t read the class \u2014 not moving it.')
      }
      var curJson = cur.ok ? await cur.json().catch(function () { return null }) : null
      if (!curJson || !curJson.class_schedule) return refuse('Couldn\u2019t read the class \u2014 not moving it.')
      // A missing or odd field is not "no bookings": fail closed.
      var bookings = curJson.class_schedule.class_bookings
      if (!Array.isArray(bookings)) return refuse('Couldn\u2019t read this class\u2019s bookings \u2014 not moving it.')
      var n = bookings.length
      if (n > 0) {
        return refuse('This class has ' + n + ' booking' + (n === 1 ? '' : 's') + '. Moving it changes paying customers\u2019 plans \u2014 Kaden does that himself in Square. Not moving it.')
      }
    }
    var res = await root.fetch(url, {
      method: method,
      credentials: 'include',
      headers: headers,
      body: JSON.stringify(sendBody),
    })
    var text = await res.text()
    if (!res.ok) return { done: false, status: res.status, message: 'Square said ' + res.status + ': ' + text.slice(0, 300) }
    c.used = true
    var id = ''
    try {
      id = (JSON.parse(text).class_schedule || {}).id || ''
    } catch (e) {}
    if (method === 'PUT') return { done: true, status: res.status, scheduleId: id || opts.scheduleId || '', message: 'Class moved.' }
    // Square's buyer API never reports capacity, and this tab can't reach the
    // studio's store, so say how to save it in the class's settings.
    var reminder = 'Now run: npx tsx scripts/set-event.ts --workshop ' + (id || '<clssch_id>') + ' --capacity ' + (cs.total_capacity != null ? cs.total_capacity : '<seats>')
    console.log(reminder)
    return { done: true, status: res.status, scheduleId: id, message: 'Class scheduled. ' + reminder }
  }

  root.HometownSchedule = { checkStudio: checkStudio, scheduleInSquare: scheduleInSquare }
})(typeof window !== 'undefined' ? window : globalThis)
