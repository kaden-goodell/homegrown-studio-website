import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { run, config } from '../../netlify/functions/tax-report'
import { taxReportJobKey } from '../../src/pages/api/jobs/tax-report.json'

describe('tax-report function', () => {
  it('runs on the 1st of each month, 9 AM CDT / 8 AM CST', () => {
    expect(config.schedule).toBe('0 14 1 * *')
  })

  it('knocks with the key the site expects', async () => {
    const ask = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    await run('https://ourhometownstudio.com', 'secret', ask as any)
    const [url, init] = ask.mock.calls[0]
    expect(url).toBe('https://ourhometownstudio.com/api/jobs/tax-report.json')
    expect(init.headers['x-job-key']).toBe(taxReportJobKey('secret'))
    expect(init.headers['x-job-key']).toBe(createHmac('sha256', 'secret').update('job:tax-report').digest('hex'))
  })

  it('reports trouble instead of throwing', async () => {
    expect((await run(undefined, 's')).reason).toBe('not configured')
    expect((await run('https://x.test', 's', vi.fn().mockRejectedValue(new Error('down')) as any)).ok).toBe(false)
  })
})
