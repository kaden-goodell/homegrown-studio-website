export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  source: string
  message: string
  data?: Record<string, any>
  duration_ms?: number
  provider?: string
  is_internal_api?: boolean
}

export function createLogger(source: string) {
  function makeEntry(level: LogEntry['level'], message: string, data?: Record<string, any>): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      ...(data !== undefined && { data }),
    }
  }

  return {
    info(message: string, data?: Record<string, any>) {
      console.log(JSON.stringify(makeEntry('info', message, data)))
    },
    warn(message: string, data?: Record<string, any>) {
      console.warn(JSON.stringify(makeEntry('warn', message, data)))
    },
    error(message: string, data?: Record<string, any>) {
      console.error(JSON.stringify(makeEntry('error', message, data)))
    },
  }
}
