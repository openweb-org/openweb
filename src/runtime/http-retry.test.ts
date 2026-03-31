import { describe, expect, it, vi, beforeEach } from 'vitest'

import { OpenWebError } from '../lib/errors.js'
import type { ExecuteResult } from './http-executor.js'
import { withHttpRetry, parseRetryAfter, enforceOriginSpacing } from './http-retry.js'

function makeResult(status = 200): ExecuteResult {
  return { status, body: {}, responseSchemaValid: true, responseHeaders: {} }
}

function retriableError(status: number, retryAfter?: string): OpenWebError {
  return new OpenWebError({
    error: 'execution_failed',
    code: 'EXECUTION_FAILED',
    message: `HTTP ${status}`,
    action: 'retry',
    retriable: true,
    failureClass: 'retriable',
    retryAfter,
  })
}

describe('parseRetryAfter', () => {
  it('parses integer seconds', () => {
    expect(parseRetryAfter('120')).toBe(120_000)
  })

  it('parses zero seconds', () => {
    expect(parseRetryAfter('0')).toBe(0)
  })

  it('parses HTTP-date', () => {
    const future = new Date(Date.now() + 5000).toUTCString()
    const ms = parseRetryAfter(future)
    expect(ms).toBeDefined()
    expect(ms).toBeGreaterThan(3000)
    expect(ms).toBeLessThanOrEqual(6000)
  })

  it('returns undefined for garbage', () => {
    expect(parseRetryAfter('not-a-date-or-number')).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(parseRetryAfter(undefined)).toBeUndefined()
  })
})

describe('withHttpRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue(makeResult())
    const result = await withHttpRetry(fn, 'test-site-ok')
    expect(result.status).toBe(200)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on 429 and succeeds on second attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(retriableError(429))
      .mockResolvedValue(makeResult())
    const result = await withHttpRetry(fn, 'test-site-429')
    expect(result.status).toBe(200)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on 5xx up to MAX_RETRIES then throws', async () => {
    const err = retriableError(503)
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withHttpRetry(fn, 'test-site-503')).rejects.toBe(err)
    // 1 initial + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-retriable errors (needs_login)', async () => {
    const err = new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: 'HTTP 401',
      action: 'login',
      retriable: true,
      failureClass: 'needs_login',
    })
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withHttpRetry(fn, 'test-site-401')).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not retry fatal errors', async () => {
    const err = new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'HTTP 400',
      action: 'check params',
      retriable: false,
      failureClass: 'fatal',
    })
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withHttpRetry(fn, 'test-site-fatal')).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not retry permission_denied', async () => {
    const err = new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'denied',
      action: 'fix permissions',
      retriable: false,
      failureClass: 'permission_denied',
    })
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withHttpRetry(fn, 'test-site-perm')).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('propagates non-OpenWebError exceptions immediately', async () => {
    const err = new TypeError('unexpected')
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withHttpRetry(fn, 'test-site-type')).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('uses Retry-After header when present', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(retriableError(429, '3'))
      .mockResolvedValue(makeResult())

    const start = Date.now()
    const result = await withHttpRetry(fn, 'test-site-ra')
    const elapsed = Date.now() - start

    expect(result.status).toBe(200)
    expect(fn).toHaveBeenCalledTimes(2)
    // Retry-After=3 means 3000ms delay; with fake timers advancing, check it waited
    expect(elapsed).toBeGreaterThanOrEqual(2500)
  })
})

describe('enforceOriginSpacing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  it('does not delay the first request to an origin', async () => {
    const start = Date.now()
    await enforceOriginSpacing('fresh-origin')
    expect(Date.now() - start).toBeLessThan(50)
  })
})
