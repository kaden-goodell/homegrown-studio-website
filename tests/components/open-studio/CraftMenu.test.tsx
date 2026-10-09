import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import CraftMenu from '@components/open-studio/CraftMenu'

const craft = (name: string, extra: object = {}) => ({ id: name, name, perHeadCents: 2000, perHeadMaxCents: 2000, description: 'x', ...extra })

describe('CraftMenu (Craft Café)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('leaves "Parties Only" crafts off the café menu', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { crafts: [craft('Keychain Bar'), craft('Patch & Personalize', { partyOnly: true })] } }) })))
    render(<CraftMenu />)
    expect(await screen.findByText('Keychain Bar')).toBeTruthy()
    expect(screen.queryByText('Patch & Personalize')).toBeNull()
  })
})
