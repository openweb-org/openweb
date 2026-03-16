import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TokenCache } from './token-cache.js'

describe('TokenCache', () => {
  it('returns undefined for missing key', () => {
    const cache = new TokenCache()
    expect(cache.get('nonexistent')).toBeUndefined()
  })

  it('returns cached value after set', () => {
    const cache = new TokenCache()
    const auth = { headers: { Authorization: 'Bearer abc' }, cookieString: 'sid=123' }

    cache.set('site-a', auth)
    const result = cache.get('site-a')

    expect(result).toBeDefined()
    expect(result!.headers).toEqual({ Authorization: 'Bearer abc' })
    expect(result!.cookieString).toBe('sid=123')
  })

  describe('TTL expiry', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('evicts entry after default TTL expires', () => {
      const cache = new TokenCache()
      cache.set('site-a', { headers: { Authorization: 'Bearer abc' } })

      expect(cache.get('site-a')).toBeDefined()

      vi.advanceTimersByTime(5 * 60 * 1000) // default TTL
      expect(cache.get('site-a')).toBeUndefined()
    })

    it('evicts entry after custom TTL expires', () => {
      const cache = new TokenCache()
      cache.set('site-a', { headers: { Authorization: 'Bearer abc' } }, 1000)

      expect(cache.get('site-a')).toBeDefined()

      vi.advanceTimersByTime(999)
      expect(cache.get('site-a')).toBeDefined()

      vi.advanceTimersByTime(1)
      expect(cache.get('site-a')).toBeUndefined()
    })
  })

  it('invalidate removes a specific key', () => {
    const cache = new TokenCache()
    cache.set('site-a', { headers: { 'X-Token': '1' } })
    cache.set('site-b', { headers: { 'X-Token': '2' } })

    cache.invalidate('site-a')

    expect(cache.get('site-a')).toBeUndefined()
    expect(cache.get('site-b')).toBeDefined()
    expect(cache.size).toBe(1)
  })

  it('invalidateAll clears every entry', () => {
    const cache = new TokenCache()
    cache.set('site-a', { headers: { 'X-Token': '1' } })
    cache.set('site-b', { headers: { 'X-Token': '2' } })

    cache.invalidateAll()

    expect(cache.get('site-a')).toBeUndefined()
    expect(cache.get('site-b')).toBeUndefined()
    expect(cache.size).toBe(0)
  })
})
