import { describe, it, expect } from 'vitest'

import { computeResponseFingerprint } from './fingerprint.js'

describe('computeResponseFingerprint', () => {
  it('returns a 16-char hex string', () => {
    const fp = computeResponseFingerprint({ id: 1, name: 'test' })
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })

  it('produces same fingerprint for same shape', () => {
    const a = computeResponseFingerprint({ id: 1, name: 'alice' })
    const b = computeResponseFingerprint({ id: 2, name: 'bob' })
    expect(a).toBe(b)
  })

  it('produces different fingerprint when keys differ', () => {
    const a = computeResponseFingerprint({ id: 1, name: 'test' })
    const b = computeResponseFingerprint({ id: 1, email: 'test@x.com' })
    expect(a).not.toBe(b)
  })

  it('produces different fingerprint when value types differ', () => {
    const a = computeResponseFingerprint({ count: 42 })
    const b = computeResponseFingerprint({ count: '42' })
    expect(a).not.toBe(b)
  })

  it('handles arrays with element type', () => {
    const a = computeResponseFingerprint([{ id: 1 }, { id: 2 }])
    const b = computeResponseFingerprint([{ id: 3 }])
    expect(a).toBe(b)
  })

  it('handles empty arrays', () => {
    const fp = computeResponseFingerprint([])
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })

  it('handles null', () => {
    const fp = computeResponseFingerprint(null)
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })

  it('handles primitive responses', () => {
    const fp = computeResponseFingerprint('hello')
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is key-order independent', () => {
    const a = computeResponseFingerprint({ z: 1, a: 'x' })
    const b = computeResponseFingerprint({ a: 'y', z: 2 })
    expect(a).toBe(b)
  })
})
