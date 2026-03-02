import { describe, it, expect, vi } from 'vitest'
import { createLogger } from '@lib/logger'

describe('logger', () => {
  it('creates logger with source', () => {
    const logger = createLogger('api:workshops:list')
    expect(logger.info).toBeTypeOf('function')
    expect(logger.warn).toBeTypeOf('function')
    expect(logger.error).toBeTypeOf('function')
  })

  it('info log includes source and timestamp', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('test:source')
    logger.info('hello', { count: 5 })
    expect(spy).toHaveBeenCalledOnce()
    const logged = JSON.parse(spy.mock.calls[0][0])
    expect(logged.source).toBe('test:source')
    expect(logged.level).toBe('info')
    expect(logged.message).toBe('hello')
    expect(logged.data.count).toBe(5)
    expect(logged.timestamp).toBeTruthy()
    spy.mockRestore()
  })

  it('error log uses console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logger = createLogger('test:source')
    logger.error('bad thing', { error: 'oops' })
    expect(spy).toHaveBeenCalledOnce()
    const logged = JSON.parse(spy.mock.calls[0][0])
    expect(logged.level).toBe('error')
    spy.mockRestore()
  })

  it('supports is_internal_api flag', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('provider:square:capacity')
    logger.info('fetched', { is_internal_api: true })
    const logged = JSON.parse(spy.mock.calls[0][0])
    expect(logged.data.is_internal_api).toBe(true)
    spy.mockRestore()
  })
})
