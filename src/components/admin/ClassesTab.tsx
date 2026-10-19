import { useState } from 'react'
import ClassList from './classes/ClassList'
import LibraryList from './classes/LibraryList'
import { useRefresh } from './shell/data'
import { Seg } from './shell/items'
import type { Sheet } from './shell/router'
import { useToast } from './shell/Toast'

/**
 * Classes: what's coming up and the class library. The screens inside are
 * the ones from before the rebuild; 11b-B rebuilds this tab (Upcoming ·
 * Drafts · Past · Library).
 */
export default function ClassesTab({ onOpen }: { onOpen: (s: Sheet, data?: unknown) => void }) {
  const [seg, setSeg] = useState<'up' | 'lib'>('up')
  const { version, bump } = useRefresh()
  const toast = useToast()
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
      {seg === 'up' && <ClassList key={version} hideHeader onOpen={(id) => onOpen({ kind: 'class', id })} onNew={() => onOpen({ kind: 'new' })} />}
      {seg === 'lib' && (
        <LibraryList
          key={version}
          hideHeader
          onNew={() => onOpen({ kind: 'libnew' })}
          onEdit={(lib) => onOpen({ kind: 'libedit', id: lib.id }, lib)}
          onScheduleWithEdits={(lib) => onOpen({ kind: 'libsched', id: lib.id }, lib)}
          onScheduled={(cls, warning) => { bump(); toast(warning ?? 'Added. It’s on the calendar.'); onOpen({ kind: 'class', id: cls.id }) }}
        />
      )}
    </>
  )
}
