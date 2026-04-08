import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }))

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, default: { ...actual, lookup: mockLookup } }
})

import { ssrfInternals, validateSSRF } from './ssrf.js'

describe('ssrf internals', () => {
  describe('blocked IPv4', () => {
    it('blocks standard private ranges', () => {
      expect(ssrfInternals.isBlockedIp('10.0.0.1')).toBe(true)
      expect(ssrfInternals.isBlockedIp('10.255.255.255')).toBe(true)
      expect(ssrfInternals.isBlockedIp('172.16.1.2')).toBe(true)
      expect(ssrfInternals.isBlockedIp('172.31.255.255')).toBe(true)
      expect(ssrfInternals.isBlockedIp('192.168.1.1')).toBe(true)
      expect(ssrfInternals.isBlockedIp('192.168.0.0')).toBe(true)
    })

    it('blocks 0.0.0.0 range', () => {
      expect(ssrfInternals.isBlockedIp('0.0.0.0')).toBe(true)
      expect(ssrfInternals.isBlockedIp('0.255.255.255')).toBe(true)
    })

    it('blocks localhost 127.x.x.x', () => {
      expect(ssrfInternals.isBlockedIp('127.0.0.1')).toBe(true)
      expect(ssrfInternals.isBlockedIp('127.255.255.255')).toBe(true)
    })

    it('blocks cloud metadata endpoint 169.254.169.254 (AWS)', () => {
      expect(ssrfInternals.isBlockedIp('169.254.169.254')).toBe(true)
    })

    it('blocks link-local 169.254.x.x range', () => {
      expect(ssrfInternals.isBlockedIp('169.254.0.1')).toBe(true)
      expect(ssrfInternals.isBlockedIp('169.254.255.255')).toBe(true)
    })

    it('blocks carrier-grade NAT 100.64.0.0/10', () => {
      expect(ssrfInternals.isBlockedIp('100.64.0.1')).toBe(true)
      expect(ssrfInternals.isBlockedIp('100.127.255.255')).toBe(true)
    })
  })

  describe('allowed IPv4', () => {
    it('allows public IPs', () => {
      expect(ssrfInternals.isBlockedIp('8.8.8.8')).toBe(false)
      expect(ssrfInternals.isBlockedIp('1.1.1.1')).toBe(false)
      expect(ssrfInternals.isBlockedIp('93.184.216.34')).toBe(false)
    })

    it('allows public IPs adjacent to blocked ranges', () => {
      expect(ssrfInternals.isBlockedIp('172.32.0.0')).toBe(false)
      expect(ssrfInternals.isBlockedIp('169.255.0.0')).toBe(false)
      expect(ssrfInternals.isBlockedIp('100.128.0.0')).toBe(false)
    })
  })

  describe('blocked IPv6', () => {
    it('blocks loopback ::1', () => {
      expect(ssrfInternals.isBlockedIp('::1')).toBe(true)
    })

    it('blocks unspecified address ::', () => {
      expect(ssrfInternals.isBlockedIp('::')).toBe(true)
    })

    it('blocks unique local fc00::/7', () => {
      expect(ssrfInternals.isBlockedIp('fc00::1')).toBe(true)
      expect(ssrfInternals.isBlockedIp('fd12::1')).toBe(true)
    })

    it('blocks link-local fe80::/10', () => {
      expect(ssrfInternals.isBlockedIp('fe80::1')).toBe(true)
      expect(ssrfInternals.isBlockedIp('fe90::1')).toBe(true)
      expect(ssrfInternals.isBlockedIp('fea0::1')).toBe(true)
      expect(ssrfInternals.isBlockedIp('feb0::1')).toBe(true)
    })

    it('blocks IPv4-mapped IPv6 for private addresses', () => {
      expect(ssrfInternals.isBlockedIp('::ffff:127.0.0.1')).toBe(true)
      expect(ssrfInternals.isBlockedIp('::ffff:10.0.0.1')).toBe(true)
      expect(ssrfInternals.isBlockedIp('::ffff:169.254.169.254')).toBe(true)
    })

    it('allows IPv4-mapped IPv6 for public addresses', () => {
      expect(ssrfInternals.isBlockedIp('::ffff:8.8.8.8')).toBe(false)
    })
  })

  describe('non-IP input', () => {
    it('blocks non-IP strings', () => {
      expect(ssrfInternals.isBlockedIp('not-an-ip')).toBe(true)
    })
  })
})

describe('validateSSRF', () => {
  afterEach(() => {
    mockLookup.mockReset()
  })

  it('rejects non-HTTPS URLs', async () => {
    await expect(validateSSRF('http://example.com')).rejects.toThrow('HTTPS required')
  })

  it('rejects direct private IP in URL', async () => {
    await expect(validateSSRF('https://127.0.0.1/path')).rejects.toThrow('Blocked target address')
    await expect(validateSSRF('https://0.0.0.0')).rejects.toThrow('Blocked target address')
    await expect(validateSSRF('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      'Blocked target address',
    )
  })

  it('rejects private IPs with ports and paths', async () => {
    await expect(validateSSRF('https://10.0.0.1:8443/api')).rejects.toThrow(
      'Blocked target address',
    )
  })

  it('rejects hostnames that resolve to blocked IPs', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])

    await expect(validateSSRF('https://metadata.google.internal/')).rejects.toThrow(
      'Blocked target address',
    )
  })

  it('allows valid public HTTPS URLs', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

    await expect(validateSSRF('https://example.com')).resolves.toBeUndefined()
  })
})
