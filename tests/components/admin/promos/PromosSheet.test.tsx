import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { screen, fireEvent, within, waitFor, configure } from '@testing-library/react'
import { PromoSheet, PromosSheet } from '@components/admin/promos/PromosSheet'
import { ok, posts, refuse, renderSheet } from '../sheets/harness'

configure({ asyncUtilTimeout: 5000 })

const PROMOS = '/api/admin/promos.json'
const NOW = new Date('2026-11-02T18:00:00Z')
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const promo = (over: Record<string, any> = {}) => ({
  code: 'FALLFRIENDS', label: 'Fall flyer', off: { kind: 'percent', percent: 10 }, per: 'booking', appliesTo: { kind: 'all' },
  includeExtras: false, endsYmd: '2026-11-30', maxUses: 20, active: true, createdAt: '2026-10-20T15:00:00Z', updatedAt: 'u1',
  by: { id: 'owner-catherine', name: 'Catherine' }, history: [], usedCount: 3, payingNow: 0, ...over,
})
const names = { lib_clay: 'Clay Camp', cls_looms: 'Looms · Sat Nov 14' }
const choices = [
  { kind: 'library', id: 'lib_clay', name: 'Clay Camp' },
  { kind: 'library', id: 'lib_mugs', name: 'Mug Painting' },
  { kind: 'class', id: 'cls_looms', name: 'Looms', day: '2026-11-14' },
]

/** The promos route: the list, one code, and the writes. */
function server(o: { codes?: any[]; one?: any; save?: (b: any) => any } = {}) {
  return vi.fn(async (url: string, init?: any) => {
    if (url.split('?')[0] !== PROMOS) throw new Error(`unexpected ${url}`)
    if (init?.method !== 'POST') {
      if (url.includes('?code=')) return ok({ data: o.one ?? { code: promo(), names, uses: [], givenBack: [] } })
      return ok({ data: { codes: o.codes ?? [promo()], names, choices } })
    }
    const b = JSON.parse(init.body)
    if (o.save) return o.save(b)
    if (b.action === 'save') return ok({ data: { code: promo({ ...b.fields, usedCount: 0, updatedAt: 'u2' }) } })
    if (b.action === 'active') return ok({ data: { code: promo({ active: b.active, updatedAt: 'u3' }) } })
    return refuse(400, { error: 'Reload the page and try again.' })
  })
}
const footer = () => document.querySelector('.adm-sheet-foot') as HTMLElement
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement

describe('More › Promotions: the list', () => {
  it('each code in plain words with its uses; an off code is tagged; + New code opens the form', async () => {
    vi.stubGlobal('fetch', server({ codes: [promo(), promo({ code: 'TEACHERS', off: { kind: 'amount', cents: 500 }, per: 'seat', appliesTo: { kind: 'classes', libraryIds: ['lib_clay'], classIds: ['cls_looms'] }, endsYmd: null, maxUses: null, usedCount: 2, active: false })] }))
    const { sheet } = renderSheet(<PromosSheet />)
    expect(await screen.findByText('10% off · every class · ends Mon Nov 30 · 3 of 20 used')).toBeInTheDocument()
    expect(screen.getByText('$5 off each person · Clay Camp and Looms · Sat Nov 14 · 2 used')).toBeInTheDocument()
    const off = screen.getByRole('button', { name: /TEACHERS/ })
    expect(within(off).getByText('Off')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: '+ New code' }))
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'promo', id: 'new' })
    fireEvent.click(screen.getByRole('button', { name: /FALLFRIENDS/ }))
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'promo', id: 'FALLFRIENDS' })
  })
  it('no codes yet: one sentence and the button that fixes it', async () => {
    vi.stubGlobal('fetch', server({ codes: [] }))
    renderSheet(<PromosSheet />)
    expect(await screen.findByText('No codes yet. Make one with + New code.')).toBeInTheDocument()
  })
})

