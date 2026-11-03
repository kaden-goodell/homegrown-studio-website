/**
 * More › Staff (stage 3 Task 10, D5). Two parts:
 *
 * Who's on: This week / Next week / Pick a week.
 *   - To check: someone on at a time they marked Can't (Call / Text), someone
 *     still on a class or party that was cancelled.
 *   - Needs someone: classes and parties still short, each opening its Staff
 *     section right here (Put on / Take off / people needed).
 *   - Who can work: everyone × the days with something on, in words (Can,
 *     Can't, Part, Outside their hours, — for not said), never colour alone.
 *   - Everything: every class and party that week with who's on.
 * People: our own staff list (PeoplePanel): add, edit, no longer working
 *   here, each person's calendar link and Stop.
 *
 * Footer: Calendar link for my phone (the owner's whole-studio link).
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import CalendarLinkSheet, { OWNER_COPY } from '@components/staff/CalendarLinkSheet'
import { adminHeaders, api } from '../classes/api'
import { addDays, dayLabel, dayStartIso, today } from '../classes/dates'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheet } from '../shell/Sheet'
import { dayAndSpan, timeSpan } from '../shell/time'
import { localDate } from '@lib/party-slots'
import {
  OWNER_FEED, markWords, needsSomeone, sheetOfHref, stateWords, useBoard,
  type BoardData, type StaffingRow, type StaffPersonRow,
} from '../staffing/api'
import { CheckWith, StaffRow } from '../staffing/StaffRow'
import { PeoplePanel } from '../staffing/PeoplePanel'

type Part = 'board' | 'people'
type Week = 'this' | 'next' | 'pick'

export function StaffSheet() {
  const { data } = useSheet()
  const toPasscode = !!data && typeof data === 'object' && (data as { passcode?: unknown }).passcode === true
  const toPeople = toPasscode || (!!data && typeof data === 'object' && (data as { part?: unknown }).part === 'people')
  const [part, setPart] = useState<Part>(toPeople ? 'people' : 'board')
  const [linkOpen, setLinkOpen] = useState(false)
  const [mine, setMine] = useState<{ has: boolean } | null>(null)
  useEffect(() => {
    let live = true
    api<{ mine: { has: boolean } | null }>(OWNER_FEED).then((r) => { if (live && r.ok) setMine(r.data?.mine ?? { has: false }) })
    return () => { live = false }
  }, [])
  return (
    <SheetFrame
      tall
      title="Staff"
      subtitle="Who’s on, who can work, calendar links"
      footer={(
        <button type="button" className="adm-btn is-ghost" onClick={() => setLinkOpen(true)}>
          {mine?.has ? 'Calendar link for my phone · on' : 'Calendar link for my phone'}
        </button>
      )}
    >
      <Seg label="Show" value={part} onChange={setPart} options={[['board', 'Who’s on'], ['people', 'People']]} />
      {part === 'board' ? <Board /> : <PeoplePanel focusPasscode={toPasscode} />}
      {linkOpen && createPortal(
        <div className="adm">
          <CalendarLinkSheet
            has={!!mine?.has}
            endpoint={OWNER_FEED}
            headers={adminHeaders()}
            copy={OWNER_COPY}
            onClose={() => setLinkOpen(false)}
            onChanged={(has) => setMine({ has })}
          />
        </div>,
        document.body,
      )}
    </SheetFrame>
  )
}

function rangeOf(week: Week, picked: string): { from: string; to: string } {
  const d = today()
  if (week === 'next') return { from: addDays(d, 7), to: addDays(d, 14) }
  if (week === 'pick') return { from: picked, to: addDays(picked, 7) }
  return { from: d, to: addDays(d, 7) }
}

function Board() {
  const [week, setWeek] = useState<Week>('this')
  const [picked, setPicked] = useState(today())
  const { from, to } = rangeOf(week, picked)
  // This week starts now, so what already ended today isn't listed as needing someone.
  const [openedAt] = useState(() => new Date().toISOString())
  const fromIso = week === 'this' ? openedAt : dayStartIso(from)
  const { data, error, retry } = useBoard(fromIso, dayStartIso(to))
  const [open, setOpen] = useState<string | null>(null)

  return (
    <section aria-label="Who’s on">
      <Seg label="Which week" value={week} onChange={setWeek} options={[['this', 'This week'], ['next', 'Next week'], ['pick', 'Pick a week']]} />
      {week === 'pick' && (
        <label className="adm-fld adm-gap-top">
          <span>Week starting</span>
          <input type="date" value={picked} onChange={(e) => { if (e.target.value) setPicked(e.target.value) }} />
        </label>
      )}
      <p className="adm-small adm-muted adm-gap-top">{`${dayLabel(from)} to ${dayLabel(addDays(to, -1))}`}</p>
      {error && <Failed message={error} onRetry={retry} />}
      {!error && !data && <Skeleton rows={4} label="Loading who’s on" />}
      {data && <BoardBody data={data} open={open} setOpen={setOpen} />}
    </section>
  )
}

function BoardBody({ data, open, setOpen }: { data: BoardData; open: string | null; setOpen: (k: string | null) => void }) {
  const now = Date.now()
  const rows = data.rows
  const checks = rows.filter((r) => Date.parse(r.event.endIso) > now && (
    (r.event.status === 'on' && r.people.some((p) => p.assigned && p.verdict === 'cant'))
    || (r.event.status !== 'on' && (r.people.some((p) => p.assigned) || r.leftTeam.length > 0))
    || (r.event.status === 'on' && r.leftTeam.length > 0)))
  const short = rows.filter((r) => needsSomeone(r, now))
  const card = (r: StaffingRow, where: string) => <EventCard key={`${where}-${r.event.key}`} row={r} contacts={data.contacts} open={open === `${where}-${r.event.key}`} onToggle={() => setOpen(open === `${where}-${r.event.key}` ? null : `${where}-${r.event.key}`)} />
  return (
    <>
      {checks.length > 0 && (
        <>
          <p className="adm-lbl">{`To check (${checks.length})`}</p>
          {checks.map((r) => card(r, 'check'))}
        </>
      )}
      <p className="adm-lbl">{`Needs someone (${short.length})`}</p>
      {short.length === 0
        ? <p className="adm-empty">{rows.length ? 'Everything has someone on.' : 'Nothing on this week.'}</p>
        : short.map((r) => card(r, 'need'))}
      <WhoCanWork rows={rows.filter((r) => r.event.status === 'on')} />
      <p className="adm-lbl">{`Everything (${rows.length})`}</p>
      {rows.length === 0 && <p className="adm-empty">No classes or parties this week.</p>}
      {rows.map((r) => card(r, 'all'))}
    </>
  )
}

/** One class day or party: what, when, who's on; opens its Staff section here. */
function EventCard({ row, contacts, open, onToggle }: { row: StaffingRow; contacts: BoardData['contacts']; open: boolean; onToggle: () => void }) {
  const sheet = useSheet()
  const target = sheetOfHref(row.event.openHref)
  const cancelled = row.event.status !== 'on'
  const cant = row.people.filter((p) => p.assigned && p.verdict === 'cant')
  return (
    <div className={`adm-evcard${needsSomeone(row) ? ' is-short' : ''}`}>
      <button type="button" className="adm-evcard-head" aria-expanded={open} onClick={onToggle}>
        <span className="adm-rm">
          <b>{row.event.title}{cancelled && <span className="adm-tag is-red">{row.event.status === 'cancelled' ? 'Cancelled' : 'Not on the schedule'}</span>}</b>
          <small>{dayAndSpan(row.event.startIso, row.event.endIso)}</small>
          <small className="adm-evcard-state">{stateWords(row)}{row.people.some((p) => p.asked && !p.assigned) ? ' · ★ someone asked' : ''}</small>
        </span>
        <span className="adm-evcard-btn" aria-hidden="true">{open ? 'Close' : 'Staff'}</span>
      </button>
      {!open && cant.map((p) => <CheckWith key={p.staffId} person={p} contacts={contacts} />)}
      {open && (
        <div className="adm-evcard-body">
          <StaffRow bare eventKey={row.event.key} startIso={row.event.startIso} initial={{ row, contacts }} />
          {target && (
            <button type="button" className="adm-quiet adm-gap-top" onClick={() => sheet.open(target, { staffKey: row.event.key })}>
              {row.event.kind === 'party' ? 'Open the party' : 'Open the class'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const CELL: Record<StaffPersonRow['verdict'], string> = { can: 'Can', cant: 'Can’t', partly: 'Part', outside: 'Outside their hours', unknown: '—' }

/** One word for a person on a day: every event that day agreed, or Part when they differ. */
function dayWord(list: StaffPersonRow[]): { word: string; on: boolean; title: string } {
  const on = list.some((p) => p.assigned)
  const kinds = [...new Set(list.map((p) => p.verdict))]
  const word = kinds.length === 1 ? CELL[kinds[0]] : kinds.includes('cant') && kinds.every((k) => k === 'cant' || k === 'unknown') ? 'Can’t' : 'Part'
  return { word, on, title: list.map((p) => markWords(p)).join(', ') }
}

/** Everyone × the days with something on. Words in every cell; "On" when they're on something that day. */
function WhoCanWork({ rows }: { rows: StaffingRow[] }) {
  if (rows.length === 0) return null
  const days = [...new Set(rows.map((r) => localDate(r.event.startIso)))].sort()
  const people = rows[0].people.map((p) => ({ staffId: p.staffId, name: p.name })).sort((a, b) => a.name.localeCompare(b.name))
  if (people.length === 0) return null
  return (
    <>
      <p className="adm-lbl">Who can work</p>
      <div className="adm-avgrid-wrap">
        <table className="adm-avgrid">
          <caption className="adm-small adm-muted">What each person said about the times things are on. — means they haven’t said.</caption>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Person</span></th>
              {days.map((d) => <th key={d} scope="col">{dayLabel(d).split(' ')[0]}<br /><small>{dayLabel(d).split(' ').slice(1).join(' ')}</small></th>)}
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.staffId}>
                <th scope="row">{person.name}</th>
                {days.map((d) => {
                  const list = rows.filter((r) => localDate(r.event.startIso) === d).map((r) => r.people.find((p) => p.staffId === person.staffId)).filter((p): p is StaffPersonRow => !!p)
                  const { word, on, title } = dayWord(list)
                  const times = rows.filter((r) => localDate(r.event.startIso) === d).map((r) => `${r.event.title} ${timeSpan(r.event.startIso, r.event.endIso)}`).join(', ')
                  return (
                    <td key={d} className={`is-${word === 'Can' ? 'can' : word === 'Can’t' ? 'cant' : word === '—' ? 'none' : 'part'}`} title={`${times}: ${title}`}>
                      {word}{on && <><br /><b>On</b></>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
