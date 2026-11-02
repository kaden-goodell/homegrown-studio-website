/**
 * Staffing end-to-end scenarios (stage 3, Task 11), scenarios 41–48 (stage 2's
 * party scenarios take 24–40). scripts/sandbox-e2e.ts appends them to the
 * list it runs; same --only, --dry-run, cleanup and summary.
 *
 * Who is who:
 *   ctx.admin  /admin, acting as Kaden (X-Admin-Who) — the only one who assigns
 *   ctx.crew   /staff signed in as "E2E Crew", the sandbox team member the
 *              seed makes (POST /api/admin/classes/seed-sandbox.json, the
 *              "Set up sandbox" button). Missing → the scenario is skipped
 *              with how to fix it.
 *   ctx.staff  /staff signed in as an owner (as for stage 1)
 *
 * Classes are "E2E <run> Staffing …", link-only, at 5 AM on a studio day in the
 * next two weeks (staffing looks near: the 14-day "no one on" line, eight
 * weeks of My shifts, 120 days of calendar link). Nobody is ever messaged:
 * every assign and unassign sends tell: false. Each scenario takes its people
 * off again, stops the calendar links it made and puts E2E Crew's times back;
 * its class is cancelled (never refunded) like every E2E class.
 *
 * Making Kaden's owner calendar link here (scenario 43) replaces any owner
 * link he had on the preview; it is stopped at the end.
 */
import {
  addDays, check, checkEqual, checkStatus, chicagoDate, PreviewClient, sayReply, SkipScenario, SlotAllocator,
  type Reply, type Scenario, type Scope,
} from './core'
import { blockedDay, makeClass, testContent, cancelClass, type Ctx } from './scenarios'

/** What the staffing scenarios need besides the stage-1 context. */
export interface StaffingCtx extends Ctx {
  /** /staff as E2E Crew (signed in on first use) */
  crew: PreviewClient
  staffPasscode: string
  /** set on first use: E2E Crew's team id, and another active person's (an owner) for the two-at-once check */
  crewIds?: { crew: string; other: string; otherName: string } | null
  /** studio days in the next two weeks, one per class */
  soonSlots?: SlotAllocator
}

const OWNER_HEADERS = { 'X-Admin-Who': 'Kaden' }
export const E2E_CREW_NAME = 'E2E'
export const NO_CREW = 'E2E Crew is not on the preview’s staff list yet. In /admin tap "Set up sandbox" (or POST /api/admin/classes/seed-sandbox.json), then run this again.'

const nameOf = (ctx: Ctx, what: string) => `E2E ${ctx.runTag} Staffing ${what}`.slice(0, 80)

/** Signs ctx.crew in as E2E Crew (once). Skips the scenario when E2E Crew isn't on the team. */
export async function crewIds(ctx: StaffingCtx): Promise<{ crew: string; other: string; otherName: string }> {
  if (ctx.crewIds) return ctx.crewIds
  if (ctx.crewIds === null) throw new SkipScenario(NO_CREW)
  const s = await ctx.crew.post('/api/staff/login.json', { passcode: ctx.staffPasscode })
  checkStatus(s, 200, 'Staff passcode (E2E Crew)')
  const team: { id: string; name: string; role: string }[] = s.body?.data?.staff ?? []
  const crew = team.find((m) => m.name === E2E_CREW_NAME || m.name.startsWith(`${E2E_CREW_NAME} `))
  const other = team.find((m) => m.role === 'owner' && m.id !== crew?.id) ?? team.find((m) => m.id !== crew?.id)
  if (!crew) { ctx.crewIds = null; throw new SkipScenario(NO_CREW) }
  check(other, 'The team has nobody but E2E Crew')
  const p = await ctx.crew.post('/api/staff/pick.json', { passcode: ctx.staffPasscode, staffId: crew.id })
  checkStatus(p, 200, 'Pick E2E Crew on the iPad')
  ctx.crewIds = { crew: crew.id, other: other.id, otherName: other.name }
  return ctx.crewIds
}

/** One link-only class at 5 AM on a studio day in the next two weeks. */
async function soonClass(ctx: StaffingCtx, scope: Scope, what: string): Promise<{ cls: any; key: string; startIso: string; endIso: string }> {
  ctx.soonSlots ??= new SlotAllocator(addDays(chicagoDate(new Date()), 2), blockedDay(ctx.settings))
  const sessions = ctx.soonSlots.sessions(1, { time: '05:00', minutes: 60 })
  const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, what) }), sessions })
  const s = cls.sessions[0]
  return { cls, key: `ses:${s.id}`, startIso: s.startIso, endIso: s.endIso }
}

