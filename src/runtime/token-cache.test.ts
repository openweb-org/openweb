import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it, afterEach } from 'vitest'

import {
  readTokenCache,
  writeTokenCache,
  clearTokenCache,
  clearAllTokenCache,
  extractJwtExp,
  type CachedTokens,
} from './token-cache.js'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'openweb-token-test-'))
}

function sampleTokens(overrides?: Partial<CachedTokens>): CachedTokens {
  return {
    cookies: [{ name: 'session', value: 'abc', domain: '.example.com', path: '/' }],
    localStorage: { token: 'jwt_xyz' },
    sessionStorage: {},
    capturedAt: new Date().toISOString(),
    ttlSeconds: 3600,
    ...overrides,
  }
}

describe('token cache', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  it('read returns null when cache does not exist', async () => {
    const dir = makeTempDir()
    dirs.push(dir)
    const result = await readTokenCache('nonexistent', dir)
    expect(result).toBeNull()
  })

  it('write then read returns cached tokens', async () => {
    const dir = makeTempDir()
    dirs.push(dir)
    const tokens = sampleTokens()
    await writeTokenCache('test-site', tokens, dir)
    const result = await readTokenCache('test-site', dir)
    expect(result).not.toBeNull()
    expect(result!.cookies[0]!.name).toBe('session')
    expect(result!.localStorage.token).toBe('jwt_xyz')
  })

  it('read returns null when TTL expired', async () => {
    const dir = makeTempDir()
    dirs.push(dir)
    const tokens = sampleTokens({
      capturedAt: new Date(Date.now() - 7200_000).toISOString(), // 2 hours ago
      ttlSeconds: 3600, // 1 hour TTL
    })
    await writeTokenCache('expired-site', tokens, dir)
    const result = await readTokenCache('expired-site', dir)
    expect(result).toBeNull()
  })

  it('uses JWT exp for expiry when present', async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    // JWT exp in the future
    const futureExp = Math.floor(Date.now() / 1000) + 7200
    const tokens = sampleTokens({
      capturedAt: new Date(Date.now() - 7200_000).toISOString(), // 2h ago
      ttlSeconds: 1, // Would be expired by TTL
      jwtExp: futureExp,
    })
    await writeTokenCache('jwt-site', tokens, dir)
    const result = await readTokenCache('jwt-site', dir)
    expect(result).not.toBeNull() // JWT exp not yet reached
  })

  it('returns null when JWT exp is in the past', async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    const pastExp = Math.floor(Date.now() / 1000) - 60 // 1 minute ago
    const tokens = sampleTokens({
      jwtExp: pastExp,
    })
    await writeTokenCache('expired-jwt', tokens, dir)
    const result = await readTokenCache('expired-jwt', dir)
    expect(result).toBeNull()
  })

  it('clear removes site cache', async () => {
    const dir = makeTempDir()
    dirs.push(dir)
    await writeTokenCache('clear-test', sampleTokens(), dir)
    expect(await readTokenCache('clear-test', dir)).not.toBeNull()
    await clearTokenCache('clear-test', dir)
    expect(await readTokenCache('clear-test', dir)).toBeNull()
  })

  it('clearAll removes all caches', async () => {
    const dir = makeTempDir()
    dirs.push(dir)
    await writeTokenCache('site-a', sampleTokens(), dir)
    await writeTokenCache('site-b', sampleTokens(), dir)
    await clearAllTokenCache(dir)
    expect(await readTokenCache('site-a', dir)).toBeNull()
    expect(await readTokenCache('site-b', dir)).toBeNull()
  })
})

describe('extractJwtExp', () => {
  it('extracts exp from valid JWT', () => {
    // Create a simple JWT with exp claim
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ exp: 1700000000, sub: 'user' })).toString('base64url')
    const token = `${header}.${payload}.signature`
    expect(extractJwtExp(token)).toBe(1700000000)
  })

  it('returns undefined for non-JWT string', () => {
    expect(extractJwtExp('not-a-jwt')).toBeUndefined()
  })

  it('returns undefined when no exp claim', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ sub: 'user' })).toString('base64url')
    const token = `${header}.${payload}.signature`
    expect(extractJwtExp(token)).toBeUndefined()
  })
})
