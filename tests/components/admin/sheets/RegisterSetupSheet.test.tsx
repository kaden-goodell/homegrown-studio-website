import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, waitFor, configure } from '@testing-library/react'
import { RegisterSetupSheet } from '@components/admin/sheets/SettingsSheets'
import { ok, posts, refuse, renderSheet } from './harness'

configure({ asyncUtilTimeout: 5000 })
afterEach(() => vi.unstubAllGlobals())

const REGISTER = '/api/admin/register.json'
const T9 = { id: 'T9', name: 'Sales tax', percent: '9', enabled: true, additive: true, usable: true, why: '' }
const T8 = { id: 'T8', name: 'Café tax', percent: '8.5', enabled: true, additive: true, usable: false, why: 'This tax isn’t 9%, so online prices wouldn’t match the register.' }
const setup = (over: any = {}) => ({ classTaxId: '', classesCategoryId: '', updatedAt: null, by: null, history: [], source: { tax: 'none', category: 'none' }, ...over })

function server(o: { taxes?: any[]; categories?: any[]; setup?: any; notOnRegister?: any[]; oldSetup?: any[]; choicesError?: string; connection?: boolean; post?: (b: any) => any } = {}) {
  return vi.fn(async (url: string, init?: any) => {
    if (url.split('?')[0] !== REGISTER) throw new Error(`unexpected ${url}`)
    if (init?.method === 'POST') {
      const b = JSON.parse(init.body)
      const r = o.post?.(b)
      if (r) return r
      return ok({ data: { setup: setup({ classTaxId: b.classTaxId, classesCategoryId: b.classesCategoryId, updatedAt: 'u1', source: { tax: 'saved', category: 'saved' } }), changed: ['x'], notOnRegister: o.notOnRegister ?? [], oldSetup: o.oldSetup ?? [] } })
    }
    const choices = o.choicesError ? null : { taxes: o.taxes ?? [T9, T8], categories: o.categories ?? [{ id: 'C1', name: 'Classes' }, { id: 'C2', name: 'Party Crafts' }] }
    return ok({ data: { setup: o.setup ?? setup(), choices, ...(o.choicesError ? { choicesError: o.choicesError, connection: o.connection } : {}), notOnRegister: o.notOnRegister ?? [], oldSetup: o.oldSetup ?? [] } })
  })
}

