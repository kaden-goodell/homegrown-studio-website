/**
 * "How" under a line that says something is changed in Square (final review
 * M8): the exact steps, right there, from the same words Help uses.
 */
import { useState } from 'react'
import type { HelpSquare } from '@lib/admin-help'

export function SquareHow({ how }: { how: HelpSquare }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="adm-quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide the steps' : 'How'}</button>
      {open && <span className="adm-small" data-testid="square-how">{how.steps}</span>}
    </>
  )
}