/** The owner's row for one event. */
async function ownerRow(ctx: StaffingCtx, key: string, startIso: string): Promise<any> {
  const r = await ctx.admin.request('GET', `/api/admin/staffing.json?key=${encodeURIComponent(key)}&start=${encodeURIComponent(startIso)}`, { headers: OWNER_HEADERS })
  checkStatus(r, 200, 'Read the staffing row')
  return r.body.data.row
}

async function ownerPost(ctx: StaffingCtx, body: Record<string, unknown>): Promise<Reply> {
  return ctx.admin.request('POST', '/api/admin/staffing.json', { body: { tell: false, ...body }, headers: OWNER_HEADERS })
}

async function assign(ctx: StaffingCtx, scope: Scope, key: string, startIso: string, staffId: string, label: string): Promise<void> {
  const r = await ownerPost(ctx, { action: 'assign', key, staffId, startIso })
  checkStatus(r, 200, `Put ${label} on`)
  scope.cleanup.add(`take ${label} off ${key}`, async () => {
    const off = await ownerPost(ctx, { action: 'unassign', key, staffId, startIso })
    if (off.status !== 200 && off.status !== 404) throw new Error(`unassign answered ${sayReply(off)}`)
  })
}

/** The crew's own view around one time (their GET takes at most ten weeks). */
async function crewShifts(ctx: StaffingCtx, aroundIso: string): Promise<any> {
  const from = new Date(Date.parse(aroundIso) - 2 * 86_400_000).toISOString()
  const to = new Date(Date.parse(aroundIso) + 2 * 86_400_000).toISOString()
  const r = await ctx.crew.get(`/api/staff/shifts.json?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
  checkStatus(r, 200, "Read E2E Crew's shifts")
  return r.body.data
}

/** Makes E2E Crew's calendar link (cleanup stops it); returns the path to fetch. */
async function crewFeed(ctx: StaffingCtx, scope: Scope): Promise<string> {
  const r = await ctx.crew.post('/api/staff/feed.json', {})
  checkStatus(r, 200, "Make E2E Crew's calendar link")
  scope.cleanup.add("stop E2E Crew's calendar link", async () => {
    const d = await ctx.crew.request('DELETE', '/api/staff/feed.json')
    checkStatus(d, 200, "Stop E2E Crew's calendar link")
  })
  return feedPath(r.body.data.https)
}

/** /api/calendar/feed/<token>.ics from a link the site handed out (fetched on the preview host only). */
export function feedPath(https: string): string {
  const u = new URL(https)
  check(u.pathname.startsWith('/api/calendar/feed/') && u.pathname.endsWith('.ics'), `Unexpected calendar link shape: ${u.pathname.slice(0, 40)}`)
  return u.pathname
}

export interface IcsEvent { uid: string; start: string; sequence: number; status: string; summary: string }

/** The VEVENTs of a calendar file (folded lines joined), enough to check UID, start, SEQUENCE and STATUS. */
export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, '').split(/\r?\n/)
  const out: IcsEvent[] = []
  let cur: Record<string, string> | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {}
    else if (line === 'END:VEVENT' && cur) {
      out.push({ uid: cur.UID ?? '', start: cur.DTSTART ?? '', sequence: Number(cur.SEQUENCE ?? 0), status: cur.STATUS ?? '', summary: cur.SUMMARY ?? '' })
      cur = null
    } else if (cur) {
      const i = line.indexOf(':')
      if (i > 0) cur[line.slice(0, i).split(';')[0]] = line.slice(i + 1)
    }
  }
  return out
}

/** 2026-11-07T11:00:00.000Z → 20261107T110000Z (how the feed writes times). */
export const icsTime = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

async function readFeed(ctx: StaffingCtx, path: string): Promise<{ reply: Reply; events: IcsEvent[] }> {
  const reply = await ctx.pub.get(path)
  return { reply, events: reply.status === 200 ? parseIcs(reply.text) : [] }
}

const uidOf = (key: string) => `${key}@ourhometownstudio.com`

/** E2E Crew's times as they were, put back by cleanup. */
async function keepTimes(ctx: StaffingCtx, scope: Scope): Promise<any> {
  const before = (await crewShifts(ctx, new Date().toISOString())).availability
  scope.cleanup.add("put E2E Crew's times back", async () => {
    const now = (await crewShifts(ctx, new Date().toISOString())).availability
    const r = await ctx.crew.post('/api/staff/shifts.json', { action: 'availability', weekly: before.weekly, dates: before.dates, expectedUpdatedAt: now.updatedAt })
    checkStatus(r, 200, "Put E2E Crew's times back")
  })
  return before
}

export const staffingScenarios: Scenario<StaffingCtx>[] = [
  {
    id: 41,
    title: 'Crew marks when they can work',
    plan: [
      'E2E Crew saves "Saturdays: can, 9 AM to 5 PM" and "can\'t" all day on one date',
      'their GET shows exactly that; the owner signed in on /staff sees only their own times',
      'cleanup: E2E Crew\'s times put back',
    ],
    async run(ctx, scope) {
      await crewIds(ctx)
      const before = await keepTimes(ctx, scope)
      const date = addDays(chicagoDate(new Date()), 10)
      const weekly = { ...before.weekly, '6': { kind: 'can', range: { from: '09:00', to: '17:00' }, note: '' } }
      const dates = { ...before.dates, [date]: [{ kind: 'cant', range: null, note: 'E2E test' }] }
      const r = await ctx.crew.post('/api/staff/shifts.json', { action: 'availability', weekly, dates, expectedUpdatedAt: before.updatedAt })
      checkStatus(r, 200, 'Save E2E Crew\'s times')
      const mine = (await crewShifts(ctx, new Date().toISOString())).availability
      checkEqual(mine.weekly['6'], weekly['6'], 'Saturdays as saved')
      checkEqual(mine.dates[date], dates[date], 'The date as saved')
      const other = await ctx.staff.get('/api/staff/shifts.json')
      checkStatus(other, 200, "The owner's own shifts")
      check(other.body.data.me.id !== ctx.crewIds!.crew, 'The owner client is signed in as E2E Crew')
      check(!JSON.stringify(other.body.data.availability).includes('E2E test'), "Another person's GET shows E2E Crew's date note")
    },
  },
  {
    id: 42,
    title: 'Crew asks to work; crew can\'t assign',
    plan: [
      'make a class in the next two weeks; E2E Crew taps "I\'d like to work this" (with the start)',
      'the owner\'s row shows the ask; E2E Crew POSTing assign → 403 and the row is unchanged',
      'cleanup: take the ask back; cancel the class',
    ],
    async run(ctx, scope) {
      const ids = await crewIds(ctx)
      const { key, startIso } = await soonClass(ctx, scope, 'Ask')
      const ask = await ctx.crew.post('/api/staff/shifts.json', { action: 'ask', key, note: 'E2E ask', startIso })
      checkStatus(ask, 200, 'Ask to work')
      scope.cleanup.add('take the ask back', async () => { await ctx.crew.post('/api/staff/shifts.json', { action: 'unask', key, startIso }) })
      const row = await ownerRow(ctx, key, startIso)
      const me = row.people.find((p: any) => p.staffId === ids.crew)
      check(me, 'E2E Crew is not on the owner\'s row')
      checkEqual({ asked: me.asked, askNote: me.askNote, assigned: me.assigned }, { asked: true, askNote: 'E2E ask', assigned: false }, 'E2E Crew on the row')
      const forged = await ctx.crew.post('/api/staff/shifts.json', { action: 'assign', key, staffId: ids.crew, startIso })
      checkStatus(forged, 403, 'Crew assigning')
      const after = await ownerRow(ctx, key, startIso)
      checkEqual(after.entry?.assigned ?? [], row.entry?.assigned ?? [], 'Who is on after the refused assign')
    },
  },
  {
    id: 43,
    title: 'Owner assigns; My shifts and both calendar links show it',
    plan: [
      'make a class; the owner puts E2E Crew on (tell off: nobody is messaged)',
      'E2E Crew\'s My shifts lists it; their calendar link has exactly that event (UID ses:…)',
      'Kaden\'s whole-studio link has it too, with E2E Crew named',
      'cleanup: take E2E Crew off, stop both links, cancel the class',
    ],
    async run(ctx, scope) {
      const ids = await crewIds(ctx)
      const { key, startIso } = await soonClass(ctx, scope, 'Assign')
      await assign(ctx, scope, key, startIso, ids.crew, 'E2E Crew')
      const view = await crewShifts(ctx, startIso)
      check(view.mine.some((r: any) => r.event.key === key), 'My shifts does not list the class')
      const path = await crewFeed(ctx, scope)
      const { reply, events } = await readFeed(ctx, path)
      checkStatus(reply, 200, 'Read E2E Crew\'s calendar')
      const mineHere = events.filter((e) => e.uid === uidOf(key))
      checkEqual(mineHere.length, 1, 'Times the class is in the crew calendar')
      checkEqual(mineHere[0].start, icsTime(startIso), 'Start in the crew calendar')

      const o = await ctx.admin.request('POST', '/api/admin/feed.json', { body: {}, headers: OWNER_HEADERS })
      checkStatus(o, 200, "Make Kaden's whole-studio link")
      scope.cleanup.add("stop Kaden's whole-studio link", async () => {
        const d = await ctx.admin.request('DELETE', '/api/admin/feed.json', { body: {}, headers: OWNER_HEADERS })
        checkStatus(d, 200, "Stop Kaden's whole-studio link")
      })
      const owner = await readFeed(ctx, feedPath(o.body.data.https))
      checkStatus(owner.reply, 200, "Read Kaden's whole-studio calendar")
      check(owner.events.some((e) => e.uid === uidOf(key)), 'The owner calendar does not have the class')
      check(owner.reply.text.includes('E2E'), 'The owner calendar does not name E2E Crew on it')
    },
  },
  {
    id: 44,
    title: 'A moved class: same UID, new time, SEQUENCE up',
    plan: [
      'make a class, put E2E Crew on, read their calendar link',
      'move the session an hour later in /admin → the calendar shows the new start, the same UID, SEQUENCE one higher',
      'cleanup: take E2E Crew off, stop the link, cancel the class',
    ],
    async run(ctx, scope) {
      const ids = await crewIds(ctx)
      const { cls, key, startIso, endIso } = await soonClass(ctx, scope, 'Move')
      await assign(ctx, scope, key, startIso, ids.crew, 'E2E Crew')
      const path = await crewFeed(ctx, scope)
      const first = (await readFeed(ctx, path)).events.find((e) => e.uid === uidOf(key))
      check(first, 'The class is not in the crew calendar')
      const later = (iso: string) => new Date(Date.parse(iso) + 3_600_000).toISOString()
      const fresh = await ctx.admin.get(`/api/admin/classes/bookings.json?id=${encodeURIComponent(cls.id)}`)
      checkStatus(fresh, 200, 'Read the class')
      const moved = await ctx.admin.post('/api/admin/classes/classes.json', {
        action: 'update', id: cls.id, expectedUpdatedAt: fresh.body.data.class.updatedAt,
        sessions: [{ ...fresh.body.data.class.sessions[0], startIso: later(startIso), endIso: later(endIso) }],
      })
      checkStatus(moved, 200, 'Move the session an hour')
      const after = (await readFeed(ctx, path)).events.filter((e) => e.uid === uidOf(key))
      checkEqual(after.length, 1, 'Times the class is in the crew calendar after the move')
      checkEqual(after[0].start, icsTime(later(startIso)), 'New start in the crew calendar')
      checkEqual(after[0].sequence, first.sequence + 1, 'SEQUENCE after the move')
    },
  },
  {
    id: 45,
    title: 'Unassigned: owners see "no one on"; crew warnings don\'t',
    plan: [
      'make a class in the next two weeks, put E2E Crew on, then take them off',
      'the owner\'s row says nobody is on (needed 1): the daily email\'s "has no one on yet" line comes from this',
      'the /staff warnings panel (crew) has no staffing line and doesn\'t name the class',
      'cleanup: cancel the class',
    ],
    async run(ctx, scope) {
      const ids = await crewIds(ctx)
      const { cls, key, startIso } = await soonClass(ctx, scope, 'Unassign')
      await assign(ctx, scope, key, startIso, ids.crew, 'E2E Crew')
      const off = await ownerPost(ctx, { action: 'unassign', key, staffId: ids.crew, startIso })
      checkStatus(off, 200, 'Take E2E Crew off')
      const row = await ownerRow(ctx, key, startIso)
      checkEqual({ state: row.state, needed: row.needed, on: (row.entry?.assigned ?? []).length }, { state: 'none', needed: 1, on: 0 }, 'The owner row')
      const w = await ctx.crew.get('/api/staff/warnings.json')
      checkStatus(w, 200, 'The /staff warnings panel')
      const lines: any[] = w.body.data.warnings
      check(!lines.some((x) => ['unstaffed', 'assigned-cant', 'assigned-cancelled', 'staffing-unreadable'].includes(x.code)), 'The crew panel shows a staffing line')
      check(!lines.some((x) => String(x.line ?? '').includes(cls.content.name)), 'The crew panel names the class')
      scope.note('the daily email itself needs the job key, so it is checked through the owner row it reads')
    },
  },
  {
    id: 46,
    title: 'A cancelled class with crew on it',
    plan: [
      'make a class, put E2E Crew on, cancel the class in /admin',
      'the owner\'s row is cancelled with E2E Crew still on (owners are told; nothing is changed for them)',
      'E2E Crew\'s My shifts shows it cancelled; their calendar shows STATUS:CANCELLED and SEQUENCE up',
      'cleanup: take E2E Crew off, stop the link',
    ],
    async run(ctx, scope) {
      const ids = await crewIds(ctx)
      const { cls, key, startIso } = await soonClass(ctx, scope, 'Cancel')
      await assign(ctx, scope, key, startIso, ids.crew, 'E2E Crew')
      const path = await crewFeed(ctx, scope)
      const before = (await readFeed(ctx, path)).events.find((e) => e.uid === uidOf(key))
      check(before, 'The class is not in the crew calendar')
      await cancelClass(ctx, cls.id)
      const row = await ownerRow(ctx, key, startIso)
      checkEqual(row.event.status, 'cancelled', 'The owner row status')
      check((row.entry?.assigned ?? []).some((a: any) => a.staffId === ids.crew), 'E2E Crew was taken off by the cancel (nothing should change for them)')
      const view = await crewShifts(ctx, startIso)
      const mine = view.mine.find((r: any) => r.event.key === key)
      check(mine, 'My shifts dropped the cancelled class')
      checkEqual(mine.event.status, 'cancelled', 'My shifts status')
      const after = (await readFeed(ctx, path)).events.find((e) => e.uid === uidOf(key))
      check(after, 'The cancelled class left the crew calendar (it should stay, crossed out)')
      checkEqual(after.status, 'CANCELLED', 'STATUS in the crew calendar')
      check(after.sequence > before.sequence, `SEQUENCE did not go up on cancel (${before.sequence} → ${after.sequence})`)
    },
  },
  {
    id: 47,
    title: 'Calendar link: new link, stopped by an owner, garbage',
    plan: [
      'E2E Crew makes a link, then a new one: the old one → 404, the new one → 200',
      'an owner stops E2E Crew\'s link in /admin → 404',
      'a made-up link → 404 with exactly the same body',
    ],
    async run(ctx, scope) {
      const ids = await crewIds(ctx)
      const a = await crewFeed(ctx, scope)
      const b = await crewFeed(ctx, scope)
      check(a !== b, 'A new link came back the same as the old one')
      const oldR = (await readFeed(ctx, a)).reply
      checkStatus(oldR, 404, 'The old link')
      checkStatus((await readFeed(ctx, b)).reply, 200, 'The new link')
      const stop = await ctx.admin.request('DELETE', '/api/admin/feed.json', { body: { staffId: ids.crew }, headers: OWNER_HEADERS })
      checkStatus(stop, 200, "An owner stops E2E Crew's link")
      const stopped = (await readFeed(ctx, b)).reply
      checkStatus(stopped, 404, 'The stopped link')
      const garbage = (await readFeed(ctx, `/api/calendar/feed/${'x'.repeat(43)}.ics`)).reply
      checkStatus(garbage, 404, 'A made-up link')
      checkEqual([stopped.text, garbage.text], [oldR.text, oldR.text], 'The 404 bodies')
    },
  },
  {
    id: 48,
    title: 'Two owners assign at once',
    plan: [
      'make a class with 2 needed; put E2E Crew and an owner on in two requests at the same time (tell off)',
      'both are on afterwards (no lost write)',
      'cleanup: take both off, cancel the class',
    ],
    async run(ctx, scope) {
      const ids = await crewIds(ctx)
      const { key, startIso } = await soonClass(ctx, scope, 'Together')
      const needed = await ownerPost(ctx, { action: 'needed', key, needed: 2, startIso, expectedUpdatedAt: null })
      checkStatus(needed, 200, 'Set 2 needed')
      const [x, y] = await Promise.all([
        ownerPost(ctx, { action: 'assign', key, staffId: ids.crew, startIso }),
        ownerPost(ctx, { action: 'assign', key, staffId: ids.other, startIso }),
      ])
      for (const [r, who, id] of [[x, 'E2E Crew', ids.crew], [y, ids.otherName, ids.other]] as const) {
        checkStatus(r, 200, `Put ${who} on`)
        scope.cleanup.add(`take ${who} off ${key}`, async () => { await ownerPost(ctx, { action: 'unassign', key, staffId: id, startIso }) })
      }
      const row = await ownerRow(ctx, key, startIso)
      checkEqual((row.entry?.assigned ?? []).map((a: any) => a.staffId).sort(), [ids.crew, ids.other].sort(), 'Who is on')
      checkEqual(row.state, 'staffed', 'Staffed with 2 of 2')
    },
  },
]