describe('More › Register setup', () => {
  it('lists the taxes in words; a tax that isn’t 9% is greyed with why; the one 9% tax and Classes are preselected; Save sends both', async () => {
    const f = server({ notOnRegister: [{ id: 'cls_1', name: 'Clay Camp', startIso: '2031-01-10T18:00:00Z' }] })
    vi.stubGlobal('fetch', f)
    const { sheet } = renderSheet(<RegisterSetupSheet />)
    const nine = await screen.findByRole('radio', { name: /Sales tax · 9% · on/ })
    expect(nine).toBeChecked()
    expect(screen.getByRole('radio', { name: /Café tax · 8.5% · on/ })).toBeDisabled()
    expect(screen.getByText('This tax isn’t 9%, so online prices wouldn’t match the register.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Classes' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posts(f, REGISTER)).toHaveLength(1))
    expect(posts(f, REGISTER)[0].body).toEqual({ action: 'save', classTaxId: 'T9', classesCategoryId: 'C1', expectedUpdatedAt: null })
    expect(await screen.findByText('Saved. Now put each class below on the register.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Clay Camp/ }))
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'class', id: 'cls_1' }, expect.objectContaining({ back: { kind: 'more', page: 'register' } }))
  })

  it('no 9% tax and no Classes category: one tap makes each; the second make saves both picks', async () => {
    const f = server({
      taxes: [T8], categories: [],
      post: (b) => b.action === 'create-tax'
        ? ok({ data: { id: 'NEW_TAX', made: true, choices: { taxes: [T8, { ...T9, id: 'NEW_TAX' }], categories: [] } } })
        : b.action === 'create-category'
          ? ok({ data: { id: 'NEW_CAT', made: true, choices: { taxes: [T8, { ...T9, id: 'NEW_TAX' }], categories: [{ id: 'NEW_CAT', name: 'Classes' }] } } })
          : null,
    })
    vi.stubGlobal('fetch', f)
    renderSheet(<RegisterSetupSheet />)
    fireEvent.click(await screen.findByRole('button', { name: 'Make the 9% class tax' }))
    expect(await screen.findByText('The 9% class tax is ready. Now pick the Classes category.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Make the Classes category' }))
    await waitFor(() => expect(posts(f, REGISTER).map((p: any) => p.body.action)).toEqual(['create-tax', 'create-category', 'save']))
    expect(posts(f, REGISTER)[2].body).toMatchObject({ classTaxId: 'NEW_TAX', classesCategoryId: 'NEW_CAT' })
    expect(await screen.findByText('Saved. Classes go on the register with this tax and category.')).toBeInTheDocument()
  })

  it('an expired register connection: one plain line and Try again; no Netlify, nothing to save', async () => {
    vi.stubGlobal('fetch', server({ choicesError: 'The website can’t reach Square right now, so this can’t change from here. The register still works: ring the class up at the price on its class page, as a custom amount if it isn’t listed.', connection: true }))
    renderSheet(<RegisterSetupSheet />)
    expect(await screen.findByText('The website can’t reach Square right now, so this can’t change from here. The register still works: ring the class up at the price on its class page, as a custom amount if it isn’t listed.')).toBeInTheDocument()
    expect(screen.getByText('People can’t pay online until this works again.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/Netlify|SQUARE_|config/i)
  })

  it('a refusal on the tax shows on the tax', async () => {
    vi.stubGlobal('fetch', server({ post: (b) => (b.action === 'save' ? refuse(400, { error: 'That tax isn’t on the register any more. Pick another.', field: 'tax' }) : null) }))
    renderSheet(<RegisterSetupSheet />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText('That tax isn’t on the register any more. Pick another.')).toBeInTheDocument()
  })

  it('N1: after Make the 9% class tax (Classes already there), the new tax is shown picked and the Make button is gone', async () => {
    const f = server({
      taxes: [T8],
      post: (b) => b.action === 'create-tax'
        ? ok({ data: { id: 'NEW_TAX', made: true, choices: { taxes: [T8, { ...T9, id: 'NEW_TAX' }], categories: [{ id: 'C1', name: 'Classes' }] } } })
        : null,
    })
    vi.stubGlobal('fetch', f)
    renderSheet(<RegisterSetupSheet />)
    fireEvent.click(await screen.findByRole('button', { name: 'Make the 9% class tax' }))
    await waitFor(() => expect(posts(f, REGISTER).map((p: any) => p.body.action)).toEqual(['create-tax', 'save']))
    // N9: the ids it listed go with the make, so a retry after a lost reply is still audited.
    expect(posts(f, REGISTER)[0].body).toEqual({ action: 'create-tax', seen: ['T8'] })
    expect(await screen.findByText('Saved. Classes go on the register with this tax and category.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Sales tax · 9% · on/ })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Make the 9% class tax' })).toBeNull()
    expect(screen.queryByText('There’s no 9% tax on the register yet.')).toBeNull()
  })

  it('N3: the tax in use now is named, and said to be wrong (or gone) when it is', async () => {
    vi.stubGlobal('fetch', server({ setup: setup({ classTaxId: 'T8', classesCategoryId: 'C1', source: { tax: 'site', category: 'site' } }) }))
    const first = renderSheet(<RegisterSetupSheet />)
    expect(await screen.findByText(/The tax classes use now \(Café tax, 8.5%\) isn’t right: This tax isn’t 9%/)).toBeInTheDocument()
    first.unmount()
    vi.stubGlobal('fetch', server({ setup: setup({ classTaxId: 'GONE', classesCategoryId: 'C1', source: { tax: 'saved', category: 'saved' } }) }))
    const second = renderSheet(<RegisterSetupSheet />)
    expect(await screen.findByText('The tax classes use now isn’t on the register any more. Pick the 9% tax below.')).toBeInTheDocument()
    second.unmount()
    vi.stubGlobal('fetch', server({ setup: setup({ classTaxId: 'T9', classesCategoryId: 'C1', updatedAt: 'u0', source: { tax: 'saved', category: 'saved' } }) }))
    renderSheet(<RegisterSetupSheet />)
    expect(await screen.findByText('In use now: Sales tax, 9%.')).toBeInTheDocument()
  })

  it('classes on the old tax: listed with Update them all, which keeps going until none are left', async () => {
    const old = [{ id: 'cls_a', name: 'Clay Camp', startIso: '2031-01-10T18:00:00Z' }, { id: 'cls_b', name: 'Wreaths', startIso: '2031-01-11T18:00:00Z' }]
    let round = 0
    const f = server({
      setup: setup({ classTaxId: 'T9', classesCategoryId: 'C1', updatedAt: 'u0', source: { tax: 'saved', category: 'saved' } }),
      oldSetup: old,
      post: (b) => {
        if (b.action !== 'update-classes') return null
        round++
        return ok({ data: round === 1 ? { updated: 1, failed: [], left: 1, oldSetup: [old[1]] } : { updated: 1, failed: [], left: 0, oldSetup: [] } })
      },
    })
    vi.stubGlobal('fetch', f)
    renderSheet(<RegisterSetupSheet />)
    expect(await screen.findByText('2 classes still use the old tax or category')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update them all' }))
    expect(await screen.findByText('Updated 2 classes. The register is up to date.')).toBeInTheDocument()
    expect(posts(f, REGISTER).map((p: any) => p.body.action)).toEqual(['update-classes', 'update-classes'])
    expect(screen.queryByRole('button', { name: 'Update them all' })).toBeNull()
  })

  it('M-e: a class that keeps failing is tried 5 times, then left out and named with its own button below; the others still update', async () => {
    const old = [{ id: 'cls_a', name: 'Clay Camp', startIso: '2031-01-10T18:00:00Z' }, { id: 'cls_b', name: 'Looms', startIso: '2031-01-11T18:00:00Z' }]
    let round = 0
    const f = server({
      setup: setup({ classTaxId: 'T9', classesCategoryId: 'C1', updatedAt: 'u0', source: { tax: 'saved', category: 'saved' } }),
      oldSetup: old,
      post: (b) => {
        if (b.action !== 'update-classes') return null
        round++
        const skip: string[] = b.skip ?? []
        if (skip.includes('cls_a')) return ok({ data: { updated: 0, failed: [], left: 0, oldSetup: [old[0]] } })
        return ok({ data: { updated: round === 1 ? 1 : 0, failed: [old[0]], left: 0, oldSetup: [old[0]] } })
      },
    })
    vi.stubGlobal('fetch', f)
    renderSheet(<RegisterSetupSheet />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update them all' }))
    expect(await screen.findByText('Clay Camp didn’t update after 5 tries. Square didn’t take it. Open it below and tap Update the register in a few minutes.')).toBeInTheDocument()
    const bodies = posts(f, REGISTER).map((p: any) => p.body)
    expect(bodies).toHaveLength(6)
    expect(bodies.slice(0, 5).every((b: any) => !b.skip.includes('cls_a'))).toBe(true)
    expect(bodies[5].skip).toEqual(['cls_a'])
    // Its row is still there, opening the class (which has Update the register).
    expect(screen.getByRole('button', { name: /Clay Camp/ })).toBeInTheDocument()
  })

  it('Update them all stopped by a wrong tax: says so where she can fix it', async () => {
    vi.stubGlobal('fetch', server({
      setup: setup({ classTaxId: 'T9', classesCategoryId: 'C1', updatedAt: 'u0', source: { tax: 'saved', category: 'saved' } }),
      oldSetup: [{ id: 'cls_a', name: 'Clay Camp', startIso: '2031-01-10T18:00:00Z' }],
      post: (b) => (b.action === 'update-classes' ? refuse(503, { error: 'The class tax in Register setup isn’t on the register any more. Pick the 9% tax above.', field: 'tax' }) : null),
    }))
    renderSheet(<RegisterSetupSheet />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update them all' }))
    expect(await screen.findByText('The class tax in Register setup isn’t on the register any more. Pick the 9% tax above.')).toBeInTheDocument()
  })

  it('a save that leaves classes on the old tax says to update them', async () => {
    vi.stubGlobal('fetch', server({ oldSetup: [{ id: 'cls_a', name: 'Clay Camp', startIso: '2031-01-10T18:00:00Z' }] }))
    renderSheet(<RegisterSetupSheet />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved. Now tap Update them all below.')).toBeInTheDocument()
  })
})
