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

function server(o: { taxes?: any[]; categories?: any[]; setup?: any; notOnRegister?: any[]; choicesError?: string; connection?: boolean; post?: (b: any) => any } = {}) {
  return vi.fn(async (url: string, init?: any) => {
    if (url.split('?')[0] !== REGISTER) throw new Error(`unexpected ${url}`)
    if (init?.method === 'POST') {
      const b = JSON.parse(init.body)
      const r = o.post?.(b)
      if (r) return r
      return ok({ data: { setup: setup({ classTaxId: b.classTaxId, classesCategoryId: b.classesCategoryId, updatedAt: 'u1', source: { tax: 'saved', category: 'saved' } }), changed: ['x'], notOnRegister: o.notOnRegister ?? [] } })
    }
    const choices = o.choicesError ? null : { taxes: o.taxes ?? [T9, T8], categories: o.categories ?? [{ id: 'C1', name: 'Classes' }, { id: 'C2', name: 'Party Crafts' }] }
    return ok({ data: { setup: o.setup ?? setup(), choices, ...(o.choicesError ? { choicesError: o.choicesError, connection: o.connection } : {}), notOnRegister: o.notOnRegister ?? [] } })
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
    vi.stubGlobal('fetch', server({ choicesError: 'The register connection isn’t working right now.', connection: true }))
    renderSheet(<RegisterSetupSheet />)
    expect(await screen.findByText('The register connection isn’t working right now.')).toBeInTheDocument()
    expect(screen.getByText(/Ring classes up at their regular price meanwhile/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/Netlify|SQUARE_|config/i)
  })

  it('a refusal on the tax shows on the tax', async () => {
    vi.stubGlobal('fetch', server({ post: (b) => (b.action === 'save' ? refuse(400, { error: 'That tax isn’t on the register any more. Pick another.', field: 'tax' }) : null) }))
    renderSheet(<RegisterSetupSheet />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText('That tax isn’t on the register any more. Pick another.')).toBeInTheDocument()
  })
})
