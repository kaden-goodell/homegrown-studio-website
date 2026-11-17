import { SheetFrame } from '../shell/Sheet'

/** A private-event request's quote (`#quote-<requestId>`). Placeholder: the quote sheet itself is built next. */
export function QuoteSheet({ id }: { id: string }) {
  return (
    <SheetFrame title="Quote" subtitle={`For request ${id}`} tall>
      <p className="adm-note">The quote for this request opens here.</p>
    </SheetFrame>
  )
}
