import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderSheet } from '../sheets/harness'
import { StaffRow } from '@components/admin/staffing/StaffRow'
import { CONTACTS, at, bodies, dayIn, ok, person, refuse, row } from './fixtures'

const STAFFING = '/api/admin/staffing.json'

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const loaded = (r = row()) => ok({ data: { row: r, contacts: CONTACTS } })

describe('Staff section', () => {
  it('shows each person with what they said in words, who asked, and how many are needed', async () => {
    fetchMock.mockResolvedValueOnce(loaded(row({
      people: [
        person('TM1', 'Kaden', { verdict: 'can' }),
        person('TM2', 'Jessica', { verdict: 'outside', hours: '4–9 PM', asked: true, askNote: 'I can stay late' }),
        person('TM3', 'Sam', { verdict: 'cant', markNote: 'dentist' }),
      ],
    })))
    renderSheet(<StaffRow eventKey="ses:ses_1" />)
    const list = await screen.findByRole('list', { name: 'Who can work' })
    const items = within(list).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Kaden')
    expect(items[0]).toHaveTextContent('Can')
    expect(items[1]).toHaveTextContent('Outside the hours they gave (4–9 PM)')
    expect(items[1]).toHaveTextContent('★ Asked · “I can stay late”')
    expect(items[2]).toHaveTextContent('Can’t (dentist)')
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('No one on yet')
    expect(within(screen.getByRole('group', { name: 'People needed' })).getByText('1')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${STAFFING}?key=ses%3Ases_1`)
  })

  it('Put on posts tell (ticked by default), shows a toast, and every button waits while it saves', async () => {
    fetchMock.mockResolvedValueOnce(loaded())
    renderSheet(<StaffRow eventKey="ses:ses_1" />)
    await screen.findByRole('list', { name: 'Who can work' })
    let release: (v: unknown) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise((r) => { release = r }))
    const jess = screen.getAllByRole('listitem')[1]
    fireEvent.click(within(jess).getByRole('button', { name: /^Put \S+ on$/ }))
    // Every button is off while it saves: a double tap can't send a second message.
    expect(within(jess).getByRole('button', { name: 'Saving…' })).toBeDisabled()
    for (const b of screen.getAllByRole('button', { name: /^Put \S+ on$/ })) expect(b).toBeDisabled()
    expect(bodies(fetchMock, STAFFING)).toEqual([{ body: { action: 'assign', staffId: 'TM2', tell: true, key: 'ses:ses_1' }, headers: expect.anything() }])
    const after = row({ people: [person('TM1', 'Kaden'), person('TM2', 'Jessica', { assigned: true }), person('TM3', 'Sam')] })
    await act(async () => { release(ok({ data: { row: after } })) })
    expect(await screen.findByText('Jessica is on.')).toBeInTheDocument()
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Jessica on')
  })

  it('untick Tell them sends tell false', async () => {
    fetchMock.mockResolvedValueOnce(loaded())
    renderSheet(<StaffRow eventKey="ses:ses_1" />)
    await screen.findByRole('list', { name: 'Who can work' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tell them by text and email' }))
    fetchMock.mockResolvedValueOnce(ok({ data: { row: row() } }))
    fireEvent.click(within(screen.getAllByRole('listitem')[2]).getByRole('button', { name: /^Put \S+ on$/ }))
    await screen.findByText('Sam is on.')
    expect(bodies(fetchMock, STAFFING)[0].body.tell).toBe(false)
  })

  it("someone marked Can't: the server's warning is in the toast, and Check with them offers Call and Text", async () => {
    fetchMock.mockResolvedValueOnce(loaded())
    renderSheet(<StaffRow eventKey="ses:ses_1" />)
    await screen.findByRole('list', { name: 'Who can work' })
    const after = row({ people: [person('TM1', 'Kaden'), person('TM2', 'Jessica', { assigned: true, verdict: 'cant', markNote: 'dentist' }), person('TM3', 'Sam')] })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { row: after }, warning: "Jessica marked this time as Can't (dentist)." }) })
    fireEvent.click(within(screen.getAllByRole('listitem')[1]).getByRole('button', { name: /^Put \S+ on$/ }))
    expect(await screen.findByText("Jessica is on. Jessica marked this time as Can't (dentist).")).toBeInTheDocument()
    const check = screen.getByRole('group', { name: 'Check with Jessica' })
    expect(within(check).getByRole('link', { name: /Call Jessica/ })).toHaveAttribute('href', 'tel:+12565550199')
    expect(within(check).getByRole('link', { name: /Text Jessica/ })).toHaveAttribute('href', 'sms:+12565550199')
  })

  it("a message that didn't go through: Call and Text for that person stay on the sheet until Done (B5)", async () => {
    fetchMock.mockResolvedValueOnce(loaded())
    renderSheet(<StaffRow eventKey="ses:ses_1" />)
    await screen.findByRole('list', { name: 'Who can work' })
    const after = row({ people: [person('TM1', 'Kaden'), person('TM2', 'Jessica', { assigned: true }), person('TM3', 'Sam')] })
    fetchMock.mockResolvedValueOnce(ok({ data: { row: after }, warning: "Saved. The text to Jessica didn't go through.", undelivered: { staffId: 'TM2', name: 'Jessica' } }))
    fireEvent.click(within(screen.getAllByRole('listitem')[1]).getByRole('button', { name: /^Put \S+ on$/ }))
    expect(await screen.findByText("Jessica is on. Saved. The text to Jessica didn't go through.")).toBeInTheDocument()
    const tell = screen.getByRole('group', { name: 'Tell Jessica yourself' })
    expect(tell).toHaveTextContent('The message to Jessica didn’t go through')
    expect(tell).toHaveTextContent('Call or text Jessica to tell them yourself.')
    expect(within(tell).getByRole('link', { name: /Call Jessica/ })).toHaveAttribute('href', 'tel:+12565550199')
    expect(within(tell).getByRole('link', { name: /Text Jessica/ })).toHaveAttribute('href', 'sms:+12565550199')
    fireEvent.click(within(tell).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('group', { name: 'Tell Jessica yourself' })).toBeNull()
  })

  it('no phone saved: says where to add one', async () => {
    fetchMock.mockResolvedValueOnce(loaded(row({ people: [person('TM3', 'Sam', { assigned: true, verdict: 'cant' })] })))
    renderSheet(<StaffRow eventKey="ses:ses_1" />)
    expect(await screen.findByText('There’s no phone number saved for Sam. Add one in More › Staff › People.')).toBeInTheDocument()
  })

  it('people needed: the stepper saves with what the sheet loaded; Usual resets; a stale save reloads with the message', async () => {
    fetchMock.mockResolvedValueOnce(loaded())
    renderSheet(<StaffRow eventKey="ses:ses_1" />)
    await screen.findByRole('list', { name: 'Who can work' })
    fetchMock.mockResolvedValueOnce(ok({ data: { row: row({ needed: 2, entry: { key: 'ses:ses_1', needed: 2, assigned: [], asks: [], seen: null, sequence: 0, updatedAt: 'u2', history: [] } }) } }))
    fireEvent.click(screen.getByRole('button', { name: 'One more person needed' }))
    expect(await screen.findByText('2 people needed.')).toBeInTheDocument()
    expect(bodies(fetchMock, STAFFING)[0].body).toEqual({ action: 'needed', key: 'ses:ses_1', needed: 2, expectedUpdatedAt: 'u1' })
    // Usual is offered once it's changed.
    fetchMock.mockResolvedValueOnce(refuse(409, { error: "Someone else just changed who's on this. Here's the latest.", stale: true }))
    fetchMock.mockResolvedValueOnce(loaded())
    fireEvent.click(screen.getByRole('button', { name: 'Usual' }))
    expect(await screen.findByText("Someone else just changed who's on this. Here's the latest.")).toBeInTheDocument()
    expect(bodies(fetchMock, STAFFING)[1].body).toMatchObject({ needed: null, expectedUpdatedAt: 'u2' })
    // and it read the latest again
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter((c: any) => !c[1]?.method).length).toBe(2))
  })

  it('a class on several days: Every day posts the batch keys with the hints', async () => {
    fetchMock.mockResolvedValueOnce(loaded())
    const days = [
      { key: 'ses:ses_1', startIso: row().event.startIso },
      { key: 'ses:ses_2', startIso: new Date(Date.parse(row().event.startIso) + 86_400_000).toISOString() },
    ]
    renderSheet(<StaffRow eventKey="ses:ses_1" days={days} />)
    await screen.findByRole('list', { name: 'Who can work' })
    fetchMock.mockResolvedValueOnce(ok({ data: { rows: [row({ people: [person('TM2', 'Jessica', { assigned: true })] }), null] } }))
    fireEvent.click(within(screen.getAllByRole('listitem')[1]).getByRole('button', { name: 'Every day' }))
    expect(await screen.findByText('Jessica is on all 2 days.')).toBeInTheDocument()
    expect(bodies(fetchMock, STAFFING)[0].body).toEqual({
      action: 'assign', staffId: 'TM2', tell: true, keys: ['ses:ses_1', 'ses:ses_2'],
      hints: { 'ses:ses_1': days[0].startIso, 'ses:ses_2': days[1].startIso },
    })
  })

  it('from a day that already happened, Every day and Off every day still tell them about the days to come; a single Put on there tells nobody', async () => {
    const pastDay = dayIn(-7)
    const past = row({ day: pastDay, people: [person('TM1', 'Kaden'), person('TM2', 'Jessica', { assigned: true }), person('TM3', 'Sam')] })
    fetchMock.mockResolvedValueOnce(loaded(past))
    const days = [
      { key: 'ses:ses_1', startIso: past.event.startIso },
      { key: 'ses:ses_2', startIso: at(dayIn(7), '10:00') },
      { key: 'ses:ses_3', startIso: at(dayIn(14), '10:00') },
    ]
    renderSheet(<StaffRow eventKey="ses:ses_1" days={days} />)
    await screen.findByRole('list', { name: 'Who can work' })
    // The tick shows (it's about the days still to come), and the note says so.
    expect(screen.getByRole('checkbox', { name: 'Tell them by text and email' })).toBeChecked()
    expect(screen.getByText(/Every day and Off every day tell them about the days still to come/)).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(ok({ data: { rows: [null, null] } }))
    fireEvent.click(within(screen.getAllByRole('listitem')[2]).getByRole('button', { name: 'Every day' }))
    expect(await screen.findByText('Sam is on all 2 days.')).toBeInTheDocument()
    expect(bodies(fetchMock, STAFFING)[0].body).toMatchObject({ action: 'assign', staffId: 'TM3', tell: true, keys: ['ses:ses_2', 'ses:ses_3'] })

    fetchMock.mockResolvedValueOnce(ok({ data: { rows: [null, null] } }))
    fireEvent.click(within(screen.getAllByRole('listitem')[1]).getByRole('button', { name: 'Off every day' }))
    expect(await screen.findByText('Jessica is off all 2 days.')).toBeInTheDocument()
    expect(bodies(fetchMock, STAFFING)[1].body).toMatchObject({ action: 'unassign', staffId: 'TM2', tell: true, keys: ['ses:ses_2', 'ses:ses_3'] })

    fetchMock.mockResolvedValueOnce(ok({ data: { row: past } }))
    fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: /^Put \S+ on$/ }))
    expect(await screen.findByText('Kaden is on.')).toBeInTheDocument()
    expect(bodies(fetchMock, STAFFING)[2].body).toMatchObject({ action: 'assign', staffId: 'TM1', tell: false, key: 'ses:ses_1' })
  })

  it('a past day of a one-day event: no tick, nobody is told', async () => {
    fetchMock.mockResolvedValueOnce(loaded(row({ day: dayIn(-2) })))
    renderSheet(<StaffRow eventKey="ses:ses_1" />)
    await screen.findByRole('list', { name: 'Who can work' })
    expect(screen.queryByRole('checkbox', { name: 'Tell them by text and email' })).toBeNull()
    expect(screen.getByText('This already happened. Changes are kept for the record, and nobody is told.')).toBeInTheDocument()
  })

  it("a read that fails says so with Try again (never 'nobody can')", async () => {
    fetchMock.mockResolvedValueOnce(refuse(503, { error: "We couldn't reach the staffing records. Try again." }))
    renderSheet(<StaffRow eventKey="ses:ses_1" />)
    expect(await screen.findByText("We couldn't reach the staffing records. Try again.")).toBeInTheDocument()
    expect(screen.queryByText(/No one on/)).toBeNull()
    fetchMock.mockResolvedValueOnce(loaded())
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'Who can work' })).toBeInTheDocument()
  })

  it('a cancelled class: only the people on it, with Take off and how to tell them; no stepper', async () => {
    fetchMock.mockResolvedValueOnce(loaded(row({ event: { status: 'cancelled' }, people: [person('TM2', 'Jessica', { assigned: true }), person('TM3', 'Sam')] })))
    renderSheet(<StaffRow eventKey="ses:ses_1" />)
    expect(await screen.findByText('This was cancelled')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'People needed' })).toBeNull()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('Jessica')])
    expect(screen.getByRole('button', { name: 'Take off' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Tell them' })).toHaveTextContent('Tell Jessica')
  })

  it('someone who no longer works here but is still on it can be taken off', async () => {
    fetchMock.mockResolvedValueOnce(loaded(row({ leftTeam: [{ staffId: 'TM9', name: 'Ava' }] })))
    renderSheet(<StaffRow eventKey="ses:ses_1" />)
    expect(await screen.findByText('No longer works here, so this doesn’t count as someone on.')).toBeInTheDocument()
    fetchMock.mockResolvedValueOnce(ok({ data: { row: row() } }))
    const ava = screen.getAllByRole('listitem').find((li) => li.textContent?.includes('Ava'))!
    fireEvent.click(within(ava).getByRole('button', { name: 'Take off' }))
    expect(await screen.findByText('Ava is off.')).toBeInTheDocument()
    expect(bodies(fetchMock, STAFFING)[0].body).toMatchObject({ action: 'unassign', staffId: 'TM9' })
  })
})
