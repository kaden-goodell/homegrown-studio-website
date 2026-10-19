import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import PrivateEventForm from '@components/private-events/PrivateEventForm'

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 3000, height: 2000 })))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA')
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
/**
 * The question's fieldset, found by its legend. Same as getByRole('group', { name }) (a fieldset's name is its
 * legend), without working out the accessible name of every element on this long form each time: that made the
 * many-question test take seconds and time out under a loaded full run.
 */
const questions = (name: RegExp) =>
  [...document.querySelectorAll('fieldset > legend')].filter((l) => name.test(l.textContent ?? '')).map((l) => l.parentElement as HTMLElement)
const group = (name: RegExp) => {
  const hits = questions(name)
  if (hits.length !== 1) throw new Error(`expected one question matching ${name}, found ${hits.length}`)
  return hits[0]
}
const send = () => fireEvent.click(screen.getByText('Send', { selector: 'button' }))
const pick = (name: RegExp, option: string) => fireEvent.click(within(group(name)).getByRole('button', { name: option }))

describe('PrivateEventForm (/private-events)', () => {
  it('sends every answer, then says thanks with no timeline', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ok: true } }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<PrivateEventForm />)
    pick(/What kind of event/, 'Team building')
    fill(/^Date/, '2026-11-21')
    fireEvent.click(screen.getByLabelText(/flexible on the date/))
    fill(/^Start time/, '14:00')
    fill(/^How many guests/, '18')
    pick(/Who’s crafting/, 'Both')
    fill(/^Youngest age/, '9')
    pick(/Where is it/, 'At your place')
    fill(/^Address/, '100 Main St')
    pick(/A sink nearby/, 'No')
    pick(/What would you like to make/, 'Something custom')
    pick(/^Food/, 'Please provide')
    pick(/^Drinks/, 'I’ll bring it')
    pick(/Your budget/, '$1,000 to $2,500')
    fill(/^Your name/, 'Dana Planner')
    fill(/^Email/, 'dana@example.com')
    fill(/^Phone/, '(256) 555-0142')
    pick(/Best way to reach you/, 'Text')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } })
    await screen.findByAltText('Photo 1')
    send()

    expect(await screen.findByText('Thanks, we got it.')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/private-events/request.json')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.event).toMatchObject({ kind: 'team', date: '2026-11-21', flexible: true, startTime: '14:00', guests: '18', crafters: 'both', youngest: '9' })
    expect(body.where).toMatchObject({ place: 'yours', address: '100 Main St', sink: 'no' })
    expect(body.craft.pick).toBe('custom')
    expect(body.extras).toEqual({ food: 'studio', drinks: 'guest', dessert: '', decor: '', tableware: '', favors: '' })
    expect(body.budget).toBe('1000-2500')
    expect(body.about).toMatchObject({ name: 'Dana Planner', email: 'dana@example.com', phone: '(256) 555-0142', contactBy: 'text' })
    expect(body.photos).toEqual(['data:image/jpeg;base64,AAAA'])
    expect(body.company).toBe('')
  })

  it('asks about the address, tables and sink only when it’s at their place', () => {
    render(<PrivateEventForm />)
    expect(screen.queryByLabelText(/^Address/)).toBeNull()
    expect(questions(/A sink nearby/)[0] ?? null).toBeNull()
    pick(/Where is it/, 'At your place')
    expect(screen.getByLabelText(/^Address/)).toBeInTheDocument()
    expect(group(/Tables and chairs/)).toBeInTheDocument()
    pick(/Where is it/, 'At the studio')
    expect(screen.queryByLabelText(/^Address/)).toBeNull()
  })

  it('asks the youngest age only when kids are crafting, and the kind only for "Something else"', () => {
    render(<PrivateEventForm />)
    expect(screen.queryByLabelText(/^Youngest age/)).toBeNull()
    pick(/Who’s crafting/, 'Kids')
    expect(screen.getByLabelText(/^Youngest age/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Tell us the kind of event/)).toBeNull()
    pick(/What kind of event/, 'Something else')
    expect(screen.getByLabelText(/Tell us the kind of event/)).toBeInTheDocument()
  })

  it('every extra has the same three answers', () => {
    render(<PrivateEventForm />)
    for (const extra of ['Food', 'Drinks', 'Cake or dessert', 'Decorations or a theme setup', 'Plates, cups and napkins', 'Party favors or goodie bags']) {
      const g = group(new RegExp(`^${extra}`))
      expect(within(g).getAllByRole('button').map((b) => b.textContent)).toEqual(['Please provide', 'I’ll bring it', 'Not needed'])
    }
  })

  it('the budget is optional, with three ranges and no "not sure"', () => {
    render(<PrivateEventForm />)
    const g = group(/^Your budget/)
    expect(within(g).getAllByRole('button').map((b) => b.textContent)).toEqual(['Under $1,000', '$1,000 to $2,500', '$2,500 or more'])
    expect(g.querySelector('legend .field-optional')).not.toBeNull()
  })

  it('marks only the date, guests, where and contact details as required', () => {
    render(<PrivateEventForm />)
    const required = [...document.querySelectorAll('label.field-label, legend.field-label')]
      .filter((l) => !l.querySelector('.field-optional'))
      .map((l) => l.textContent)
    expect(required).toEqual(['Date', 'How many guests?', 'Where is it?', 'Your name', 'Email', 'Phone'])
  })

  it('shows the server’s message under the field it names, and keeps the answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Pick a date.', field: 'date' }) }))
    render(<PrivateEventForm />)
    fill(/^Your name/, 'Dana')
    send()
    expect(await screen.findByText('Pick a date.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Date/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/^Your name/)).toHaveValue('Dana')
  })

  it('a dropped connection says so', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<PrivateEventForm />)
    send()
    expect(await screen.findByText(/Check your connection/)).toBeInTheDocument()
  })
})
