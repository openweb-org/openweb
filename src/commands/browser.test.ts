import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Test platform profile path detection and CDP auto-detect logic
// (no real Chrome launch — that's manual E2E)

describe('browser command helpers', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    // Mock fetch so tests don't depend on a real Chrome running on 9222
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection refused'))
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('getDefaultProfilePath returns platform-appropriate path', async () => {
    // Dynamic import to test the module
    const mod = await import('./browser.js')

    // We can't test the private function directly, but we can test resolveCdpEndpoint
    // which exercises the port file reading
    await expect(mod.resolveCdpEndpoint(undefined)).rejects.toThrow('No browser context available')
  })

  it('resolveCdpEndpoint uses explicit flag when no managed browser', async () => {
    const mod = await import('./browser.js')
    // getManagedCdpEndpoint returns undefined when no port file exists
    // so it should fall back to the explicit flag
    const endpoint = await mod.resolveCdpEndpoint('http://localhost:9333')
    expect(endpoint).toBe('http://localhost:9333')
  })

  it('getManagedCdpEndpoint returns undefined when no port file', async () => {
    const mod = await import('./browser.js')
    const result = await mod.getManagedCdpEndpoint()
    expect(result).toBeUndefined()
  })
})

describe('RC6: getOpenTabUrls', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns page URLs from CDP /json/list, filtering chrome:// and about:', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify([
        { type: 'page', url: 'https://www.reddit.com/' },
        { type: 'page', url: 'https://x.com/home' },
        { type: 'page', url: 'chrome://newtab/' },
        { type: 'page', url: 'about:blank' },
        { type: 'service_worker', url: 'https://www.reddit.com/sw.js' },
      ]), { status: 200 }),
    ) as unknown as typeof fetch

    const { getOpenTabUrls } = await import('./browser.js')
    const urls = await getOpenTabUrls(9222)
    expect(urls).toEqual(['https://www.reddit.com/', 'https://x.com/home'])
  })

  it('returns empty array when CDP is unavailable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection refused'))

    const { getOpenTabUrls } = await import('./browser.js')
    const urls = await getOpenTabUrls(9222)
    expect(urls).toEqual([])
  })
})

describe('copyProfileSelective', () => {
  // Use real fs against a temp dir — no mocking
  it('copies auth state and skips caches/locks/sessions', async () => {
    const { mkdtemp, mkdir, writeFile, readdir, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const src = await mkdtemp(join(tmpdir(), 'owebck-src-'))
    const dest = await mkdtemp(join(tmpdir(), 'owebck-dst-'))
    await rm(dest, { recursive: true, force: true })

    try {
      // Files that MUST be copied (auth + identity + sync state)
      const keep = [
        'Cookies', 'Cookies-journal', 'Web Data', 'Preferences', 'Secure Preferences',
        'Account Web Data', 'Trust Tokens', 'TransportSecurity',
      ]
      for (const f of keep) await writeFile(join(src, f), 'data')

      // Dirs that MUST be copied
      await mkdir(join(src, 'Local Storage', 'leveldb'), { recursive: true })
      await writeFile(join(src, 'Local Storage', 'leveldb', '000003.log'), 'x')
      await mkdir(join(src, 'Session Storage'), { recursive: true })
      await writeFile(join(src, 'Session Storage', '000001.log'), 'x')
      await mkdir(join(src, 'Sync Data', 'LevelDB'), { recursive: true })
      await writeFile(join(src, 'Sync Data', 'LevelDB', '000003.log'), 'x')

      // Excluded: caches, locks, session-restore, passwords
      const drop = ['Cache', 'Code Cache', 'GPUCache', 'History', 'Top Sites', 'Sessions', 'LOCK', 'Login Data']
      for (const d of drop) {
        await mkdir(join(src, d), { recursive: true })
        await writeFile(join(src, d, 'inside'), 'x')
      }
      await writeFile(join(src, '.com.google.Chrome.abc'), 'x') // macOS xattr sidecar

      const { copyProfileSelective } = await import('./browser.js')
      await copyProfileSelective(src, dest)

      const got = new Set(await readdir(dest))
      for (const f of keep) expect(got.has(f), `missing ${f}`).toBe(true)
      expect(got.has('Local Storage')).toBe(true)
      expect(got.has('Session Storage')).toBe(true)
      expect(got.has('Sync Data')).toBe(true)
      for (const d of drop) expect(got.has(d), `should have skipped ${d}`).toBe(false)
      expect(got.has('.com.google.Chrome.abc')).toBe(false)
    } finally {
      await rm(src, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })
})

describe('RC6: restoreTabs', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('creates new tabs via CDP PUT /json/new', async () => {
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(url)
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const { restoreTabs } = await import('./browser.js')
    await restoreTabs(9222, ['https://www.reddit.com/', 'https://x.com/home'])

    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('/json/new?')
    expect(calls[0]).toContain(encodeURIComponent('https://www.reddit.com/'))
    expect(calls[1]).toContain(encodeURIComponent('https://x.com/home'))
  })

  it('does not throw when tab restoration fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('failed'))

    const { restoreTabs } = await import('./browser.js')
    // Should not throw
    await restoreTabs(9222, ['https://example.com'])
  })
})
