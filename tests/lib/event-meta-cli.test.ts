import { describe, it, expect } from 'vitest'
import { parseSetEventArgs, SET_EVENT_USAGE, classifyBlobRead, echoOptionIds } from '@lib/event-meta-cli'

describe('parseSetEventArgs', () => {
  it('needs --workshop or --party with an id', () => {
    expect(parseSetEventArgs(['--on'])).toEqual({ error: SET_EVENT_USAGE })
  })

  it('keeps the old drop-off and days flags', () => {
    expect(parseSetEventArgs(['--workshop', 'clssch_1', '--on', '--days', '2026-10-19,2026-10-18'])).toEqual({
      kind: 'workshop', id: 'clssch_1', show: false, patch: { dropOff: true, days: ['2026-10-18', '2026-10-19'] },
    })
    expect(parseSetEventArgs(['--party', 'bk_1', '--off'])).toMatchObject({ kind: 'party', patch: { dropOff: false } })
  })

  it('--option replaces the class’s questions; it may repeat', () => {
    const r = parseSetEventArgs(['--workshop', 'clssch_pails', '--option', 'Pumpkin color=Light Pink|Light Blue|Black|Lavender', '--option', 'Ribbon=Red|Gold'])
    expect(r).toMatchObject({
      patch: {
        options: [
          { id: '', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] },
          { id: '', label: 'Ribbon', choices: ['Red', 'Gold'] },
        ],
      },
    })
  })

  it('--no-options clears them', () => {
    expect(parseSetEventArgs(['--workshop', 'clssch_pails', '--no-options'])).toMatchObject({ patch: { options: [] } })
  })

  it('--cutoff takes whole hours or "default"', () => {
    expect(parseSetEventArgs(['--workshop', 'c', '--cutoff', '48'])).toMatchObject({ patch: { signupCutoffHours: 48 } })
    expect(parseSetEventArgs(['--workshop', 'c', '--cutoff', 'default'])).toMatchObject({ patch: { signupCutoffHours: null } })
    expect(parseSetEventArgs(['--workshop', 'c', '--cutoff', '2.5'])).toEqual({ error: 'Sign-ups close 0 to 336 hours before the class, in whole hours.' })
  })

  it('refuses questions or a cutoff on a party', () => {
    expect(parseSetEventArgs(['--party', 'bk_1', '--option', 'A=B|C'])).toEqual({ error: 'Questions for each seat are for classes (--workshop) only.' })
    expect(parseSetEventArgs(['--party', 'bk_1', '--cutoff', '24'])).toEqual({ error: 'Sign-up cutoffs are for classes (--workshop) only.' })
  })

  it('refuses an --option without "Label=Choices"', () => {
    expect(parseSetEventArgs(['--workshop', 'c', '--option', 'Pumpkin color'])).toEqual({ error: '--option needs "Label=Choice|Choice", got "Pumpkin color".' })
  })

  it('--show only reads', () => {
    expect(parseSetEventArgs(['--workshop', 'c', '--show'])).toEqual({ kind: 'workshop', id: 'c', show: true, patch: {} })
  })
})

describe('classifyBlobRead', () => {
  it('the missing-key message (exit 0, on stderr) is missing', () => {
    expect(classifyBlobRead('', 'Error: Blob event-meta-workshop:c does not exist in store event-meta', 0)).toBe('missing')
  })
  it('a JSON body is ok', () => {
    expect(classifyBlobRead('{"dropOff":true}', '', 0)).toBe('ok')
    expect(classifyBlobRead('Reading…\n{"dropOff":true}', '', 0)).toBe('ok')
  })
  it('anything else is an error', () => {
    expect(classifyBlobRead('', 'Error: not logged in', 1)).toBe('error')
    expect(classifyBlobRead('', 'ENOTFOUND api.netlify.com', 0)).toBe('error')
    expect(classifyBlobRead('{oops', '', 0)).toBe('error')
  })
})

describe('echoOptionIds', () => {
  const o = (id: string, label: string) => ({ id, label, choices: ['x', 'y'] })
  const ids = (l: ReturnType<typeof echoOptionIds>) => l.map((x) => x.id)
  it('rename at the same position keeps the id', () => {
    expect(ids(echoOptionIds([o('a', 'A')], [o('', 'A2')]))).toEqual(['a'])
  })
  it('reorder keeps both ids', () => {
    expect(ids(echoOptionIds([o('a', 'A'), o('b', 'B')], [o('', 'B'), o('', 'A')]))).toEqual(['b', 'a'])
  })
  it('rename plus reorder gives the renamed one a fresh id', () => {
    expect(ids(echoOptionIds([o('a', 'A'), o('b', 'B')], [o('', 'B'), o('', 'A2')]))).toEqual(['b', ''])
  })
  it('case-only relabel keeps the id', () => {
    expect(ids(echoOptionIds([o('a', 'Pumpkin color')], [o('', 'pumpkin COLOR')]))).toEqual(['a'])
  })
  it('no current questions leaves all ids empty', () => {
    expect(ids(echoOptionIds([], [o('', 'A'), o('', 'B')]))).toEqual(['', ''])
  })
})
