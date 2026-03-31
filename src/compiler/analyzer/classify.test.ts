import { describe, expect, it } from 'vitest'

import type { HarEntry, StateSnapshot } from '../../capture/types.js'
import { type CaptureData, classify } from './classify.js'

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
    expect(result.transport).toBe('node')
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
    expect(result.transport).toBe('node')
    expect(result.auth).toEqual({ type: 'cookie_session' })
    expect(result.csrf).toEqual({ type: 'cookie_to_header', cookie: 'csrftoken', header: 'X-CSRFToken' })
  })

  it('returns node when no cookies in requests', () => {
    const data: CaptureData = {
      harEntries: [makeHarEntry({ headers: [{ name: 'Accept', value: 'application/json' }] })],
      stateSnapshots: [makeSnapshot([{ name: 'sessionid', value: 'abc' }])],
    }

    const result = classify(data)
    expect(result.transport).toBe('node')
    expect(result.auth).toBeUndefined()
  })

  it('rejects cookie_session when request cookies have no overlap with snapshot cookies', () => {
    // Analytics/consent cookies in requests but session cookies only in snapshots
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({ headers: [{ name: 'Cookie', value: 'analytics_id=abc; _ga=GA1.2' }] }),
      ],
      stateSnapshots: [makeSnapshot([{ name: 'sessionid', value: 'secret' }])],
    }

    const result = classify(data)
    expect(result.transport).toBe('node')
    expect(result.auth).toBeUndefined()
  })

  it('rejects cookie_session when only tracking cookies overlap', () => {
    // Same tracking cookie in both HAR and snapshot — should NOT trigger cookie_session
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({ headers: [{ name: 'Cookie', value: '_ga=GA1.2.123; _fbp=fb.1.456' }] }),
      ],
      stateSnapshots: [makeSnapshot([
        { name: '_ga', value: 'GA1.2.123' },
        { name: '_fbp', value: 'fb.1.456' },
      ])],
    }

    const result = classify(data)
    expect(result.transport).toBe('node')
    expect(result.auth).toBeUndefined()
  })

  it('returns node when no state snapshots', () => {
    const data: CaptureData = {
      harEntries: [makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] })],
      stateSnapshots: [],
    }

    const result = classify(data)
    expect(result.transport).toBe('node')
  })

  it('detects cookie_session without CSRF when no mutations present', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({ method: 'GET', headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
      ],
      stateSnapshots: [makeSnapshot([{ name: 'sessionid', value: 'abc' }])],
    }

    const result = classify(data)
    expect(result.transport).toBe('node')
    expect(result.auth).toEqual({ type: 'cookie_session' })
    expect(result.csrf).toBeUndefined()
  })

  it('returns node when HAR entries are empty', () => {
    const data: CaptureData = {
      harEntries: [],
      stateSnapshots: [makeSnapshot([{ name: 'sessionid', value: 'abc' }])],
    }

    const result = classify(data)
    expect(result.transport).toBe('node')
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
    expect(result.transport).toBe('node')
    // sessionid is httpOnly, so cookie_to_header should NOT match it
    expect(result.csrf).toBeUndefined()
  })

  it('detects localStorage_jwt when localStorage token matches Authorization header', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({
          headers: [
            { name: 'Authorization', value: 'Bearer eyJhbGciOiJFUzI1NiJ9.testtoken123' },
          ],
        }),
      ],
      stateSnapshots: [{
        timestamp: '2025-01-01T00:00:00Z',
        trigger: 'initial',
        url: 'https://bsky.app',
        localStorage: {
          'BSKY_STORAGE': JSON.stringify({
            session: {
              currentAccount: {
                accessJwt: 'eyJhbGciOiJFUzI1NiJ9.testtoken123',
              },
            },
          }),
        },
        sessionStorage: {},
        cookies: [],
      }],
    }

    const result = classify(data)
    expect(result.transport).toBe('node')
    expect(result.auth?.type).toBe('localStorage_jwt')
    if (result.auth?.type === 'localStorage_jwt') {
      expect(result.auth.key).toBe('BSKY_STORAGE')
      expect(result.auth.path).toBe('session.currentAccount.accessJwt')
    }
  })

  it('detects meta_tag CSRF when meta content matches mutation header', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
        makeHarEntry({
          method: 'POST',
          headers: [
            { name: 'Cookie', value: 'sessionid=abc' },
            { name: 'X-CSRF-Token', value: 'meta_csrf_token_456' },
          ],
        }),
      ],
      stateSnapshots: [
        makeSnapshot([{ name: 'sessionid', value: 'abc', httpOnly: true }]),
      ],
      domHtml: '<html><head><meta name="csrf-token" content="meta_csrf_token_456"></head><body></body></html>',
    }

    const result = classify(data)
    expect(result.transport).toBe('node')
    expect(result.auth).toEqual({ type: 'cookie_session' })
    expect(result.csrf?.type).toBe('meta_tag')
    if (result.csrf?.type === 'meta_tag') {
      expect(result.csrf.name).toBe('csrf-token')
      expect(result.csrf.header).toBe('X-CSRF-Token')
    }
  })

  it('detects sapisidhash signing from Authorization header pattern', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({
          headers: [
            { name: 'Cookie', value: 'SAPISID=abc123' },
            { name: 'Authorization', value: 'SAPISIDHASH 1234567890_abcdef0123456789abcdef0123456789abcdef01' },
          ],
        }),
      ],
      stateSnapshots: [makeSnapshot([{ name: 'SAPISID', value: 'abc123' }])],
    }

    const result = classify(data)
    expect(result.signing?.type).toBe('sapisidhash')
  })

  it('forces node transport when sapisidhash detected without auth', () => {
    // No cookies in HAR entries → no cookie_session detected
    // But SAPISIDHASH in Authorization → signing requires browser context
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({
          headers: [
            { name: 'Authorization', value: 'SAPISIDHASH 1234567890_abcdef0123456789abcdef0123456789abcdef01' },
          ],
        }),
      ],
      stateSnapshots: [],
    }

    const result = classify(data)
    expect(result.transport).toBe('node')
    expect(result.signing?.type).toBe('sapisidhash')
    expect(result.auth).toBeUndefined()
  })

  // CR-20: Partial cookie presence should NOT be detected as cookie_session
  it('returns node when only some HAR entries have Cookie header', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
        makeHarEntry({ headers: [{ name: 'Accept', value: 'application/json' }] }),
        makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
      ],
      stateSnapshots: [makeSnapshot([{ name: 'sessionid', value: 'abc' }])],
    }

    const result = classify(data)
    // Not all entries have Cookie → should NOT be cookie_session
    expect(result.transport).toBe('node')
    expect(result.auth).toBeUndefined()
  })

  it('detects exchange_chain when token endpoint response matches Bearer Authorization', () => {
    const data: CaptureData = {
      harEntries: [
        // Token exchange request
        {
          startedDateTime: '2025-01-01T00:00:00Z',
          time: 100,
          request: {
            method: 'POST',
            url: 'https://www.reddit.com/svc/shreddit/token',
            headers: [{ name: 'Cookie', value: 'reddit_session=abc' }],
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: [{ name: 'content-type', value: 'application/json' }],
            content: {
              size: 100,
              mimeType: 'application/json',
              text: JSON.stringify({ accessToken: 'bearer_token_12345' }),
            },
          },
        },
        // API request using the token
        {
          startedDateTime: '2025-01-01T00:00:01Z',
          time: 50,
          request: {
            method: 'GET',
            url: 'https://oauth.reddit.com/r/programming/hot',
            headers: [
              { name: 'Authorization', value: 'Bearer bearer_token_12345' },
            ],
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: [{ name: 'content-type', value: 'application/json' }],
            content: { size: 100, mimeType: 'application/json', text: '{}' },
          },
        },
      ],
      stateSnapshots: [makeSnapshot([{ name: 'reddit_session', value: 'abc', httpOnly: true }])],
    }

    const result = classify(data)
    expect(result.transport).toBe('node')
    expect(result.auth?.type).toBe('exchange_chain')
  })

  it('detects ssr_next_data from domHtml', () => {
    const data: CaptureData = {
      harEntries: [],
      stateSnapshots: [],
      domHtml: '<html><head></head><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"data":"value"}}}</script></body></html>',
    }

    const result = classify(data)
    expect(result.extractions).toBeDefined()
    expect(result.extractions).toHaveLength(1)
    expect(result.extractions?.[0]?.type).toBe('ssr_next_data')
    expect(result.extractions?.[0]?.selector).toBe('script#__NEXT_DATA__')
  })

  it('detects ssr_next_data from HAR HTML responses', () => {
    const data: CaptureData = {
      harEntries: [{
        startedDateTime: '2025-01-01T00:00:00Z',
        time: 100,
        request: {
          method: 'GET',
          url: 'https://www.walmart.com/',
          headers: [],
        },
        response: {
          status: 200,
          statusText: 'OK',
          headers: [{ name: 'content-type', value: 'text/html' }],
          content: {
            size: 1000,
            mimeType: 'text/html',
            text: '<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"bootstrapData":{}}}}</script></html>',
          },
        },
      }],
      stateSnapshots: [],
    }

    const result = classify(data)
    expect(result.extractions).toBeDefined()
    expect(result.extractions?.[0]?.type).toBe('ssr_next_data')
  })

  it('detects script_json tags (excluding __NEXT_DATA__)', () => {
    const data: CaptureData = {
      harEntries: [],
      stateSnapshots: [],
      domHtml: `<html><head>
        <script id="__NEXT_DATA__" type="application/json">{"skip":"me"}</script>
        <script id="repo-data" type="application/json">{"name":"claude-code","stars":1000}</script>
        <script type="application/json" data-target="react-app.embeddedData">{"viewer":{"login":"user"}}</script>
      </head></html>`,
    }

    const result = classify(data)
    expect(result.extractions).toBeDefined()
    // Should detect ssr_next_data + 2 script_json (excluding __NEXT_DATA__)
    expect(result.extractions?.length).toBe(3)
    const ssrSignal = result.extractions?.find(e => e.type === 'ssr_next_data')
    expect(ssrSignal).toBeDefined()
    const scriptSignals = result.extractions?.filter(e => e.type === 'script_json')
    expect(scriptSignals).toHaveLength(2)
    expect(scriptSignals[0]?.id).toBe('repo-data')
    expect(scriptSignals[0]?.selector).toBe('script#repo-data')
    expect(scriptSignals[1]?.dataType).toBe('react-app.embeddedData')
  })

  it('returns no extractions when domHtml has no matching tags', () => {
    const data: CaptureData = {
      harEntries: [],
      stateSnapshots: [],
      domHtml: '<html><body><h1>Hello</h1></body></html>',
    }

    const result = classify(data)
    expect(result.extractions).toBeUndefined()
  })

  it('ignores script_json tags with tiny content', () => {
    const data: CaptureData = {
      harEntries: [],
      stateSnapshots: [],
      domHtml: '<html><script id="tiny" type="application/json">{}</script></html>',
    }

    const result = classify(data)
    // {} is only 2 chars, below the 10-char threshold
    expect(result.extractions).toBeUndefined()
  })
})
