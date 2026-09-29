import { waiverContent } from '@config/waiver-content'
import { inputStyle, labelStyle, sectionNoteStyle } from '@components/waiver/waiver-ui'

export interface PickupRow {
  name: string
  phone: string
}

interface Props {
  rows: PickupRow[]
  onRowsChange: (rows: PickupRow[]) => void
  notAuthorized: string
  onNotAuthorizedChange: (v: string) => void
  /** Tighter spacing for the compact block on the returning-RSVP screen
   *  (HOM-212) — same fields, less vertical room. */
  compact?: boolean
}

/**
 * "Who may collect your child?" — up to 3 name+phone rows, plus the separate
 * "may NOT collect" note (HOM-212). Shared by the fresh-form drop-off section
 * and the returning-household RSVP screen's compact version, so both stay
 * validated the same way (name ≥2 chars, phone ≥10 digits if given — the
 * actual limits live server-side in `sign.json.ts`'s `parsePickupInput`).
 */
export default function PickupFields({ rows, onRowsChange, notAuthorized, onNotAuthorizedChange, compact }: Props) {
  const { form } = waiverContent

  function updateRow(i: number, patch: Partial<PickupRow>) {
    onRowsChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addRow() {
    if (rows.length >= 3) return
    onRowsChange([...rows, { name: '', phone: '' }])
  }
  function removeRow(i: number) {
    onRowsChange(rows.filter((_, idx) => idx !== i))
  }

  return (
    <div>
      <label style={labelStyle}>{form.pickupLabel}</label>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <input
            style={{ ...inputStyle, flex: '2 1 10rem' }}
            value={row.name}
            onChange={(e) => updateRow(i, { name: e.target.value })}
            placeholder="Name"
            aria-label={`Pickup person ${i + 1} name`}
          />
          <input
            style={{ ...inputStyle, flex: '1 1 8rem' }}
            value={row.phone}
            onChange={(e) => updateRow(i, { phone: e.target.value })}
            placeholder="Phone"
            type="tel"
            aria-label={`Pickup person ${i + 1} phone`}
          />
          <button
            type="button"
            aria-label={`Remove ${row.name || 'this pickup person'}`}
            onClick={() => removeRow(i)}
            style={{ border: '1px solid rgba(var(--color-primary-rgb), 0.25)', background: 'transparent', color: 'var(--color-muted)', borderRadius: '0.625rem', padding: '0.6rem 0.8rem', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            ✕
          </button>
        </div>
      ))}
      {rows.length < 3 && (
        <button
          type="button"
          onClick={addRow}
          style={{
            border: '1px dashed rgba(var(--color-primary-rgb), 0.4)',
            background: 'rgba(var(--color-primary-rgb), 0.05)',
            color: 'var(--color-primary)',
            borderRadius: '0.75rem',
            padding: '0.5rem 0.9rem',
            cursor: 'pointer',
            fontSize: '0.8125rem',
            fontWeight: 600,
          }}
        >
          {form.addPickupLabel}
        </button>
      )}
      <p style={{ ...sectionNoteStyle, margin: '0.5rem 0 0' }}>{form.pickupHelperText}</p>

      <div style={{ marginTop: compact ? '0.75rem' : '0.9rem' }}>
        <label style={labelStyle} htmlFor="wv-not-authorized">{form.notAuthorizedLabel}</label>
        <input
          id="wv-not-authorized"
          style={inputStyle}
          value={notAuthorized}
          onChange={(e) => onNotAuthorizedChange(e.target.value)}
          maxLength={200}
        />
        <p style={{ ...sectionNoteStyle, margin: '0.35rem 0 0' }}>{form.notAuthorizedHelper}</p>
      </div>
    </div>
  )
}
