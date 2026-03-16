import { describe, expect, it } from 'vitest'

import { classify, type CaptureData } from './classify.js'
import type { HarEntry, StateSnapshot } from '../../capture/types.js'

function makeHarEntry(overrides: {
  method?: string
  headers?: Array<{ name: string; value: string }>
}): HarEntry {
  return {
    startedDateTime: '2025-01-01T00:00:00Z',
    time: 100,
    request: {
      method: overrides.method ?? 'GET',
      url: 'https://www.instagram.com/api/v1/feed/timeline/',
      headers: overrides.headers ?? [{ name: 'Cookie', value: 'sessionid=abc; csrftoken=tok123' }],
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [{ name: 'content-type', value: 'application/json' }],
      content: { size: 100, mimeType: 'application/json', text: '{}' },
    },
  }
}

function makeSnapshot(cookies: Array<{ name: string; value: string; httpOnly?: boolean }>): StateSnapshot {
  return {
    timestamp: '2025-01-01T00:00:00Z',
    trigger: 'initial',
    url: 'https://www.instagram.com',
    localStorage: {},
    sessionStorage: {},
    cookies: cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: '.instagram.com',
      path: '/',
      httpOnly: c.httpOnly ?? false,
      secure: true,
      sameSite: 'Lax' as const,
      expires: -1,
    })),
  }
}

describe('classify', () => {
  it('detects cookie_session when all requests have cookies', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
        makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
      ],
      stateSnapshots: [makeSnapshot([{ name: 'sessionid', value: 'abc' }])],
    }

    const result = classify(data)
    expect(result.mode).toBe('session_http')
    expect(result.auth).toEqual({ type: 'cookie_session' })
  })

  it('detects cookie_to_header when mutation header matches cookie value', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc; csrftoken=tok123' }] }),
        makeHarEntry({
          method: 'POST',
          headers: [
            { name: 'Cookie', value: 'sessionid=abc; csrftoken=tok123' },
            { name: 'X-CSRFToken', value: 'tok123' },
          ],
        }),
      ],
      stateSnapshots: [
        makeSnapshot([
          { name: 'sessionid', value: 'abc', httpOnly: true },
          { name: 'csrftoken', value: 'tok123', httpOnly: false },
        ]),
      ],
    }

    const result = classify(data)
    expect(result.mode).toBe('session_http')
    expect(result.auth).toEqual({ type: 'cookie_session' })
    expect(result.csrf).toEqual({ type: 'cookie_to_header', cookie: 'csrftoken', header: 'X-CSRFToken' })
  })

  it('returns direct_http when no cookies in requests', () => {
    const data: CaptureData = {
      harEntries: [makeHarEntry({ headers: [{ name: 'Accept', value: 'application/json' }] })],
      stateSnapshots: [makeSnapshot([{ name: 'sessionid', value: 'abc' }])],
    }

    const result = classify(data)
    expect(result.mode).toBe('direct_http')
    expect(result.auth).toBeUndefined()
  })

  it('returns direct_http when no state snapshots', () => {
    const data: CaptureData = {
      harEntries: [makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] })],
      stateSnapshots: [],
    }

    const result = classify(data)
    expect(result.mode).toBe('direct_http')
  })

  it('detects cookie_session without CSRF when no mutations present', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({ method: 'GET', headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
      ],
      stateSnapshots: [makeSnapshot([{ name: 'sessionid', value: 'abc' }])],
    }

    const result = classify(data)
    expect(result.mode).toBe('session_http')
    expect(result.auth).toEqual({ type: 'cookie_session' })
    expect(result.csrf).toBeUndefined()
  })

  it('returns direct_http when HAR entries are empty', () => {
    const data: CaptureData = {
      harEntries: [],
      stateSnapshots: [makeSnapshot([{ name: 'sessionid', value: 'abc' }])],
    }

    const result = classify(data)
    expect(result.mode).toBe('direct_http')
  })

  it('skips httpOnly cookies for cookie_to_header detection', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
        makeHarEntry({
          method: 'POST',
          headers: [
            { name: 'Cookie', value: 'sessionid=abc' },
            { name: 'X-Token', value: 'abc' },
          ],
        }),
      ],
      stateSnapshots: [
        makeSnapshot([{ name: 'sessionid', value: 'abc', httpOnly: true }]),
      ],
    }

    const result = classify(data)
    expect(result.mode).toBe('session_http')
    // sessionid is httpOnly, so cookie_to_header should NOT match it
    expect(result.csrf).toBeUndefined()
  })
})
