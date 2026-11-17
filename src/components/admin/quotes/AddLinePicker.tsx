import { useState } from 'react'
import { lineOf } from '@lib/quotes/draft'
import type { MenuItem, QuoteLine, SavedPackage } from '@lib/quotes/types'
import { Seg } from '../shell/items'
import { centsFromDollars, priceText } from './api'

export type AddMode = 'item' | 'oneoff' | 'package'

/**
 * What goes into a package, in the card: an item from the quote menu (search
 * by name), a one-off line (name, price, per person or event), or every line
 * of a saved package. `onAdd` gets the new lines.
 */
export function AddLinePicker({ mode, items, packages, onAdd, onClose }: {
  mode: AddMode
  items: MenuItem[]
  packages: SavedPackage[]
  onAdd: (lines: QuoteLine[]) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [per, setPer] = useState<'person' | 'event'>('person')
  const [error, setError] = useState('')

  if (mode === 'oneoff') {
    function add() {
      const cents = centsFromDollars(price)
      if (!name.trim()) { setError('Give the line a name.'); return }
      if (cents == null) { setError('Type the price in dollars, like 25 or 12.50.'); return }
      onAdd([{ itemId: null, label: name.trim(), photoUrl: null, cents, per, costCents: null }])
    }
    return (
      <div className="adm-panel" role="group" aria-label="Add a one-off line">
        <b>Add a one-off line</b>
        <label className="adm-fld"><span>Line name</span><input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="adm-fld"><span>Price ($)</span><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <Seg<'person' | 'event'> label="Price is per" value={per} options={[['person', 'Per person'], ['event', 'For the event']]} onChange={setPer} />
        {error && <p className="adm-error" role="alert">{error}</p>}
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="adm-btn is-pri" onClick={add}>Add line</button>
        </div>
      </div>
    )
  }

  if (mode === 'package') {
    return (
      <div className="adm-panel" role="group" aria-label="Add a saved package">
        <b>Add a saved package</b>
        {packages.length === 0 && <p className="adm-small adm-muted">No saved packages yet. Tap Save as package on a package you like.</p>}
        <ul className="adm-mlist" aria-label="Saved packages">
          {packages.map((p) => (
            <li key={p.id}>
              <button type="button" className="adm-mrow" aria-label={`Add ${p.name}`} onClick={() => onAdd(p.lines)}>
                <span className="adm-rm"><b>{p.name}</b><small>{p.lines.map((l) => l.label).join(', ')}</small></span>
                <span className="adm-chev" aria-hidden="true">+</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="adm-btn is-ghost" onClick={onClose}>Cancel</button>
      </div>
    )
  }

  const q = search.trim().toLowerCase()
  const shown = items
    .filter((i) => !i.hidden && !i.gone && (!q || i.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 40)
  return (
    <div className="adm-panel" role="group" aria-label="Add an item">
      <b>Add an item from the quote menu</b>
      <label className="adm-fld">
        <input type="search" aria-label="Search the menu" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      {shown.length === 0 && <p className="adm-small adm-muted">{items.length ? 'Nothing matches. Try another word.' : 'The quote menu is empty. Load it from Square under More, Quote menu.'}</p>}
      <ul className="adm-mlist" aria-label="Menu items to add">
        {shown.map((i) => (
          <li key={i.id}>
            <button type="button" className="adm-mrow" aria-label={`Add ${i.name}`} onClick={() => onAdd([lineOf(i)])}>
              <span className="adm-rm"><b>{i.name}</b><small>{priceText(i.cents, i.per)}</small></span>
              <span className="adm-chev" aria-hidden="true">+</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="adm-btn is-ghost" onClick={onClose}>Cancel</button>
    </div>
  )
}
