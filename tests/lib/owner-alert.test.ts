import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let configured = true
const mockSend = vi.fn()
vi.mock('@lib/quo', () => ({
  quoConfigured: () => configured,
  sendQuoText: (...a: any[]) => mockSend(...a),
}))

let alertOwners: typeof import('@lib/owner-alert').alertOwners
let ownerAlertNumbers: typeof import('@lib/owner-alert').ownerAlertNumbers

const ORIGINAL = process.env.OWNER_ALERT_NUMBERS

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  configured = true
  mockSend.mockResolvedValue(undefined)
  process.env.OWNER_ALERT_NUMBERS = '+12565550101, (256) 555-0102'
  ;({ alertOwners, ownerAlertNumbers } = await import('@lib/owner-alert'))
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.OWNER_ALERT_NUMBERS
  else process.env.OWNER_ALERT_NUMBERS = ORIGINAL
})

describe('ownerAlertNumbers', () => {
  it('reads a comma-separated list and trims it', () => {
    expect(ownerAlertNumbers()).toEqual(['+12565550101', '(256) 555-0102'])
  })

  it('is empty when the setting is missing or blank', () => {
    delete process.env.OWNER_ALERT_NUMBERS
    expect(ownerAlertNumbers()).toEqual([])
    process.env.OWNER_ALERT_NUMBERS = ' , '
    expect(ownerAlertNumbers()).toEqual([])
  })
})

describe('alertOwners', () => {
  it('texts every owner number', async () => {
    const result = await alertOwners('New sign-up: ada@example.com')
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenCalledWith({ to: '+12565550101', content: 'New sign-up: ada@example.com' })
    expect(mockSend).toHaveBeenCalledWith({ to: '(256) 555-0102', content: 'New sign-up: ada@example.com' })
    expect(result).toEqual({ attempted: 2, sent: 2 })
  })

  it('sends nothing when texting is not set up', async () => {
    configured = false
    expect(await alertOwners('hello')).toEqual({ attempted: 0, sent: 0 })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('sends nothing when no owner numbers are configured', async () => {
    delete process.env.OWNER_ALERT_NUMBERS
    expect(await alertOwners('hello')).toEqual({ attempted: 0, sent: 0 })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('never throws, and counts only the texts that went out', async () => {
    mockSend.mockRejectedValueOnce(new Error('Quo API 500'))
    const result = await alertOwners('hello')
    expect(result).toEqual({ attempted: 2, sent: 1 })
  })

  it('keeps the text to a single message segment where it can', async () => {
    await alertOwners('x'.repeat(400))
    const content = mockSend.mock.calls[0][0].content as string
    expect(content.length).toBeLessThanOrEqual(300)
  })
})
