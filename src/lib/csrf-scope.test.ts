import { describe, expect, it } from 'vitest'

import { shouldApplyCsrf } from '../lib/csrf-scope.js'

describe('shouldApplyCsrf', () => {
  it('applies to mutations by default when no scope defined', () => {
    expect(shouldApplyCsrf(undefined, 'POST')).toBe(true)
    expect(shouldApplyCsrf(undefined, 'PUT')).toBe(true)
    expect(shouldApplyCsrf(undefined, 'PATCH')).toBe(true)
    expect(shouldApplyCsrf(undefined, 'DELETE')).toBe(true)
  })

  it('does not apply to GET by default', () => {
    expect(shouldApplyCsrf(undefined, 'GET')).toBe(false)
    expect(shouldApplyCsrf(undefined, 'HEAD')).toBe(false)
  })

  it('respects explicit scope', () => {
    const scope = ['POST', 'PUT']
    expect(shouldApplyCsrf(scope, 'POST')).toBe(true)
    expect(shouldApplyCsrf(scope, 'DELETE')).toBe(false)
    expect(shouldApplyCsrf(scope, 'GET')).toBe(false)
  })

  it('scope matching is case-insensitive', () => {
    expect(shouldApplyCsrf(['post'], 'POST')).toBe(true)
    expect(shouldApplyCsrf(['POST'], 'post')).toBe(true)
  })
})
