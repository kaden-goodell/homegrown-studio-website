import { useState, type ReactNode } from 'react'
import { boldParts, visibleHelp, type HelpRow, type HelpSection, type HelpSquare } from '@lib/admin-help'
import { Seg } from '../shell/items'
import { SheetFrame } from '../shell/Sheet'

/** "Tap **Move**" → Tap <b>Move</b>. */
function Text({ text }: { text: string }) {
  return <>{boldParts(text).map((part, i) => (i % 2 ? <b key={i} className="adm-dark">{part}</b> : <span key={i}>{part}</span>))}</>
}

function Square({ sq }: { sq: HelpSquare }) {
  return (
    <div className="adm-panel adm-gap-top">
      <span><span className="adm-tag is-grey" style={{ margin: 0 }}>Look in Square</span> <span className="adm-small">{sq.why}</span></span>
      <span className="adm-small">{sq.steps}</span>
    </div>
  )
}

function Fold({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="adm-fold-group adm-help-fold" open={open}>
      <summary><span>{title}</span><i className="adm-chevron" aria-hidden="true" /></summary>
      {children}
    </details>
  )
}

function Section({ s }: { s: HelpSection }) {
  return (
    <Fold title={s.title}>
      {s.intro && <p className="adm-small adm-muted">{s.intro}</p>}
      <ul className="adm-plain adm-help-list">
        {s.points.map((p, i) => <li key={i}><Text text={p} /></li>)}
      </ul>
      {s.square?.map((sq, i) => <Square key={i} sq={sq} />)}
    </Fold>
  )
}

function Row({ r }: { r: HelpRow }) {
  return (
    <li className="adm-card adm-help-row" data-help-row={r.id}>
      <b className="adm-dark">{r.see}</b>
      <span className="adm-small adm-muted">{r.where}</span>
      <span>{r.means}</span>
      <span><span className="adm-small adm-muted">Tap: </span><Text text={r.tap} /></span>
      {r.square && <Square sq={r.square} />}
    </li>
  )
}

/** More › Help: how to do everything here, and what each warning and To decide item wants (DV13). */
export function HelpSheet() {
  const [tab, setTab] = useState<'how' | 'see'>('how')
  const [find, setFind] = useState('')
  const { sections, rows } = visibleHelp()
  const q = find.trim().toLowerCase()
  const hits = q ? rows.filter((r) => `${r.see} ${r.means} ${r.tap}`.toLowerCase().includes(q)) : rows
  return (
    <SheetFrame tall title="Help" subtitle="How to do everything here">
      <Seg label="Help" value={tab} onChange={setTab} options={[['how', 'How to'], ['see', 'When you see this']]} />
      {tab === 'how' && (
        <div className="adm-gap-top">
          <p className="adm-note">Tap a heading to open it. Button names in bold are exactly what you’ll see.</p>
          {sections.map((s) => <Section key={s.id} s={s} />)}
        </div>
      )}
      {tab === 'see' && (
        <div className="adm-gap-top">
          <p className="adm-note">Every warning and To decide item, and what to tap. Nothing on these lists cancels, refunds or messages anyone by itself.</p>
          <label className="adm-fld">
            <span>Find</span>
            <input type="search" value={find} placeholder="A word from the warning" onChange={(e) => setFind(e.target.value)} />
          </label>
          {hits.length === 0 && <p className="adm-empty">Nothing matches. Try one word from the warning.</p>}
          <ul className="adm-plain adm-help-rows">{hits.map((r) => <Row key={r.id} r={r} />)}</ul>
        </div>
      )}
    </SheetFrame>
  )
}
