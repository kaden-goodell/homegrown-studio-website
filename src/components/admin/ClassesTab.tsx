import { useState } from 'react'
import ClassList from './classes/ClassList'
import LibraryList from './classes/LibraryList'
import { addDays, dayLabel, today } from './classes/dates'
import { localDate } from '@lib/party-slots'
import { useCalendar, useRefresh } from './shell/data'
import { Failed, ItemRow, itemKey, Seg, sheetOf, Skeleton } from './shell/items'
import type { Sheet } from './shell/router'
import { useToast } from './shell/Toast'

/**
 * Classes: what's coming up and the class library. The screens inside are
 * the ones from before the rebuild; 11b-B rebuilds this tab (Upcoming ·
 * Drafts · Past · Library). Classes still run from Square are listed too,
 * read only, so this tab never contradicts Home and the Calendar.
 */
export default function ClassesTab({ onOpen }: { onOpen: (s: Sheet, data?: unknown) => void }) {
  const [seg, setSeg] = useState<'up' | 'lib'>('up')
  const { version, bump } = useRefresh()
  const toast = useToast()
  const day = today()
  // Six weeks is as far as the calendar route reads at once.
  const square = useCalendar(day, addDays(day, 42))
  const legacy = (square.items ?? []).filter((i) => i.kind === 'legacy-class')
  return (
    <>
      <div className="adm-top">
        <div className="adm-grow">
          <p className="adm-brand">Hometown Studio</p>
          <h1>Classes</h1>
        </div>
        <button type="button" className="adm-btn is-pri is-sm" onClick={() => onOpen({ kind: 'new' })}>+ New class</button>
      </div>
      <Seg label="Show" value={seg} onChange={setSeg} options={[['up', 'Upcoming'], ['lib', 'Library']]} />
      {seg === 'up' && (
        <>
          <ClassList
            key={version}
            hideHeader
            emptyText={legacy.length ? 'None of our own classes coming up yet. The ones still run from Square are below.' : undefined}
            onOpen={(id) => onOpen({ kind: 'class', id })}
            onNew={() => onOpen({ kind: 'new' })}
          />
          <section aria-label="Still run from Square">
            <p className="adm-lbl" style={{ marginTop: '1.25rem' }}>Still run from Square</p>
            {square.error && <Failed message={square.error} onRetry={square.retry} />}
            {!square.error && !square.items && <Skeleton rows={2} label="Loading the Square classes" />}
            {square.items && !legacy.length && <p className="adm-muted adm-small">None in the next six weeks.</p>}
            {[...new Set(legacy.map((i) => localDate(i.startIso)))].map((d) => (
              <section key={d} aria-label={dayLabel(d)}>
                <p className="adm-dayname">{dayLabel(d)}</p>
                {legacy.filter((i) => localDate(i.startIso) === d).map((i) => (
                  <ItemRow key={itemKey(i)} item={i} sub="" tag="In Square" onOpen={() => onOpen(sheetOf(i, d), i)} />
                ))}
              </section>
            ))}
          </section>
        </>
      )}
      {seg === 'lib' && (
        <LibraryList
          key={version}
          hideHeader
          hideAdd
          onNew={() => onOpen({ kind: 'libnew' })}
          onEdit={(lib) => onOpen({ kind: 'libedit', id: lib.id }, lib)}
          onScheduleWithEdits={(lib) => onOpen({ kind: 'libsched', id: lib.id }, lib)}
          onScheduled={(cls, warning) => { bump(); toast(warning ?? 'Added. It’s on the calendar.'); onOpen({ kind: 'class', id: cls.id }) }}
        />
      )}
    </>
  )
}
