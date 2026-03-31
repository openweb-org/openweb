import { describe, expect, it } from 'vitest'

import { normalizePath, normalizePathBatch } from './path-normalize.js'

describe('normalizePath', () => {
  it('normalizes numeric IDs', () => {
    const r = normalizePath('/users/123')
    expect(r.template).toBe('/users/{id}')
    expect(r.normalization).toEqual({
      originalPaths: ['/users/123'],
      normalizedSegments: [{ index: 2, kind: 'numeric' }],
    })
  })

  it('normalizes UUIDs', () => {
    const r = normalizePath('/items/550e8400-e29b-41d4-a716-446655440000')
    expect(r.template).toBe('/items/{id}')
    expect(r.normalization?.normalizedSegments[0].kind).toBe('uuid')
  })

  it('normalizes long hex strings', () => {
    const r = normalizePath('/commits/a1b2c3d4e5f6')
    expect(r.template).toBe('/commits/{id}')
    expect(r.normalization?.normalizedSegments[0].kind).toBe('hex')
  })

  it('preserves slugs', () => {
    const r = normalizePath('/articles/how-to-build')
    expect(r.template).toBe('/articles/how-to-build')
    expect(r.normalization).toBeUndefined()
  })

  it('normalizes mixed paths', () => {
    const r = normalizePath('/api/v1/users/123/posts/456')
    expect(r.template).toBe('/api/v1/users/{id}/posts/{id}')
    expect(r.normalization?.normalizedSegments).toEqual([
      { index: 4, kind: 'numeric' },
      { index: 6, kind: 'numeric' },
    ])
  })

  it('preserves version segments', () => {
    const r = normalizePath('/api/v1/data')
    expect(r.template).toBe('/api/v1/data')
    expect(r.normalization).toBeUndefined()
  })

  it('returns path as-is when nothing to normalize', () => {
    const r = normalizePath('/health')
    expect(r.template).toBe('/health')
    expect(r.normalization).toBeUndefined()
  })

  it('handles root path', () => {
    const r = normalizePath('/')
    expect(r.template).toBe('/')
    expect(r.normalization).toBeUndefined()
  })

  it('normalizes URN segments', () => {
    const r = normalizePath('/voyager/api/identity/dash/profiles/urn:li:fsd_profile:ACoAAAbuQnsBejyn4DxOpmqySclK6jFF50pSuMc')
    expect(r.template).toBe('/voyager/api/identity/dash/profiles/{id}')
    expect(r.normalization?.normalizedSegments[0].kind).toBe('urn')
  })
})

describe('normalizePathBatch', () => {
  it('learns parameterized segments from cross-sample variance', () => {
    const paths = ['/posts/abc-123', '/posts/def-456', '/posts/ghi-789']
    const result = normalizePathBatch(paths)

    for (const p of paths) {
      const r = result.get(p)
      expect(r?.template).toBe('/posts/{param}')
      expect(r?.normalization?.normalizedSegments).toEqual([{ index: 2, kind: 'learned' }])
    }
  })

  it('preserves pattern-matched normalization for numeric IDs', () => {
    const paths = ['/users/123', '/users/456']
    const result = normalizePathBatch(paths)

    // Already normalized via pattern matching — should use {id} not {param}
    expect(result.get('/users/123')?.template).toBe('/users/{id}')
    expect(result.get('/users/456')?.template).toBe('/users/{id}')
  })

  it('does not learn when paths differ in multiple segments', () => {
    const paths = ['/a/100/x', '/b/200/y']
    const result = normalizePathBatch(paths)

    // Multiple segments differ, no learning
    expect(result.get('/a/100/x')?.template).toBe('/a/{id}/x')
    expect(result.get('/b/200/y')?.template).toBe('/b/{id}/y')
  })

  it('does not learn from a single path', () => {
    const paths = ['/items/hello']
    const result = normalizePathBatch(paths)
    expect(result.get('/items/hello')?.template).toBe('/items/hello')
  })

  it('handles mix of pattern-matched and learned normalization', () => {
    const paths = ['/api/v1/users/123/posts/abc', '/api/v1/users/456/posts/def', '/api/v1/users/789/posts/ghi']
    const result = normalizePathBatch(paths)

    // 123/456/789 → pattern-matched numeric, abc/def/ghi → learned (3 distinct values)
    for (const p of paths) {
      const r = result.get(p)
      expect(r?.template).toBe('/api/v1/users/{id}/posts/{param}')
      const kinds = r?.normalization?.normalizedSegments.map((s) => s.kind)
      expect(kinds).toContain('numeric')
      expect(kinds).toContain('learned')
    }
  })

  it('does not learn with only 2 distinct values (could be separate endpoints)', () => {
    const paths = ['/feed/timeline', '/jobs/timeline']
    const result = normalizePathBatch(paths)

    // Only 2 distinct values — not enough to infer parameterization
    expect(result.get('/feed/timeline')?.template).toBe('/feed/timeline')
    expect(result.get('/jobs/timeline')?.template).toBe('/jobs/timeline')
  })

  it('does not normalize short segments (1-2 chars) as IDs', () => {
    const r = normalizePath('/api/v1/ab')
    expect(r.template).toBe('/api/v1/ab')
    expect(r.normalization).toBeUndefined()
  })
})
