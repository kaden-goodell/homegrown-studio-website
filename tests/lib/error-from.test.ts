import { describe, expect, it } from 'vitest'
import { errorFrom } from '../../src/lib/error-from'

const ORIGIN = 'https://ourhometownstudio.com'
const ex = (value: string, ...files: string[]) => [{ type: 'Error', value, stacktrace: files.length ? { frames: files.map((filename) => ({ filename })) } : undefined }]

describe('errorFrom', () => {
  it('calls it ours when any frame is a file from our site', () => {
    expect(errorFrom(ex('x is undefined', `${ORIGIN}/_astro/WorkshopBookingModal.abc.js`), ORIGIN)).toBe('ours')
    expect(errorFrom(ex('x', '/_astro/a.js'), ORIGIN)).toBe('ours')
    // Ours wins even when an outside script is also on the stack.
    expect(errorFrom(ex('x', 'https://www.googletagmanager.com/gtag/js', `${ORIGIN}/_astro/a.js`), ORIGIN)).toBe('ours')
  })

  it('does not mistake a look-alike domain for ours', () => {
    expect(errorFrom(ex('x', `${ORIGIN}.evil.com/a.js`), ORIGIN)).toBe('other_site')
    expect(errorFrom(ex('x', '//cdn.example.com/a.js'), ORIGIN)).toBe('unknown')
  })

  it('tags Facebook / Instagram in-app browser scripts', () => {
    expect(errorFrom(ex('Error invoking postMessage: Java object is gone', 'iabjs://navigation_performance_logger_android'), ORIGIN)).toBe('facebook_app')
  })

  it('tags browser extensions', () => {
    expect(errorFrom(ex('x', 'safari-web-extension://abc/content.js'), ORIGIN)).toBe('browser_extension')
    expect(errorFrom(ex('x', 'chrome-extension://abc/content.js'), ORIGIN)).toBe('browser_extension')
  })

  it('tags other websites (Google, Meta…)', () => {
    expect(errorFrom(ex('x', 'https://www.googletagmanager.com/gtag/js'), ORIGIN)).toBe('other_site')
  })

  it('tags the detail-less "Script error." as hidden', () => {
    expect(errorFrom(ex('Script error.'), ORIGIN)).toBe('hidden')
  })

  it('falls back to unknown when there is nothing to go on', () => {
    expect(errorFrom([{ type: 'TypeError', value: 'Load failed' }], ORIGIN)).toBe('unknown')
    expect(errorFrom(undefined, ORIGIN)).toBe('unknown')
    expect(errorFrom([null, 'junk', { stacktrace: { frames: 'no' } }], ORIGIN)).toBe('unknown')
  })

  it('still works when its source is pasted into the page on its own', () => {
    // posthog.astro inlines errorFrom.toString(): it must not lean on anything outside itself.
    const pasted = new Function(`return (${errorFrom.toString()})`)() as typeof errorFrom
    expect(pasted(ex('x', `${ORIGIN}/_astro/a.js`), ORIGIN)).toBe('ours')
    expect(pasted(ex('Script error.'), ORIGIN)).toBe('hidden')
  })
})
