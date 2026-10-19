/**
 * Block time and Print a day, each in one sheet. (A class's own sheet is
 * ClassSheet; New class is NewClassSheet; the library's are LibrarySheets.)
 */
import { useEffect, useState } from 'react'
import type { BlockedTime } from '@lib/classes/blocked-time'
import type { Busy } from '@lib/classes/studio-schedule'
import { timeSpan as formatTimeSpan } from '../shell/time'
import { localDate } from '@lib/party-slots'
import { api, BLOCKED } from '../classes/api'
import BlockTimeForm from '../classes/BlockTimeForm'
import { dayLabel } from '../classes/dates'
import PrintDay from '../classes/PrintDay'
import { useRefresh } from '../shell/data'
import { SheetFrame, useSheet } from '../shell/Sheet'
import { DIDNT_SAVE, useToast } from '../shell/Toast'

/** A place in the sheet's pinned footer for an old screen's buttons (they portal into it). */
function useFooterSlot() {
  const [el, setEl] = useState<HTMLElement | null>(null)
  return { el, slot: <div ref={setEl} /> }
}

/** Block time: the form, then the sheet closes with a toast that can undo it. */
export function BlockSheet({ day }: { day?: string }) {
  const { el, slot } = useFooterSlot()
  const { setDirty, close } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  useEffect(() => () => setDirty(false), [])
  function blocked(b: BlockedTime, clashes: Busy[]) {
    bump()
    close()
    const when = `${dayLabel(localDate(b.startIso))}, ${formatTimeSpan(b.startIso, b.endIso)}`
    const over = clashes.length ? ` It sits on ${clashes.map((c) => c.label).join(', ')}; nothing booked was changed.` : ''
    toast(`Blocked ${when}.${over}`, {
      undo: () => api(BLOCKED, { action: 'remove', id: b.id }).then((r) => { bump(); if (!r.ok) toast(DIDNT_SAVE) }),
    })
  }
  return (
    <SheetFrame tall footer={slot} title="Block time" subtitle={day ? dayLabel(day) : undefined}>
      <p className="adm-note">Customers can’t book anything in this window.</p>
      <BlockTimeForm inSheet footer={el} initialDay={day} onDirtyChange={setDirty} onBlocked={blocked} />
    </SheetFrame>
  )
}

/** A day on paper: rosters, waivers and what to prepare. */
export function PrintSheet({ day }: { day: string }) {
  const { close } = useSheet()
  return (
    <SheetFrame tall title="Print a day" subtitle={dayLabel(day)}>
      <PrintDay day={day} hideBack onBack={close} />
    </SheetFrame>
  )
}
