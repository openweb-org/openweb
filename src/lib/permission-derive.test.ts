import { describe, it, expect } from 'vitest'
import { derivePermissionFromMethod } from './permission-derive.js'

describe('derivePermissionFromMethod', () => {
  it('returns read for GET', () => {
    expect(derivePermissionFromMethod('GET', '/api/feed')).toBe('read')
  })

  it('returns write for POST', () => {
    expect(derivePermissionFromMethod('POST', '/api/posts')).toBe('write')
  })

  it('returns delete for DELETE', () => {
    expect(derivePermissionFromMethod('DELETE', '/api/items/1')).toBe('delete')
  })

  it('returns transact for GET /checkout', () => {
    expect(derivePermissionFromMethod('GET', '/api/checkout')).toBe('transact')
  })

  it('returns transact for POST /purchase', () => {
    expect(derivePermissionFromMethod('POST', '/api/purchase')).toBe('transact')
  })

  it('returns transact for paths with payment', () => {
    expect(derivePermissionFromMethod('GET', '/v1/payment/status')).toBe('transact')
  })

  it('returns transact for paths with order', () => {
    expect(derivePermissionFromMethod('POST', '/api/order/create')).toBe('transact')
  })

  it('returns transact for paths with subscribe', () => {
    expect(derivePermissionFromMethod('POST', '/api/subscribe')).toBe('transact')
  })

  it('does not false-positive on partial matches', () => {
    expect(derivePermissionFromMethod('GET', '/api/checkoutput')).toBe('read') // /checkout\b doesn't match /checkoutput
    expect(derivePermissionFromMethod('GET', '/api/orders')).toBe('read') // /order\b doesn't match /orders
  })
})