describe('More › Promotions: New code', () => {
  it('a 10% code for every class in a few taps: typed upper case, posted, toasted, then opened', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    const { sheet, dirty } = renderSheet(<PromoSheet id="new" />)
    fireEvent.change(box('Code'), { target: { value: 'fallfriends' } })
    expect(box('Code').value).toBe('FALLFRIENDS')
    expect(dirty()).toBe(true)
    fireEvent.change(box('Percent off'), { target: { value: '10' } })
    fireEvent.change(box('Use limit (optional)'), { target: { value: '20' } })
    fireEvent.change(box('Last day (optional)'), { target: { value: '2026-11-30' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Make the code' }))
    await waitFor(() => expect(sheet.open).toHaveBeenCalledWith({ kind: 'promo', id: 'FALLFRIENDS' }))
    expect(posts(f, PROMOS)[0].body).toEqual({
      action: 'save', expectedUpdatedAt: null,
      fields: { code: 'FALLFRIENDS', label: '', off: { kind: 'percent', percent: 10 }, per: 'booking', appliesTo: { kind: 'all' }, includeExtras: false, endsYmd: '2026-11-30', maxUses: 20, active: true },
    })
    expect(await screen.findByText('FALLFRIENDS is ready. Customers can type it when they pay.')).toBeInTheDocument()
  })

  it('$ off each person, picked classes found by name', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<PromoSheet id="new" />)
    fireEvent.change(box('Code'), { target: { value: 'TEACHERS' } })
    fireEvent.click(screen.getByRole('button', { name: '$ off' }))
    fireEvent.change(box('Dollars off ($)'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Each person' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick classes' }))
    await screen.findByLabelText('Clay Camp · every date')
    fireEvent.change(box('Find a class'), { target: { value: 'loo' } })
    expect(screen.queryByLabelText('Clay Camp · every date')).toBeNull()
    fireEvent.click(screen.getByLabelText('Looms · Sat Nov 14'))
    fireEvent.change(box('Find a class'), { target: { value: '' } })
    fireEvent.click(screen.getByLabelText('Clay Camp · every date'))
    expect(screen.getByText('2 picked')).toBeInTheDocument()
    fireEvent.change(box('Use limit (optional)'), { target: { value: '30' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Make the code' }))
    await waitFor(() => expect(posts(f, PROMOS)).toHaveLength(1))
    expect(posts(f, PROMOS)[0].body.fields).toMatchObject({ off: { kind: 'amount', cents: 500 }, per: 'seat', appliesTo: { kind: 'classes', libraryIds: ['lib_clay'], classIds: ['cls_looms'] } })
  })

  it('M4: a code that makes bookings free with no use limit says so, and Save asks first, in the sheet', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<PromoSheet id="new" />)
    fireEvent.change(box('Code'), { target: { value: 'MAYAFREE' } })
    fireEvent.change(box('Percent off'), { target: { value: '100' } })
    expect(screen.getByTestId('free-warning')).toHaveTextContent('Anyone with this code books for free. Set a use limit?')
    expect(screen.getByText('Make it hard to guess. Not FREE or GIFT.')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Make the code' }))
    const ask = within(footer()).getByRole('group', { name: 'Save with no use limit?' })
    expect(ask).toHaveTextContent('Anyone with this code books for free. Save it with no use limit?')
    expect(posts(f, PROMOS)).toHaveLength(0)
    // Set a use limit: back to the form, the cursor in the limit box.
    fireEvent.click(within(ask).getByRole('button', { name: 'Set a use limit' }))
    await waitFor(() => expect(document.activeElement).toBe(box('Use limit (optional)')))
    fireEvent.change(box('Use limit (optional)'), { target: { value: '1' } })
    expect(screen.queryByTestId('free-warning')).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Make the code' }))
    await waitFor(() => expect(posts(f, PROMOS)).toHaveLength(1))
    expect(posts(f, PROMOS)[0].body.fields).toMatchObject({ off: { kind: 'percent', percent: 100 }, maxUses: 1 })
  })

  it('M4: "Save with no limit" saves it as asked; $20 or more off says "may book for free"', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<PromoSheet id="new" />)
    fireEvent.change(box('Code'), { target: { value: 'BIGGIFT' } })
    fireEvent.click(screen.getByRole('button', { name: '$ off' }))
    fireEvent.change(box('Dollars off ($)'), { target: { value: '25' } })
    expect(screen.getByTestId('free-warning')).toHaveTextContent('Anyone with this code may book for free. Set a use limit?')
    fireEvent.click(within(footer()).getByRole('button', { name: 'Make the code' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save with no limit' }))
    await waitFor(() => expect(posts(f, PROMOS)).toHaveLength(1))
    expect(posts(f, PROMOS)[0].body.fields).toMatchObject({ off: { kind: 'amount', cents: 2500 }, maxUses: null })
  })

  it('fixes show in place, the cursor goes to the first one, nothing is sent', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<PromoSheet id="new" />)
    fireEvent.change(box('Code'), { target: { value: 'NO' } })
    fireEvent.change(box('Percent off'), { target: { value: '10' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Make the code' }))
    expect(await screen.findByText('A code is 3 to 20 letters or numbers, with no spaces or symbols.')).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(box('Code')))
    expect(box('Code')).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(box('Code'), { target: { value: 'GOOD1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick classes' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Make the code' }))
    expect(await screen.findByText('Pick at least one class, or choose Everything.')).toBeInTheDocument()
    expect(posts(f, PROMOS)).toHaveLength(0)
  })

  it('a code that exists already: the server\'s sentence under the code', async () => {
    vi.stubGlobal('fetch', server({ save: () => refuse(409, { error: 'That code is taken.', field: 'code' }) }))
    renderSheet(<PromoSheet id="new" />)
    fireEvent.change(box('Code'), { target: { value: 'FALLFRIENDS' } })
    fireEvent.change(box('Percent off'), { target: { value: '10' } })
    fireEvent.change(box('Use limit (optional)'), { target: { value: '5' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Make the code' }))
    expect(await screen.findByText('That code is taken.')).toBeInTheDocument()
  })
})

describe('More › Promotions: one code', () => {
  const maya = { bookingId: 'bkg_maya', at: '2026-10-30T15:00:00Z', classId: 'cls_looms', className: 'Looms · Sat Nov 14', who: 'Maya Rivera', seats: 1, cancelled: true }

  it('what it does, who used it, and Give this use back after an in-sheet check', async () => {
    const one = { code: promo({ code: 'MAYAFREE', off: { kind: 'percent', percent: 100 }, maxUses: 1, usedCount: 1, endsYmd: null }), names, uses: [maya], givenBack: [] }
    const f = server({
      one,
      save: (b) => (b.action === 'give-back'
        ? ok({ data: { code: { ...one.code, usedCount: 0 }, uses: [], givenBack: [{ bookingId: 'bkg_maya', at: '2026-11-02T18:00:00Z', by: 'Catherine', className: maya.className, who: 'Maya Rivera' }] } })
        : refuse(400, {})),
    })
    vi.stubGlobal('fetch', f)
    renderSheet(<PromoSheet id="MAYAFREE" />)
    expect(await screen.findByText('Maya Rivera')).toBeInTheDocument()
    expect(screen.getByText('Looms · Sat Nov 14 · used Fri Oct 30')).toBeInTheDocument()
    expect(screen.getByText('Refunded')).toBeInTheDocument()
    expect(screen.getByText('100% off')).toBeInTheDocument()
    expect(screen.getByText('1 booking')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Give this use back' }))
    const ask = screen.getByRole('group', { name: 'Give Maya Rivera’s use back?' })
    expect(ask).toHaveTextContent('MAYAFREE then works one more time.')
    expect(posts(f, PROMOS)).toHaveLength(0)
    fireEvent.click(within(ask).getByRole('button', { name: 'Give it back' }))
    expect(await screen.findByText('Use given back. MAYAFREE works once more.')).toBeInTheDocument()
    expect(posts(f, PROMOS)[0].body).toEqual({ action: 'give-back', code: 'MAYAFREE', bookingId: 'bkg_maya' })
    expect(screen.getByText('Given back (1)')).toBeInTheDocument()
    expect(screen.getByText('Nobody yet.')).toBeInTheDocument()
  })

  it('a code with no use limit has nothing to give back', async () => {
    vi.stubGlobal('fetch', server({ one: { code: promo({ maxUses: null }), names, uses: [maya], givenBack: [] } }))
    renderSheet(<PromoSheet id="FALLFRIENDS" />)
    await screen.findByText('Maya Rivera')
    expect(screen.queryByRole('button', { name: 'Give this use back' })).toBeNull()
  })

  it('Turn off: posted with the version loaded, toasted with Undo; Undo turns it back on', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<PromoSheet id="FALLFRIENDS" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }))
    expect(await screen.findByText('FALLFRIENDS is off. Nobody can use it now.')).toBeInTheDocument()
    expect(posts(f, PROMOS)[0].body).toEqual({ action: 'active', code: 'FALLFRIENDS', active: false, expectedUpdatedAt: 'u1' })
    expect(within(footer()).getByRole('button', { name: 'Turn on' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(posts(f, PROMOS)).toHaveLength(2))
    expect(posts(f, PROMOS)[1].body).toMatchObject({ action: 'active', active: true, expectedUpdatedAt: 'u3' })
  })

  it('Edit: the code can\'t be renamed; Save sends the version loaded and comes back to the code', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<PromoSheet id="FALLFRIENDS" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByText('A code can’t be renamed. Make a new code instead.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Code')).toBeNull()
    fireEvent.change(box('Use limit (optional)'), { target: { value: '40' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posts(f, PROMOS)).toHaveLength(1))
    expect(posts(f, PROMOS)[0].body).toMatchObject({ action: 'save', expectedUpdatedAt: 'u1', fields: { code: 'FALLFRIENDS', maxUses: 40 } })
    expect(await within(footer()).findByRole('button', { name: 'Turn off' })).toBeInTheDocument()
  })

  it('M-b: "Made by" names who made the code, not who saved it last', async () => {
    const history = [
      { at: '2026-10-20T15:00:00Z', by: { id: 'owner-kaden', name: 'Kaden' }, change: 'Made the code' },
      { at: '2026-10-25T15:00:00Z', by: { id: 'owner-catherine', name: 'Catherine' }, change: 'On or off' },
    ]
    vi.stubGlobal('fetch', server({ one: { code: promo({ history }), names, uses: [], givenBack: [] } }))
    renderSheet(<PromoSheet id="FALLFRIENDS" />)
    expect(await screen.findByText('Made by Kaden on Tue Oct 20.')).toBeInTheDocument()
  })

  it('M-d: giving back the use of a booking that is still coming says their seats stay booked', async () => {
    const coming = { ...maya, cancelled: false }
    vi.stubGlobal('fetch', server({ one: { code: promo({ maxUses: 1 }), names, uses: [coming], givenBack: [] } }))
    renderSheet(<PromoSheet id="FALLFRIENDS" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Give this use back' }))
    expect(screen.getByRole('group', { name: 'Give Maya Rivera’s use back?' })).toHaveTextContent('FALLFRIENDS then works one more time. Their seats stay booked.')
  })

  it('M-c: someone saved the code meanwhile: Reload brings theirs in and keeps what she typed; the next Save uses the new version', async () => {
    let n = 0
    const theirs = promo({ label: 'Changed by Kaden', endsYmd: '2026-12-15', updatedAt: 'u9' })
    const f = vi.fn(async (url: string, init?: any) => {
      if (init?.method !== 'POST') return ok({ data: { code: n ? theirs : promo(), names, uses: [], givenBack: [] } })
      const b = JSON.parse(init.body)
      if (b.expectedUpdatedAt === 'u1') { n++; return refuse(409, { error: 'Someone changed this code just now. Reload to see it, then try again.', stale: true }) }
      return ok({ data: { code: promo({ ...b.fields, updatedAt: 'u10' }) } })
    })
    vi.stubGlobal('fetch', f)
    renderSheet(<PromoSheet id="FALLFRIENDS" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(box('Use limit (optional)'), { target: { value: '40' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    const panel = await screen.findByRole('group', { name: 'Someone changed this code' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Reload' }))
    expect(await screen.findByText('Loaded the latest. What you typed is kept. Check it, then save.')).toBeInTheDocument()
    expect(box('Use limit (optional)').value).toBe('40')
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posts(f, PROMOS)).toHaveLength(2))
    expect(posts(f, PROMOS)[1].body).toMatchObject({ expectedUpdatedAt: 'u9', fields: { maxUses: 40, label: 'Changed by Kaden', endsYmd: '2026-12-15' } })
  })
})

