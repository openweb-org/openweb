import { describe, expect, it } from 'vitest'

import type { HarEntry, StateSnapshot } from '../../capture/types.js'
import type { CaptureData } from './classify.js'
import { detectCookieToHeader } from './csrf-detect.js'

// ── Test helpers ────────────────────────────────────────────────────────────

function makeHarEntry(overrides: {
  method?: string
  url?: string
  headers?: Array<{ name: string; value: string }>
}): HarEntry {
  return {
    startedDateTime: '2025-01-01T00:00:00Z',
    time: 100,
    request: {
      method: overrides.method ?? 'GET',
      url: overrides.url ?? 'https://api.example.com/v1/data',
      headers: overrides.headers ?? [],
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [{ name: 'content-type', value: 'application/json' }],
      content: { size: 100, mimeType: 'application/json' },
    },
  }
}

function makeSnapshot(overrides?: {
  cookies?: Array<{ name: string; value: string; httpOnly?: boolean }>
}): StateSnapshot {
  return {
    timestamp: '2025-01-01T00:00:00Z',
    trigger: 'initial',
    url: 'https://example.com',
    localStorage: {},
    sessionStorage: {},
    cookies: (overrides?.cookies ?? []).map((c) => ({
      name: c.name,
      value: c.value,
      domain: '.example.com',
      path: '/',
      httpOnly: c.httpOnly ?? false,
      secure: true,
      sameSite: 'Lax' as const,
      expires: -1,
    })),
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('detectCookieToHeader — standard header denylist', () => {
  it('skips content-length header as CSRF target', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({
          method: 'POST',
          headers: [
            { name: 'Cookie', value: 'tok=abc123' },
            { name: 'content-length', value: 'abc123' },
          ],
        }),
      ],
      stateSnapshots: [makeSnapshot({ cookies: [{ name: 'tok', value: 'abc123' }] })],
    }
    expect(detectCookieToHeader(data)).toBeUndefined()
  })

  it('skips accept-encoding header as CSRF target', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({
          method: 'POST',
          headers: [
            { name: 'Cookie', value: 'tok=gzip' },
            { name: 'accept-encoding', value: 'gzip' },
          ],
        }),
      ],
      stateSnapshots: [makeSnapshot({ cookies: [{ name: 'tok', value: 'gzip' }] })],
    }
    expect(detectCookieToHeader(data)).toBeUndefined()
  })

  it('skips accept-language header as CSRF target', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({
          method: 'POST',
          headers: [
            { name: 'Cookie', value: 'lang=en-US' },
            { name: 'accept-language', value: 'en-US' },
          ],
        }),
      ],
      stateSnapshots: [makeSnapshot({ cookies: [{ name: 'lang', value: 'en-US' }] })],
    }
    expect(detectCookieToHeader(data)).toBeUndefined()
  })

  it('skips connection header as CSRF target', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({
          method: 'POST',
          headers: [
            { name: 'Cookie', value: 'conn=keep-alive' },
            { name: 'connection', value: 'keep-alive' },
          ],
        }),
      ],
      stateSnapshots: [makeSnapshot({ cookies: [{ name: 'conn', value: 'keep-alive' }] })],
    }
    expect(detectCookieToHeader(data)).toBeUndefined()
  })

  it('skips dpr header as CSRF target', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({
          method: 'POST',
          headers: [
            { name: 'Cookie', value: 'dpr_val=2.0' },
            { name: 'dpr', value: '2.0' },
          ],
        }),
      ],
      stateSnapshots: [makeSnapshot({ cookies: [{ name: 'dpr_val', value: '2.0' }] })],
    }
    expect(detectCookieToHeader(data)).toBeUndefined()
  })

  it('skips viewport-width header as CSRF target', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({
          method: 'POST',
          headers: [
            { name: 'Cookie', value: 'vw=1440' },
            { name: 'viewport-width', value: '1440' },
          ],
        }),
      ],
      stateSnapshots: [makeSnapshot({ cookies: [{ name: 'vw', value: '1440' }] })],
    }
    expect(detectCookieToHeader(data)).toBeUndefined()
  })

  it('skips all sec-* prefixed headers (not just sec-ch-*)', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({
          method: 'POST',
          headers: [
            { name: 'Cookie', value: 'tok=value123' },
            { name: 'sec-fetch-mode', value: 'value123' },
          ],
        }),
      ],
      stateSnapshots: [makeSnapshot({ cookies: [{ name: 'tok', value: 'value123' }] })],
    }
    expect(detectCookieToHeader(data)).toBeUndefined()
  })

  it('skips sec-ch-prefers-color-scheme header', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({
          method: 'POST',
          headers: [
            { name: 'Cookie', value: 'theme=light' },
            { name: 'sec-ch-prefers-color-scheme', value: 'light' },
          ],
        }),
      ],
      stateSnapshots: [makeSnapshot({ cookies: [{ name: 'theme', value: 'light' }] })],
    }
    expect(detectCookieToHeader(data)).toBeUndefined()
  })

  it('still detects legitimate CSRF headers like x-csrf-token', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({
          method: 'POST',
          headers: [
            { name: 'Cookie', value: 'csrftoken=tok123' },
            { name: 'x-csrf-token', value: 'tok123' },
          ],
        }),
      ],
      stateSnapshots: [makeSnapshot({ cookies: [{ name: 'csrftoken', value: 'tok123' }] })],
    }
    const result = detectCookieToHeader(data)
    expect(result).toBeDefined()
    expect(result?.cookie).toBe('csrftoken')
    expect(result?.header).toBe('x-csrf-token')
  })
})
