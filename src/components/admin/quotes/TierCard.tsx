import { useEffect, useState } from 'react'
import { formatMoney } from '@lib/money'
import { costPerPerson, meterOf, normalPerPerson, offPct, totalCents } from '@lib/quotes/money'
import type { Meter, MenuItem, QuoteLine, QuoteSettings, SavedPackage, Tier } from '@lib/quotes/types'
import { PhotoPicker } from '../classes/ClassDetails'
import { AddLinePicker, type AddMode } from './AddLinePicker'
import { centsFromDollars, dollarsFromCents, priceText } from './api'

/** The meter in plain words. */
export function meterText(m: Meter, s: Pick<QuoteSettings, 'capPct'>): string {
  if (m === 'red') return `More than ${s.capPct}% off`
  if (m === 'yellow') return `Close to the ${s.capPct}% limit`
  return 'Good price'
}

/** The money a package shows: normal and price per person, total, how far off, the meter, and what's kept (when costs are known). */
export function tierMoney(t: Tier, guests: number, s: Pick<QuoteSettings, 'capPct' | 'yellowFromPct'>) {
  const normal = normalPerPerson(t, guests)
  const off = offPct(t, guests)
  const cost = costPerPerson(t, guests)
  return {
    normal,
    off,
    meter: meterOf(off, s),
    total: totalCents(t.priceCents, guests),
    keep: cost == null ? null : (t.priceCents - cost) * guests,
  }
}

/**
 * One package on the quote sheet: its name, photo, lines (remove; add from
 * the menu, a one-off, or a saved package), normal → price per person, the
 * total for the guests, the meter, and Hide. Read-only once paid.
 */
export function TierCard({ n, tier, guests, settings, items, packages, editable, onChange, onSavePackage }: {
  n: number
  tier: Tier
  guests: number
  settings: QuoteSettings
  items: MenuItem[]
  packages: SavedPackage[]
  editable: boolean
  onChange: (t: Tier) => void
  /** Saves it to the quote menu's packages; resolves to an error sentence or ''. */
  onSavePackage: (t: Tier) => Promise<string>
}) {
  const [adding, setAdding] = useState<AddMode | null>(null)
  const [photo, setPhoto] = useState(false)
  const [price, setPrice] = useState(dollarsFromCents(tier.priceCents))
  const [priceError, setPriceError] = useState('')
  const [pkgNote, setPkgNote] = useState<{ text: string; warn?: boolean } | null>(null)
  const [savingPkg, setSavingPkg] = useState(false)
  // A re-draft or a reload replaces the price from outside: follow it.
  useEffect(() => {
    if (centsFromDollars(price) !== tier.priceCents) setPrice(dollarsFromCents(tier.priceCents))
  }, [tier.priceCents])

  const m = tierMoney(tier, guests, settings)
  const set = (p: Partial<Tier>) => onChange({ ...tier, ...p })
  const photoUrl = tier.photoUrl ?? tier.lines.find((l) => l.photoUrl)?.photoUrl ?? null
  const pct = Math.round(m.off * 100)

  function typePrice(v: string) {
    setPrice(v)
    const c = centsFromDollars(v)
    if (c == null) { setPriceError('Type the price in dollars, like 75.'); return }
    setPriceError('')
    set({ priceCents: c })
  }
  function addLines(lines: QuoteLine[]) {
    set({ lines: [...tier.lines, ...lines] })
    setAdding(null)
  }
  async function savePkg() {
    setPkgNote(null)
    setSavingPkg(true)
    const err = await onSavePackage(tier)
    setSavingPkg(false)
    setPkgNote(err ? { text: err, warn: true } : { text: `Saved “${tier.name}” to your packages.` })
  }

  return (
    <section className={`adm-card adm-qtier${tier.hidden ? ' is-hidden' : ''}`} aria-label={`Package ${n}`}>
      {editable ? (
        <label className="adm-fld">
          <span>Package name</span>
          <input maxLength={60} value={tier.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
      ) : (
        <h3 className="adm-lbl">{tier.name}</h3>
      )}
      {tier.hidden && <p className="adm-small adm-muted">Hidden: the customer doesn’t see this package.</p>}

      {photoUrl && !photo && <img className="adm-qtier-photo" src={photoUrl} alt="" />}
      {editable && (photo
        ? <PhotoPicker url={tier.photoUrl} onChange={(url) => { set({ photoUrl: url }); setPhoto(false) }} what="Package photo" />
        : <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setPhoto(true)}>{tier.photoUrl ? 'Change photo' : 'Add a photo'}</button>)}

      <ul className="adm-qlines" aria-label={`What’s in ${tier.name}`}>
        {tier.lines.map((l, i) => (
          <li key={`${l.itemId ?? 'x'}-${i}`}>
            <span><b>{l.label}</b> <small className="adm-muted">{priceText(l.cents, l.per)}</small></span>
            {editable && (
              <button type="button" className="adm-btn is-ghost is-sm" aria-label={`Remove ${l.label}`}
                onClick={() => set({ lines: tier.lines.filter((_, j) => j !== i) })}>Remove</button>
            )}
          </li>
        ))}
        {tier.lines.length === 0 && <li><span className="adm-muted">Nothing in it yet.</span></li>}
      </ul>

      {editable && (adding
        ? <AddLinePicker mode={adding} items={items} packages={packages} onAdd={addLines} onClose={() => setAdding(null)} />
        : (
          <div className="adm-qactions">
            <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setAdding('item')}>+ Add item</button>
            <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setAdding('oneoff')}>+ One-off line</button>
            <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setAdding('package')}>+ Saved package</button>
          </div>
        ))}

      <p className="adm-qprice">{`${formatMoney(m.normal)} → ${formatMoney(tier.priceCents)}`} <small className="adm-muted">per person</small></p>
      {editable && (
        <label className="adm-fld">
          <span>Their price per person ($)</span>
          <input inputMode="decimal" value={price} onChange={(e) => typePrice(e.target.value)} />
        </label>
      )}
      {priceError && <p className="adm-fielderr" role="alert">{priceError}</p>}
      <p className="adm-small">{`Total for ${guests} guest${guests === 1 ? '' : 's'}: `}<b>{formatMoney(m.total)}</b></p>
      <p className="adm-small">
        <span className={`adm-qmeter is-${m.meter}`}>{meterText(m.meter, settings)}</span>
        {' '}{pct > 0 ? `${pct}% off normal` : pct < 0 ? `${-pct}% over normal` : 'Normal price'}
      </p>
      {m.keep != null && <p className="adm-small">{`You keep about ${formatMoney(Math.round(m.keep / 100) * 100)} after materials.`}</p>}

      {editable && (
        <div className="adm-qactions">
          <button type="button" className="adm-btn is-ghost is-sm" aria-pressed={tier.hidden} onClick={() => set({ hidden: !tier.hidden })}>
            {tier.hidden ? 'Show to the customer' : 'Hide from the customer'}
          </button>
          <button type="button" className="adm-btn is-ghost is-sm" disabled={savingPkg || !tier.lines.length} onClick={savePkg}>
            {savingPkg ? 'Saving…' : 'Save as package'}
          </button>
        </div>
      )}
      {pkgNote && <p className={pkgNote.warn ? 'adm-warntext' : 'adm-done'} role="status">{pkgNote.text}</p>}
    </section>
  )
}
