import { describe, expect, it } from 'vitest'

import { getValueAtPath, setValueAtPath } from './value-path.js'

describe('getValueAtPath', () => {
  it('reads nested object paths', () => {
    const value = getValueAtPath(
      {
        data: {
          viewer: {
            profile: {
              displayName: 'moonkey',
            },
          },
        },
      },
      'data.viewer.profile.displayName',
    )

    expect(value).toBe('moonkey')
  })

  it('reads numeric array segments', () => {
    const value = getValueAtPath(
      {
        data: {
          items: [
            { id: 'a' },
            { id: 'b' },
          ],
        },
      },
      'data.items.1.id',
    )

    expect(value).toBe('b')
  })

  it('returns the input for an empty path', () => {
    const payload = { ok: true }

    expect(getValueAtPath(payload, '')).toBe(payload)
  })

  it('returns undefined for missing segments', () => {
    expect(getValueAtPath({ data: {} }, 'data.viewer.id')).toBeUndefined()
  })

  it('ignores empty path segments', () => {
    expect(getValueAtPath({ data: { viewer: { id: 'user-1' } } }, 'data..viewer.id')).toBe('user-1')
  })

  it('returns undefined for negative array indexes', () => {
    expect(getValueAtPath({ items: ['a', 'b'] }, 'items.-1')).toBeUndefined()
  })

  it('returns undefined when a primitive appears before the path ends', () => {
    expect(getValueAtPath({ data: { viewer: 'moonkey' } }, 'data.viewer.id')).toBeUndefined()
  })
})

describe('setValueAtPath', () => {
  it('sets a top-level key', () => {
    const result = setValueAtPath({ a: 1 }, 'b', 2)
    expect(result).toEqual({ a: 1, b: 2 })
  })

  it('sets a nested key, creating intermediate objects', () => {
    const result = setValueAtPath({}, 'variables.cursor', 'abc')
    expect(result).toEqual({ variables: { cursor: 'abc' } })
  })

  it('preserves existing sibling keys in nested objects', () => {
    const result = setValueAtPath(
      { variables: { limit: 10 } },
      'variables.cursor',
      'xyz',
    )
    expect(result).toEqual({ variables: { limit: 10, cursor: 'xyz' } })
  })

  it('does not mutate the original object', () => {
    const original = { variables: { limit: 10 } }
    const result = setValueAtPath(original, 'variables.cursor', 'abc')
    expect(original).toEqual({ variables: { limit: 10 } })
    expect(result.variables).not.toBe(original.variables)
  })

  it('overwrites non-object intermediate with new object', () => {
    const result = setValueAtPath({ variables: 'old' }, 'variables.cursor', 'abc')
    expect(result).toEqual({ variables: { cursor: 'abc' } })
  })

  it('handles deeply nested paths', () => {
    const result = setValueAtPath({}, 'a.b.c.d', 42)
    expect(result).toEqual({ a: { b: { c: { d: 42 } } } })
  })

  it('returns input unchanged for empty path', () => {
    const input = { x: 1 }
    expect(setValueAtPath(input, '', 99)).toEqual({ x: 1 })
  })

  it('overwrites an existing leaf value', () => {
    const result = setValueAtPath({ a: { b: 1 } }, 'a.b', 2)
    expect(result).toEqual({ a: { b: 2 } })
  })

  it('replaces array intermediate with object', () => {
    const result = setValueAtPath({ a: [1, 2] }, 'a.x', 3)
    expect(result).toEqual({ a: { x: 3 } })
  })

  it('rejects __proto__ path segments', () => {
    const result = setValueAtPath({}, '__proto__.polluted', true)
    expect(result).toEqual({})
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('rejects constructor.prototype path segments', () => {
    const result = setValueAtPath({}, 'constructor.prototype.polluted', true)
    expect(result).toEqual({})
  })
})
