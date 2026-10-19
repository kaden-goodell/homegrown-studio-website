/** Render one /admin sheet on its own: a stand-in shell (open, close, dirty), the real toasts, and a refresh spy. */
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import type { ReactElement } from 'react'
import { RefreshContext } from '@components/admin/shell/data'
import { SheetProvider, type SheetApi } from '@components/admin/shell/Sheet'
import { ToastHost } from '@components/admin/shell/Toast'
import type { ClassContent, LibraryClass, ScheduledClass } from '@lib/classes/types'
import { defaultRules } from '@lib/classes/validate'
import { localToUtcISO } from '@lib/party-slots'

export function renderSheet(ui: ReactElement, opts: { data?: unknown } = {}) {
  const sheet = {
    open: vi.fn(), close: vi.fn(), setDirty: vi.fn(), leaving: false, keepEditing: vi.fn(), leave: vi.fn(), modal: true, data: opts.data,
  } satisfies SheetApi
  const bump = vi.fn()
  const utils = render(
    <ToastHost>
      <RefreshContext.Provider value={{ version: 0, bump }}>
        <SheetProvider value={sheet}><div className="adm">{ui}</div></SheetProvider>
      </RefreshContext.Provider>
    </ToastHost>,
  )
  /** The last thing the sheet said about unsaved changes. */
  const dirty = () => sheet.setDirty.mock.calls.at(-1)?.[0]
  return { ...utils, sheet, bump, dirty }
}

export const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
export const refuse = (status: number, body: unknown) => ({ ok: false, status, json: async () => body })
/** POSTs a fetch mock saw: url and parsed body. */
export const posts = (f: any, path?: string) => f.mock.calls
  .filter((c: any) => c[1]?.method === 'POST' && (!path || String(c[0]).split('?')[0] === path))
  .map((c: any) => ({ url: c[0] as string, body: JSON.parse(c[1].body), headers: c[1].headers as Record<string, string> }))
export const at = (day: string, hhmm: string) => localToUtcISO(day, hhmm)

export const content = (over: Partial<ClassContent> = {}): ClassContent => ({
  name: 'Pottery', description: 'Make a mug.', imageUrl: null, instructor: null, rules: defaultRules(),
  ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'pas_full', label: 'Full class', covers: { kind: 'all' } }],
  prices: { pas_full: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 90, ...over,
})

export const cls = (over: Partial<ScheduledClass> = {}): ScheduledClass => ({
  id: 'cls_1', libraryId: null, libraryVersion: null, content: content(),
  sessions: [{ id: 'ses_1', startIso: at('2031-03-12', '10:00'), endIso: at('2031-03-12', '11:30'), capacity: 12 }],
  status: 'open', square: { itemId: null, variations: {} }, createdAt: '2031-01-01T00:00:00.000Z', updatedAt: '2031-01-02T00:00:00.000Z',
  by: { id: 'admin', name: 'Owner' }, history: [], ...over,
})

export const lib = (id: string, c: ClassContent, over: Partial<LibraryClass> = {}): LibraryClass => ({
  id, archived: false,
  versions: [{ version: 1, at: '2031-01-01T15:00:00Z', by: { id: 'owner-catherine', name: 'Catherine' }, content: c, note: '', changed: [] }],
  ...over,
})

export const booking = (over: any = {}) => ({
  bookingId: 'bkg_1', customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '(256) 555-0100' },
  source: 'online', passId: 'pas_full', seats: { person: 2 }, sessionIds: ['ses_1'],
  picks: [{ seat: 1, ticketTypeId: 'person', answers: {} }, { seat: 2, ticketTypeId: 'person', answers: {} }], addOns: {},
  paidCents: 6540, refundedCents: 0, refunds: [], state: 'confirmed', overCapacity: false, lineIds: ['led_1', 'led_2'], at: '2031-03-01T00:00:00Z',
  refundable: [
    { id: 'led_1', seat: 1, ticketTypeId: 'person', sessions: 1, remainingCents: 3270, sessionCents: 0, freed: false },
    { id: 'led_2', seat: 2, ticketTypeId: 'person', sessions: 1, remainingCents: 3270, sessionCents: 0, freed: false },
  ],
  paidHere: true, refundableCents: 6540, waiting: null, ...over,
})
