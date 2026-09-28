import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { serializeAgreement, serializeAddendum, waiverContent, dropOffAddendum } from '@config/waiver-content'

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const hashes = JSON.parse(readFileSync('docs/waiver-versions/hashes.json', 'utf8'))

describe('agreement text is versioned', () => {
  it('current agreement hash matches the archive manifest', () => {
    expect(sha(serializeAgreement())).toBe(hashes.agreement[waiverContent.version])
  })
  it('current addendum hash matches the archive manifest', () => {
    expect(sha(serializeAddendum())).toBe(hashes.addendum[dropOffAddendum.version])
  })
  it('archive files exist for the current versions', () => {
    expect(() => readFileSync(`docs/waiver-versions/${waiverContent.version}.md`)).not.toThrow()
    expect(() => readFileSync(`docs/waiver-versions/addendum-${dropOffAddendum.version}.md`)).not.toThrow()
  })
})
