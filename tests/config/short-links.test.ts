import { describe, it, expect } from 'vitest'
import { shortLinkTarget, SHORT_LINKS } from '@config/short-links'
import { touchFrom } from '@lib/attribution'
import { GET } from '../../src/pages/go/[slug]'

describe('partner short links', () => {
  it('tags the All Things Madison link', () => {
    expect(shortLinkTarget('all-things-madison')).toBe('/?utm_source=all-things-madison&utm_medium=partner')
  })

  it('ignores case and returns null for unknown or inherited names', () => {
    expect(shortLinkTarget('All-Things-Madison')).toBe('/?utm_source=all-things-madison&utm_medium=partner')
    expect(shortLinkTarget('nobody')).toBeNull()
    expect(shortLinkTarget('constructor')).toBeNull()
  })

  it('every link is credited to its partner when it lands', () => {
    for (const slug of Object.keys(SHORT_LINKS)) {
      const touch = touchFrom(`https://ourhometownstudio.com${shortLinkTarget(slug)}`, '', new Date(), 'ourhometownstudio.com')
      expect(touch?.source).toBe(SHORT_LINKS[slug].source)
      expect(touch?.medium).toBe(SHORT_LINKS[slug].medium)
    }
  })

  it('redirects, sending unknown slugs home', async () => {
    const hit = await GET({ params: { slug: 'all-things-madison' } } as any)
    expect(hit.status).toBe(302)
    expect(hit.headers.get('Location')).toBe('/?utm_source=all-things-madison&utm_medium=partner')
    const miss = await GET({ params: { slug: 'nope' } } as any)
    expect(miss.headers.get('Location')).toBe('/')
  })
})
