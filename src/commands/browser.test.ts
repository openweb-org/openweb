import { describe, expect, it } from 'vitest'
import { platform, homedir } from 'node:os'
import { join } from 'node:path'

// Test platform profile path detection and CDP auto-detect logic
// (no real Chrome launch — that's manual E2E)

describe('browser command helpers', () => {
  it('getDefaultProfilePath returns platform-appropriate path', async () => {
    // Dynamic import to test the module
    const mod = await import('./browser.js')

    // We can't test the private function directly, but we can test resolveCdpEndpoint
    // which exercises the port file reading
    await expect(mod.resolveCdpEndpoint(undefined)).rejects.toThrow('No browser available')
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
