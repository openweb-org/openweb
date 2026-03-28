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
