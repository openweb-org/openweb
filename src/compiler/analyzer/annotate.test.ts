import { describe, expect, it } from 'vitest'

import { annotateOperation } from './annotate.js'

describe('annotateOperation', () => {
  it('returns known mapping for open-meteo endpoints', () => {
    const annotation = annotateOperation('api.open-meteo.com', '/v1/forecast')
    expect(annotation.operationId).toBe('get_forecast')
  })

  it('falls back to mechanical naming for unknown endpoints', () => {
    const annotation = annotateOperation('api.example.com', '/v2/foo/bar')
    expect(annotation.operationId).toBe('get_v2_foo_bar')
  })
})
