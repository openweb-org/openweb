import { describe, expect, it } from 'vitest'

import { getValueAtPath } from './value-path.js'

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
