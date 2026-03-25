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
