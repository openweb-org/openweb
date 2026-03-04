import { describe, expect, it } from 'vitest'

import { ssrfInternals } from './ssrf.js'

describe('ssrf internals', () => {
  it('blocks private IPv4 ranges', () => {
    expect(ssrfInternals.isBlockedIp('10.0.0.1')).toBe(true)
    expect(ssrfInternals.isBlockedIp('172.16.1.2')).toBe(true)
    expect(ssrfInternals.isBlockedIp('192.168.1.1')).toBe(true)
    expect(ssrfInternals.isBlockedIp('169.254.169.254')).toBe(true)
  })

  it('allows public IPv4', () => {
    expect(ssrfInternals.isBlockedIp('8.8.8.8')).toBe(false)
  })

  it('blocks private IPv6 ranges', () => {
    expect(ssrfInternals.isBlockedIp('::1')).toBe(true)
    expect(ssrfInternals.isBlockedIp('fc00::1')).toBe(true)
    expect(ssrfInternals.isBlockedIp('fe80::1')).toBe(true)
  })
})
