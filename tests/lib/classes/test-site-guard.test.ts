import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The deploy context this test pretends to run in.
const ctx = vi.hoisted(() => ({ value: 'dev' as string }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => ctx.value, isPreviewOrDev: () => ctx.value !== 'production' }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async () => undefined) }))

import { NO_TEST_STORE, testSiteRefusal } from '@lib/classes/test-site-guard'
import { createClass } from '@lib/classes/class-store'
import { extendHold } from '@lib/classes/seat-ledger'
import { syncClassToSquare } from '@lib/classes/square-catalog'
import { POST as book } from '@pages/api/classes/book.json'
import { defaultRules } from '@lib/classes/validate'
import type { ClassContent } from '@lib/classes/types'

const content: ClassContent = {
  name: 'Guard Pottery', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
  ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'Full class', covers: { kind: 'all' } }],
  prices: { all: { person: 2500 } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 60,
}
const by = { id: 'a', name: 'A' }
const sessions = [{ id: 'ses_g', startIso: '2031-05-01T15:00:00.000Z', endIso: '2031-05-01T16:00:00.000Z', capacity: 8 }]

describe('R41: a test site with no store of its own', () => {
  it('the rule: production allowed, preview with a namespace allowed, preview without refused, local dev allowed', () => {
    expect(testSiteRefusal({ context: 'production' })).toBeNull()
    expect(testSiteRefusal({ context: 'unknown' })).toBeNull()
    expect(testSiteRefusal({ context: 'deploy-preview', namespace: 'preview' })).toBeNull()
    expect(testSiteRefusal({ context: 'branch-deploy', namespace: 'booking' })).toBeNull()
    expect(testSiteRefusal({ context: 'deploy-preview' })).toBe(NO_TEST_STORE)
    expect(testSiteRefusal({ context: 'branch-deploy', namespace: '  ' })).toBe(NO_TEST_STORE)
    expect(testSiteRefusal({ context: 'dev' })).toBeNull()
    expect(NO_TEST_STORE).toBe('This test site has no store of its own. Set STORE_NAMESPACE first.')
  })

  describe('on the site', () => {
    beforeEach(() => { vi.stubEnv('STORE_NAMESPACE', '') })
    afterEach(() => { ctx.value = 'dev'; vi.unstubAllEnvs() })

    it('refuses class saves, seat writes and POS sync on a branch deploy; allows them in local dev', async () => {
      ctx.value = 'dev'
      const cls = await createClass({ content, sessions, status: 'draft', by })
      ctx.value = 'branch-deploy'
      await expect(createClass({ content, sessions, status: 'draft', by })).rejects.toThrow(NO_TEST_STORE)
      await expect(extendHold(cls.id, 'bkg_x', new Date().toISOString())).rejects.toThrow(NO_TEST_STORE)
      await expect(syncClassToSquare(cls)).rejects.toThrow(NO_TEST_STORE)
    })

    it('book.json answers the plain sentence on a preview without a namespace (simulated or not), and goes on with one', async () => {
      ctx.value = 'deploy-preview'
      const req = () => new Request('https://deploy-preview-3--site.netlify.app/api/classes/book.json', { method: 'POST', body: '{}' })
      const r = await book({ request: req(), clientAddress: '1.2.3.4', locals: {} } as any)
      expect(r.status).toBe(503)
      expect((await r.json()).detail).toBe(NO_TEST_STORE)
      vi.stubEnv('STORE_NAMESPACE', 'preview')
      const ok = await book({ request: req(), clientAddress: '1.2.3.5', locals: {} } as any)
      expect(ok.status).toBe(400) // past the guard: the empty booking is refused as invalid
    })
  })
})
