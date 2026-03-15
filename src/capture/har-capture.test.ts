import { describe, expect, it } from 'vitest'
import { isBlockedDomain, shouldCaptureRequest } from './har-capture.js'

describe('HAR capture filtering', () => {
  it('blocks known analytics domains', () => {
    expect(isBlockedDomain('google-analytics.com')).toBe(true)
    expect(isBlockedDomain('www.google-analytics.com')).toBe(true)
    expect(isBlockedDomain('sentry.io')).toBe(true)
    expect(isBlockedDomain('cdn.segment.io')).toBe(true)
  })

  it('allows non-analytics domains', () => {
    expect(isBlockedDomain('api.example.com')).toBe(false)
    expect(isBlockedDomain('instagram.com')).toBe(false)
  })

  it('filters static assets by path extension', () => {
    const url = new URL('https://api.example.com/bundle.js')
    expect(shouldCaptureRequest(url, null)).toBe(false)
  })

  it('filters non-API content types', () => {
    const url = new URL('https://api.example.com/page')
    expect(shouldCaptureRequest(url, 'text/html')).toBe(false)
    expect(shouldCaptureRequest(url, 'image/png')).toBe(false)
    expect(shouldCaptureRequest(url, 'text/css')).toBe(false)
  })

  it('captures JSON API responses', () => {
    const url = new URL('https://api.example.com/data')
    expect(shouldCaptureRequest(url, 'application/json')).toBe(true)
    expect(shouldCaptureRequest(url, 'application/json; charset=utf-8')).toBe(true)
    expect(shouldCaptureRequest(url, 'application/vnd.api+json')).toBe(true)
    expect(shouldCaptureRequest(url, 'application/graphql+json')).toBe(true)
  })

  it('captures SSE (text/event-stream)', () => {
    const url = new URL('https://api.example.com/events')
    expect(shouldCaptureRequest(url, 'text/event-stream')).toBe(true)
  })

  it('captures wildcard +json variants', () => {
    const url = new URL('https://api.example.com/data')
    expect(shouldCaptureRequest(url, 'application/hal+json')).toBe(true)
    expect(shouldCaptureRequest(url, 'application/ld+json')).toBe(true)
    expect(shouldCaptureRequest(url, 'application/problem+json')).toBe(true)
  })

  it('captures requests with no content-type (unknown responses)', () => {
    const url = new URL('https://api.example.com/data')
    expect(shouldCaptureRequest(url, null)).toBe(true)
  })

  it('captures unknown MIME types (conservative — keep rather than drop)', () => {
    const url = new URL('https://api.example.com/data')
    expect(shouldCaptureRequest(url, 'application/octet-stream')).toBe(true)
    expect(shouldCaptureRequest(url, 'application/protobuf')).toBe(true)
  })
})
