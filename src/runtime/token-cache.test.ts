import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it, afterEach } from 'vitest'

import {
  readTokenCache,
  writeTokenCache,
  clearTokenCache,
  clearAllTokenCache,
  extractJwtExp,
  _activeLockCount,
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
    expect(result?.cookies[0]?.name).toBe('session')
    expect(result?.localStorage.token).toBe('jwt_xyz')
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

  it('returns null when ttl_seconds is zero or negative', async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    const tokens = sampleTokens({ ttlSeconds: 0 })
    await writeTokenCache('zero-ttl', tokens, dir)
    const result = await readTokenCache('zero-ttl', dir)
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

describe('encrypted token cache', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  it('encrypted round-trip preserves all fields', async () => {
    const dir = makeTempDir()
    dirs.push(dir)
    const futureExp = Math.floor(Date.now() / 1000) + 7200
    const tokens = sampleTokens({ jwtExp: futureExp })
    await writeTokenCache('rt-site', tokens, dir)
    const result = await readTokenCache('rt-site', dir)
    expect(result).toEqual(tokens)
  })

  it('writes vault.json (not plaintext files)', async () => {
    const dir = makeTempDir()
    dirs.push(dir)
    await writeTokenCache('fmt-site', sampleTokens(), dir)
    expect(existsSync(join(dir, 'fmt-site', 'vault.json'))).toBe(true)
    expect(existsSync(join(dir, 'fmt-site', 'meta.json'))).toBe(false)
    expect(existsSync(join(dir, 'fmt-site', 'cookies.json'))).toBe(false)
    expect(existsSync(join(dir, 'fmt-site', 'storage.json'))).toBe(false)
  })

  it('creates .salt in token root', async () => {
    const dir = makeTempDir()
    dirs.push(dir)
    await writeTokenCache('salt-site', sampleTokens(), dir)
    const salt = readFileSync(join(dir, '.salt'))
    expect(salt.length).toBe(32)
  })

  it('fresh IV: two writes produce different ciphertext', async () => {
    const dir = makeTempDir()
    dirs.push(dir)
    const tokens = sampleTokens()

    await writeTokenCache('iv-site', tokens, dir)
    const vault1 = readFileSync(join(dir, 'iv-site', 'vault.json'), 'utf8')

    await writeTokenCache('iv-site', tokens, dir)
    const vault2 = readFileSync(join(dir, 'iv-site', 'vault.json'), 'utf8')

    const env1 = JSON.parse(vault1) as { iv: string; ciphertext: string }
    const env2 = JSON.parse(vault2) as { iv: string; ciphertext: string }
    expect(env1.iv).not.toBe(env2.iv)
    expect(env1.ciphertext).not.toBe(env2.ciphertext)
  })

  it('tamper detection: modified ciphertext returns null', async () => {
    const dir = makeTempDir()
    dirs.push(dir)
    await writeTokenCache('tamper-site', sampleTokens(), dir)

    const vaultPath = join(dir, 'tamper-site', 'vault.json')
    const envelope = JSON.parse(readFileSync(vaultPath, 'utf8')) as Record<string, unknown>
    // Flip a character in the ciphertext
    const ct = envelope.ciphertext as string
    envelope.ciphertext = ct.slice(0, -1) + (ct.at(-1) === 'A' ? 'B' : 'A')
    writeFileSync(vaultPath, JSON.stringify(envelope))

    const result = await readTokenCache('tamper-site', dir)
    expect(result).toBeNull()
    // Site dir should be cleaned up
    expect(existsSync(join(dir, 'tamper-site'))).toBe(false)
  })

  it('clearAllTokenCache invalidates .salt and in-memory key cache', async () => {
    const dir = makeTempDir()
    dirs.push(dir)
    await writeTokenCache('inv-site', sampleTokens(), dir)

    // Salt exists before clear
    expect(existsSync(join(dir, '.salt'))).toBe(true)

    await clearAllTokenCache(dir)

    // Salt and data gone
    expect(existsSync(join(dir, '.salt'))).toBe(false)
    expect(existsSync(dir)).toBe(false)

    // Write again → new salt → still readable (key cache was invalidated)
    await writeTokenCache('inv-site', sampleTokens(), dir)
    const result = await readTokenCache('inv-site', dir)
    expect(result).not.toBeNull()
  })

  it('multi-baseDir isolation: different baseDirs do not interfere', async () => {
    const dir1 = makeTempDir()
    const dir2 = makeTempDir()
    dirs.push(dir1, dir2)

    const tokens1 = sampleTokens({ localStorage: { k: 'from-dir1' } })
    const tokens2 = sampleTokens({ localStorage: { k: 'from-dir2' } })

    await writeTokenCache('shared-name', tokens1, dir1)
    await writeTokenCache('shared-name', tokens2, dir2)

    const r1 = await readTokenCache('shared-name', dir1)
    const r2 = await readTokenCache('shared-name', dir2)
    expect(r1?.localStorage.k).toBe('from-dir1')
    expect(r2?.localStorage.k).toBe('from-dir2')
  })

  it('expired cache cleanup: write with past expiry clears and returns null', async () => {
    const dir = makeTempDir()
    dirs.push(dir)
    const tokens = sampleTokens({
      capturedAt: new Date(Date.now() - 7200_000).toISOString(),
      ttlSeconds: 3600,
    })
    await writeTokenCache('exp-cleanup', tokens, dir)
    const result = await readTokenCache('exp-cleanup', dir)
    expect(result).toBeNull()
    // Site dir should be cleaned up on expired read
    expect(existsSync(join(dir, 'exp-cleanup'))).toBe(false)
  })

  it('vault.json envelope has expected fields', async () => {
    const dir = makeTempDir()
    dirs.push(dir)
    await writeTokenCache('env-site', sampleTokens(), dir)

    const envelope = JSON.parse(readFileSync(join(dir, 'env-site', 'vault.json'), 'utf8')) as Record<string, unknown>
    expect(envelope.version).toBe(1)
    expect(envelope.alg).toBe('aes-256-gcm')
    expect(envelope.kdf).toBe('pbkdf2-sha256')
    expect(envelope.iterations).toBe(210_000)
    expect(typeof envelope.iv).toBe('string')
    expect(typeof envelope.tag).toBe('string')
    expect(typeof envelope.ciphertext).toBe('string')
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

describe('token cache race condition', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  it('concurrent writes to the same site do not corrupt cache', async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    const writes = Array.from({ length: 20 }, (_, i) =>
      writeTokenCache('race-site', sampleTokens({ localStorage: { idx: String(i) } }), dir),
    )
    await Promise.all(writes)

    // After all concurrent writes, the cache must be readable (not corrupted)
    const result = await readTokenCache('race-site', dir)
    expect(result).not.toBeNull()
    expect(result?.cookies[0]?.name).toBe('session')
    // The value should be from one of the 20 writes (last writer wins)
    const idx = Number(result?.localStorage.idx)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(20)
  })

  it('concurrent reads and writes do not throw or corrupt', async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    // Seed the cache
    await writeTokenCache('rw-site', sampleTokens(), dir)

    const ops: Promise<unknown>[] = []
    for (let i = 0; i < 10; i++) {
      ops.push(readTokenCache('rw-site', dir))
      ops.push(writeTokenCache('rw-site', sampleTokens({ localStorage: { v: String(i) } }), dir))
    }
    const results = await Promise.all(ops)

    // All reads should return valid tokens or null (never throw)
    for (let i = 0; i < results.length; i += 2) {
      const read = results[i] as CachedTokens | null
      if (read !== null) {
        expect(read.cookies[0]?.name).toBe('session')
      }
    }

    // Final state should be readable
    const final = await readTokenCache('rw-site', dir)
    expect(final).not.toBeNull()
  })

  it('different sites are not blocked by each other', async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    // Concurrent writes to different sites should all succeed independently
    const sites = ['site-a', 'site-b', 'site-c']
    const writes = sites.map((s) => writeTokenCache(s, sampleTokens({ localStorage: { site: s } }), dir))
    await Promise.all(writes)

    for (const s of sites) {
      const result = await readTokenCache(s, dir)
      expect(result).not.toBeNull()
      expect(result?.localStorage.site).toBe(s)
    }
  })

  it('locks are cleaned up after operations complete', async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    await writeTokenCache('cleanup-site', sampleTokens(), dir)
    await readTokenCache('cleanup-site', dir)

    // All locks should be released
    expect(_activeLockCount()).toBe(0)
  })
})
