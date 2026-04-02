import { describe, expect, it } from 'vitest'

import type { RecordedRequestSample } from '../types.js'
import { detectConstantHeaders } from './constant-headers.js'

function makeSample(
  headers: Array<{ name: string; value: string }>,
  overrides: Partial<RecordedRequestSample> = {},
): RecordedRequestSample {
  return {
    method: 'GET',
    host: 'api.example.com',
    path: '/data',
    url: 'https://api.example.com/data',
    query: {},
    status: 200,
    contentType: 'application/json',
    response: { kind: 'json', body: {} },
    requestHeaders: headers,
    ...overrides,
  }
}

describe('detectConstantHeaders', () => {
  it('detects a constant non-standard header present in all samples', () => {
    const samples = [
      makeSample([
        { name: 'X-App-Version', value: '2.1.0' },
        { name: 'Accept', value: 'application/json' },
      ]),
      makeSample([
        { name: 'X-App-Version', value: '2.1.0' },
        { name: 'Accept', value: 'text/html' },
      ]),
      makeSample([
        { name: 'X-App-Version', value: '2.1.0' },
      ]),
    ]

    const result = detectConstantHeaders(samples)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('X-App-Version')
    expect(result[0].location).toBe('header')
    expect(result[0].required).toBe(true)
    expect(result[0].schema).toEqual({ type: 'string', enum: ['2.1.0'] })
    expect(result[0].exampleValue).toBe('2.1.0')
  })

  it('ignores standard headers like User-Agent, Cookie, Accept', () => {
    const samples = [
      makeSample([
        { name: 'User-Agent', value: 'Mozilla/5.0' },
        { name: 'Cookie', value: 'session=abc' },
        { name: 'Accept', value: 'application/json' },
      ]),
      makeSample([
        { name: 'User-Agent', value: 'Mozilla/5.0' },
        { name: 'Cookie', value: 'session=abc' },
        { name: 'Accept', value: 'application/json' },
      ]),
    ]

    const result = detectConstantHeaders(samples)
    expect(result).toHaveLength(0)
  })

  it('ignores sec-* prefixed headers', () => {
    const samples = [
      makeSample([{ name: 'Sec-Fetch-Mode', value: 'cors' }]),
      makeSample([{ name: 'Sec-Fetch-Mode', value: 'cors' }]),
    ]

    const result = detectConstantHeaders(samples)
    expect(result).toHaveLength(0)
  })

  it('skips headers not present in every sample', () => {
    const samples = [
      makeSample([{ name: 'X-Custom', value: 'abc' }]),
      makeSample([]), // no X-Custom header
    ]

    const result = detectConstantHeaders(samples)
    expect(result).toHaveLength(0)
  })

  it('skips headers with varying values', () => {
    const samples = [
      makeSample([{ name: 'X-Request-Id', value: 'id-1' }]),
      makeSample([{ name: 'X-Request-Id', value: 'id-2' }]),
    ]

    const result = detectConstantHeaders(samples)
    expect(result).toHaveLength(0)
  })

  it('returns empty for fewer than 2 samples', () => {
    const samples = [
      makeSample([{ name: 'X-Custom', value: 'abc' }]),
    ]

    const result = detectConstantHeaders(samples)
    expect(result).toHaveLength(0)
  })

  it('returns empty when samples have no requestHeaders', () => {
    const samples: RecordedRequestSample[] = [
      { method: 'GET', host: 'a.com', path: '/', url: 'https://a.com/', query: {}, status: 200, contentType: 'application/json', response: { kind: 'json', body: {} } },
      { method: 'GET', host: 'a.com', path: '/', url: 'https://a.com/', query: {}, status: 200, contentType: 'application/json', response: { kind: 'json', body: {} } },
    ]

    const result = detectConstantHeaders(samples)
    expect(result).toHaveLength(0)
  })

  it('detects multiple constant headers and sorts them', () => {
    const samples = [
      makeSample([
        { name: 'X-Platform', value: 'web' },
        { name: 'X-Api-Key', value: 'key-123' },
      ]),
      makeSample([
        { name: 'X-Platform', value: 'web' },
        { name: 'X-Api-Key', value: 'key-123' },
      ]),
    ]

    const result = detectConstantHeaders(samples)
    expect(result).toHaveLength(2)
    // Sorted alphabetically
    expect(result[0].name).toBe('X-Api-Key')
    expect(result[1].name).toBe('X-Platform')
  })

  it('preserves original header casing', () => {
    const samples = [
      makeSample([{ name: 'X-Pinterest-AppType', value: '2' }]),
      makeSample([{ name: 'x-pinterest-apptype', value: '2' }]),
    ]

    const result = detectConstantHeaders(samples)
    expect(result).toHaveLength(1)
    // First-seen casing is preserved
    expect(result[0].name).toBe('X-Pinterest-AppType')
  })
})
