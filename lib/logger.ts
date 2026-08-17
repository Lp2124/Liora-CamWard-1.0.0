type LogLevel = 'info' | 'warn' | 'error' | 'debug'

class Logger {
  private format(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString()
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`
  }

  info(message: string, ...args: unknown[]): void {
    console.log(this.format('info', message), ...args)
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(this.format('warn', message), ...args)
  }

  error(message: string, ...args: unknown[]): void {
    console.error(this.format('error', message), ...args)
  }

  debug(message: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV === 'development') {
      console.debug(this.format('debug', message), ...args)
    }
  }
}

export const logger = new Logger()
