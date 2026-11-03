/**
 * Final security review I5: PostHog autocaptures nothing (no clicked text,
 * no element attributes, no heatmaps) and records nothing on pages that show
 * customers' details: /admin, /staff, the agreement, the party pages, and
 * any bare page.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { posthogPagePrivacy, posthogPrivacyOptions } from '@lib/posthog-privacy'

describe('posthog page privacy', () => {
  it('admin, staff, waiver and party pages: no autocapture, text masked, never recorded', () => {
    for (const path of ['/admin', '/admin/flyer/2026-11-07', '/staff', '/staff/pos-return', '/waiver', '/party/pty_1', '/party/pay/pty_1']) {
      const o = posthogPrivacyOptions(posthogPagePrivacy(path, false))
      expect(o, path).toEqual({ disable_session_recording: true, autocapture: false, enable_heatmaps: false, mask_all_text: true, mask_all_element_attributes: true })
    }
  })
  it('any bare page too', () => {
    expect(posthogPrivacyOptions(posthogPagePrivacy('/anything', true)).autocapture).toBe(false)
  })
  it('public pages keep autocapture, heatmaps and recording', () => {
    for (const path of ['/', '/workshops', '/parties', '/staffing-news', '/administration']) {
      const o = posthogPrivacyOptions(posthogPagePrivacy(path, false))
      expect(o, path).toEqual({ disable_session_recording: false, autocapture: true, enable_heatmaps: true, mask_all_text: false, mask_all_element_attributes: false })
    }
  })
  it('PostHog init and later set_config both use the options; heatmaps are never forced on', () => {
    const ph = readFileSync(resolve(__dirname, '../../src/components/posthog.astro'), 'utf8')
    expect(ph).toContain('...privacyOptions,')
    expect(ph).toContain('window.posthog.set_config(privacyOptions)')
    expect(ph).not.toMatch(/enable_heatmaps:\s*true/)
    expect(ph).not.toMatch(/autocapture:\s*true/)
  })
  it('/admin and /staff are bare pages on the main layout', () => {
    expect(readFileSync(resolve(__dirname, '../../src/pages/admin.astro'), 'utf8')).toMatch(/<Layout [^>]*\bbare\b/)
    expect(readFileSync(resolve(__dirname, '../../src/pages/staff.astro'), 'utf8')).toMatch(/<Layout [^>]*\bbare\b/)
  })
})
