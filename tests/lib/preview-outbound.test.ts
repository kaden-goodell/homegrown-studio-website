import { describe, it, expect } from 'vitest'
import { previewEmail, previewText } from '@lib/preview-outbound'

describe('preview outbound', () => {
  it('leaves live messages alone', () => {
    const m = { to: 'jane@x.com', subject: 'You’re booked', html: '', text: '' }
    expect(previewEmail(m, {})).toBe(m)
    expect(previewText({ to: '+12565550123', content: 'Hi' }, {})).toEqual({ to: '+12565550123', content: 'Hi' })
  })
  it('sends a preview’s email and texts to Kaden, saying who they were for', () => {
    expect(previewEmail({ to: 'jane@x.com', subject: 'You’re booked' }, { STORE_NAMESPACE: 'preview' }))
      .toEqual({ to: 'kaden.goodell@gmail.com', subject: '[preview → jane@x.com] You’re booked' })
    expect(previewText({ to: '+12565550123', content: 'Hi' }, { STORE_NAMESPACE: 'preview' }))
      .toEqual({ to: '+14029802907', content: '[preview → +12565550123] Hi' })
  })
})
