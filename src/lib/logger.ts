/**
 * Minimal logger respecting OPENWEB_DEBUG env var.
 *
 * - debug(): only outputs when OPENWEB_DEBUG=1
 * - warn():  always outputs to stderr
 * - error(): always outputs to stderr
 */

function isDebug(): boolean {
  return process.env.OPENWEB_DEBUG === '1'
}

function formatMessage(level: string, msg: string): string {
  return `[openweb:${level}] ${msg}\n`
}

export const logger = {
  debug(msg: string): void {
    if (isDebug()) {
      process.stderr.write(formatMessage('debug', msg))
    }
  },
  warn(msg: string): void {
    process.stderr.write(formatMessage('warn', msg))
  },
  error(msg: string): void {
    process.stderr.write(formatMessage('error', msg))
  },
} as const
