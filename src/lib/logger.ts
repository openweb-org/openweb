/**
 * Minimal logger. Debug output controlled by config.json `debug` field.
 *
 * - debug(): only outputs when debug is enabled
 * - warn():  always outputs to stderr
 * - error(): always outputs to stderr
 */

import { loadConfig } from './config.js'

const debug = loadConfig().debug ?? false

function formatMessage(level: string, msg: string): string {
  return `[openweb:${level}] ${msg}\n`
}

export const logger = {
  debug(msg: string): void {
    if (debug) {
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
