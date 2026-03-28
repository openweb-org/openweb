import { describe, expect, it } from 'vitest'

import { buildAuthCandidates } from './auth-candidates.js'
import type { CaptureData } from './classify.js'
import type { HarEntry, StateSnapshot } from '../../capture/types.js'

// ── Test helpers ────────────────────────────────────────────────────────────

function makeHarEntry(overrides: {
  method?: string
  url?: string
  headers?: Array<{ name: string; value: string }>
  responseStatus?: number
  responseText?: string
}): HarEntry {
  return {
    startedDateTime: '2025-01-01T00:00:00Z',
    time: 100,
    request: {
      method: overrides.method ?? 'GET',
      url: overrides.url ?? 'https://api.example.com/v1/data',
      headers: overrides.headers ?? [{ name: 'Cookie', value: 'sessionid=abc' }],
    },
    response: {
      status: overrides.responseStatus ?? 200,
      statusText: 'OK',
      headers: [{ name: 'content-type', value: 'application/json' }],
      content: {
        size: 100,
        mimeType: 'application/json',
        text: overrides.responseText ?? '{}',
      },
    },
  }
}

function makeSnapshot(overrides?: {
  cookies?: Array<{ name: string; value: string; httpOnly?: boolean }>
  localStorage?: Record<string, string>
}): StateSnapshot {
  return {
    timestamp: '2025-01-01T00:00:00Z',
    trigger: 'initial',
    url: 'https://example.com',
    localStorage: overrides?.localStorage ?? {},
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

describe('buildAuthCandidates', () => {
  // ── Cookie session with coverage ratio ──

  describe('cookie session detection', () => {
    it('detects cookie_session with full coverage', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
          makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
        ],
        stateSnapshots: [makeSnapshot({ cookies: [{ name: 'sessionid', value: 'abc' }] })],
      }

      const { candidates } = buildAuthCandidates(data)
      const cookieCandidate = candidates.find(c => c.auth?.type === 'cookie_session')
      expect(cookieCandidate).toBeDefined()
      expect(cookieCandidate?.confidence).toBe(1)
      expect(cookieCandidate?.evidence.matchedEntries).toBe(2)
      expect(cookieCandidate?.evidence.totalEntries).toBe(2)
    })

    it('reports partial coverage as ratio', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
          makeHarEntry({ headers: [{ name: 'Accept', value: 'application/json' }] }),
          makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
          makeHarEntry({ headers: [{ name: 'Accept', value: 'application/json' }] }),
        ],
        stateSnapshots: [makeSnapshot({ cookies: [{ name: 'sessionid', value: 'abc' }] })],
      }

      const { candidates } = buildAuthCandidates(data)
      const cookieCandidate = candidates.find(c => c.auth?.type === 'cookie_session')
      expect(cookieCandidate).toBeDefined()
      expect(cookieCandidate?.confidence).toBe(0.5)
      expect(cookieCandidate?.evidence.matchedEntries).toBe(2)
      expect(cookieCandidate?.evidence.totalEntries).toBe(4)
    })

    it('reports matched cookie names in evidence', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc; token=xyz' }] }),
        ],
        stateSnapshots: [makeSnapshot({
          cookies: [
            { name: 'sessionid', value: 'abc' },
            { name: 'token', value: 'xyz' },
          ],
        })],
      }

      const { candidates } = buildAuthCandidates(data)
      const cookieCandidate = candidates.find(c => c.auth?.type === 'cookie_session')
      expect(cookieCandidate?.evidence.matchedCookies).toContain('sessionid')
      expect(cookieCandidate?.evidence.matchedCookies).toContain('token')
    })

    it('excludes tracking cookies from matching', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({ headers: [{ name: 'Cookie', value: '_ga=GA1; _fbp=fb.1' }] }),
        ],
        stateSnapshots: [makeSnapshot({
          cookies: [
            { name: '_ga', value: 'GA1' },
            { name: '_fbp', value: 'fb.1' },
          ],
        })],
      }

      const { candidates } = buildAuthCandidates(data)
      // Only tracking cookies → no cookie_session candidate
      expect(candidates.find(c => c.auth?.type === 'cookie_session')).toBeUndefined()
    })

    it('treats ct0 and twid as auth cookies (not tracking)', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({ headers: [{ name: 'Cookie', value: 'ct0=token123; twid=u%3D12345' }] }),
        ],
        stateSnapshots: [makeSnapshot({
          cookies: [
            { name: 'ct0', value: 'token123' },
            { name: 'twid', value: 'u%3D12345' },
          ],
        })],
      }

      const { candidates } = buildAuthCandidates(data)
      const cookieCandidate = candidates.find(c => c.auth?.type === 'cookie_session')
      expect(cookieCandidate).toBeDefined()
      expect(cookieCandidate?.evidence.matchedCookies).toContain('ct0')
      expect(cookieCandidate?.evidence.matchedCookies).toContain('twid')
    })
  })

  // ── localStorage JWT detection ──

  describe('localStorage JWT detection', () => {
    it('detects localStorage_jwt with path evidence', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({
            headers: [{ name: 'Authorization', value: 'Bearer eyJhbGciOiJFUzI1NiJ9.testtoken123' }],
          }),
        ],
        stateSnapshots: [makeSnapshot({
          localStorage: {
            BSKY_STORAGE: JSON.stringify({
              session: { currentAccount: { accessJwt: 'eyJhbGciOiJFUzI1NiJ9.testtoken123' } },
            }),
          },
        })],
      }

      const { candidates } = buildAuthCandidates(data)
      const jwtCandidate = candidates.find(c => c.auth?.type === 'localStorage_jwt')
      expect(jwtCandidate).toBeDefined()
      expect(jwtCandidate?.confidence).toBe(0.95)
      expect(jwtCandidate?.rank).toBe(1)
      expect(jwtCandidate?.evidence.storageKeys).toContain('BSKY_STORAGE')
      expect(jwtCandidate?.evidence.notes[0]).toContain('BSKY_STORAGE')
      expect(jwtCandidate?.evidence.notes[0]).toContain('session.currentAccount.accessJwt')
    })

    it('ranks localStorage_jwt above cookie_session', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({
            headers: [
              { name: 'Authorization', value: 'Bearer eyJhbGciOiJFUzI1NiJ9.testtoken123' },
              { name: 'Cookie', value: 'sessionid=abc' },
            ],
          }),
        ],
        stateSnapshots: [makeSnapshot({
          cookies: [{ name: 'sessionid', value: 'abc' }],
          localStorage: {
            authStore: JSON.stringify({ token: 'eyJhbGciOiJFUzI1NiJ9.testtoken123' }),
          },
        })],
      }

      const { candidates } = buildAuthCandidates(data)
      expect(candidates.length).toBeGreaterThanOrEqual(2)
      expect(candidates[0]?.auth?.type).toBe('localStorage_jwt')
      expect(candidates[0]?.rank).toBe(1)
      const cookieCandidate = candidates.find(c => c.auth?.type === 'cookie_session')
      expect(cookieCandidate?.rank).toBe(3)
    })
  })

  // ── Exchange chain detection ──

  describe('exchange chain detection', () => {
    it('detects exchange_chain with expanded URL matching', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({
            method: 'POST',
            url: 'https://example.com/oauth/token',
            responseText: JSON.stringify({ accessToken: 'bearer_token_xyz' }),
          }),
          makeHarEntry({
            headers: [{ name: 'Authorization', value: 'Bearer bearer_token_xyz' }],
          }),
        ],
        stateSnapshots: [],
      }

      const { candidates } = buildAuthCandidates(data)
      const exchangeCandidate = candidates.find(c => c.auth?.type === 'exchange_chain')
      expect(exchangeCandidate).toBeDefined()
      expect(exchangeCandidate?.confidence).toBe(0.9)
      expect(exchangeCandidate?.rank).toBe(2)
      expect(exchangeCandidate?.evidence.tokenEndpoints).toContain('https://example.com/oauth/token')
    })

    it('matches /auth/ URL pattern', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({
            method: 'POST',
            url: 'https://example.com/api/auth/refresh',
            responseText: JSON.stringify({ token: 'my_bearer_token_123' }),
          }),
          makeHarEntry({
            headers: [{ name: 'Authorization', value: 'Bearer my_bearer_token_123' }],
          }),
        ],
        stateSnapshots: [],
      }

      const { candidates } = buildAuthCandidates(data)
      expect(candidates.find(c => c.auth?.type === 'exchange_chain')).toBeDefined()
    })

    it('matches /login/ URL pattern', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({
            method: 'POST',
            url: 'https://example.com/api/login',
            responseText: JSON.stringify({ access_token: 'login_bearer_token_456' }),
          }),
          makeHarEntry({
            headers: [{ name: 'Authorization', value: 'Bearer login_bearer_token_456' }],
          }),
        ],
        stateSnapshots: [],
      }

      const { candidates } = buildAuthCandidates(data)
      expect(candidates.find(c => c.auth?.type === 'exchange_chain')).toBeDefined()
    })

    it('matches /session/ URL pattern', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({
            method: 'POST',
            url: 'https://example.com/api/session/create',
            responseText: JSON.stringify({ jwt: 'session_bearer_token_789' }),
          }),
          makeHarEntry({
            headers: [{ name: 'Authorization', value: 'Bearer session_bearer_token_789' }],
          }),
        ],
        stateSnapshots: [],
      }

      const { candidates } = buildAuthCandidates(data)
      expect(candidates.find(c => c.auth?.type === 'exchange_chain')).toBeDefined()
    })

    it('matches /sso/ URL pattern', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({
            method: 'POST',
            url: 'https://example.com/sso/callback',
            responseText: JSON.stringify({ access_token: 'sso_token_abcdefghijklmnop' }),
          }),
          makeHarEntry({
            headers: [{ name: 'Authorization', value: 'Bearer sso_token_abcdefghijklmnop' }],
          }),
        ],
        stateSnapshots: [],
      }

      const { candidates } = buildAuthCandidates(data)
      expect(candidates.find(c => c.auth?.type === 'exchange_chain')).toBeDefined()
    })
  })

  // ── CSRF bundling ──

  describe('CSRF bundling', () => {
    it('bundles cookie_to_header CSRF into auth candidate', () => {
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
        stateSnapshots: [makeSnapshot({
          cookies: [
            { name: 'sessionid', value: 'abc', httpOnly: true },
            { name: 'csrftoken', value: 'tok123', httpOnly: false },
          ],
        })],
      }

      const { candidates } = buildAuthCandidates(data)
      const cookieCandidate = candidates.find(c => c.auth?.type === 'cookie_session')
      expect(cookieCandidate).toBeDefined()
      expect(cookieCandidate?.csrf).toEqual({
        type: 'cookie_to_header',
        cookie: 'csrftoken',
        header: 'X-CSRFToken',
      })
    })

    it('bundles meta_tag CSRF into auth candidate', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
          makeHarEntry({
            method: 'POST',
            headers: [
              { name: 'Cookie', value: 'sessionid=abc' },
              { name: 'X-CSRF-Token', value: 'meta_csrf_value_abc' },
            ],
          }),
        ],
        stateSnapshots: [makeSnapshot({
          cookies: [{ name: 'sessionid', value: 'abc', httpOnly: true }],
        })],
        domHtml: '<html><head><meta name="csrf-token" content="meta_csrf_value_abc"></head></html>',
      }

      const { candidates } = buildAuthCandidates(data)
      const cookieCandidate = candidates.find(c => c.auth?.type === 'cookie_session')
      expect(cookieCandidate).toBeDefined()
      expect(cookieCandidate?.csrf).toEqual({
        type: 'meta_tag',
        name: 'csrf-token',
        header: 'X-CSRF-Token',
      })
    })

    it('excludes sec-ch-* client hint headers from CSRF detection', () => {
      // Simulates LinkedIn scenario: CH-prefers-color-scheme cookie → sec-ch-prefers-color-scheme header
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
          makeHarEntry({
            method: 'POST',
            headers: [
              { name: 'Cookie', value: 'sessionid=abc' },
              { name: 'sec-ch-prefers-color-scheme', value: 'light' },
            ],
          }),
        ],
        stateSnapshots: [makeSnapshot({
          cookies: [
            { name: 'sessionid', value: 'abc', httpOnly: true },
            { name: 'CH-prefers-color-scheme', value: 'light', httpOnly: false },
          ],
        })],
      }

      const { candidates } = buildAuthCandidates(data)
      const cookieCandidate = candidates.find(c => c.auth?.type === 'cookie_session')
      expect(cookieCandidate).toBeDefined()
      // No CSRF should be detected — the sec-ch- header is a client hint, not CSRF
      expect(cookieCandidate?.csrf).toBeUndefined()
    })

    it('strips quotes from cookie values when matching CSRF', () => {
      // Simulates LinkedIn JSESSIONID with quoted value
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
          makeHarEntry({
            method: 'POST',
            headers: [
              { name: 'Cookie', value: 'sessionid=abc' },
              { name: 'csrf-token', value: 'ajax:123456' },
            ],
          }),
        ],
        stateSnapshots: [makeSnapshot({
          cookies: [
            { name: 'sessionid', value: 'abc', httpOnly: true },
            { name: 'JSESSIONID', value: '"ajax:123456"', httpOnly: false },
          ],
        })],
      }

      const { candidates } = buildAuthCandidates(data)
      const cookieCandidate = candidates.find(c => c.auth?.type === 'cookie_session')
      expect(cookieCandidate).toBeDefined()
      expect(cookieCandidate?.csrf).toEqual({
        type: 'cookie_to_header',
        cookie: 'JSESSIONID',
        header: 'csrf-token',
      })
    })

    it('prefers standard CSRF header names over random matches', () => {
      // Both a random header and csrf-token match cookie values
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
          makeHarEntry({
            method: 'POST',
            headers: [
              { name: 'Cookie', value: 'sessionid=abc' },
              { name: 'x-random-header', value: 'tok123' },
              { name: 'csrf-token', value: 'csrf_val_456' },
            ],
          }),
        ],
        stateSnapshots: [makeSnapshot({
          cookies: [
            { name: 'sessionid', value: 'abc', httpOnly: true },
            { name: 'random_cookie', value: 'tok123', httpOnly: false },
            { name: 'csrf_cookie', value: 'csrf_val_456', httpOnly: false },
          ],
        })],
      }

      const { candidates } = buildAuthCandidates(data)
      const cookieCandidate = candidates.find(c => c.auth?.type === 'cookie_session')
      expect(cookieCandidate).toBeDefined()
      // Should pick the csrf-token header, not x-random-header
      expect(cookieCandidate?.csrf?.type).toBe('cookie_to_header')
      if (cookieCandidate?.csrf?.type === 'cookie_to_header') {
        expect(cookieCandidate.csrf.header).toBe('csrf-token')
        expect(cookieCandidate.csrf.cookie).toBe('csrf_cookie')
      }
    })
  })

  // ── Signing bundling ──

  describe('signing bundling', () => {
    it('bundles SAPISIDHASH signing into auth candidate', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({
            url: 'https://www.youtube.com/api/data',
            headers: [
              { name: 'Cookie', value: 'SAPISID=abc123; sessionid=xyz' },
              { name: 'Authorization', value: 'SAPISIDHASH 1234567890_abcdef0123456789abcdef0123456789abcdef01' },
            ],
          }),
        ],
        stateSnapshots: [makeSnapshot({
          cookies: [
            { name: 'sessionid', value: 'xyz' },
          ],
        })],
      }

      const { candidates } = buildAuthCandidates(data)
      const cookieCandidate = candidates.find(c => c.auth?.type === 'cookie_session')
      expect(cookieCandidate).toBeDefined()
      expect(cookieCandidate?.signing).toEqual({
        type: 'sapisidhash',
        origin: 'https://www.youtube.com',
        inject: { header: 'Authorization', prefix: 'SAPISIDHASH ' },
      })
    })

    it('includes signing in none candidate when no auth detected', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({
            url: 'https://www.youtube.com/api/data',
            headers: [
              { name: 'Authorization', value: 'SAPISIDHASH 1234567890_abcdef0123456789abcdef0123456789abcdef01' },
            ],
          }),
        ],
        stateSnapshots: [],
      }

      const { candidates } = buildAuthCandidates(data)
      expect(candidates).toHaveLength(1)
      expect(candidates[0]?.auth).toBeUndefined()
      expect(candidates[0]?.confidence).toBe(0)
      expect(candidates[0]?.signing?.type).toBe('sapisidhash')
    })
  })

  // ── Multiple candidates ranked correctly ──

  describe('ranking', () => {
    it('returns candidates sorted by rank (localStorage_jwt first)', () => {
      const data: CaptureData = {
        harEntries: [
          // Token exchange endpoint
          makeHarEntry({
            method: 'POST',
            url: 'https://example.com/oauth/token',
            headers: [{ name: 'Cookie', value: 'sessionid=abc' }],
            responseText: JSON.stringify({ accessToken: 'eyJhbGciOiJSUzI1NiJ9.longtokenvalue123' }),
          }),
          // API request using the token
          makeHarEntry({
            headers: [
              { name: 'Authorization', value: 'Bearer eyJhbGciOiJSUzI1NiJ9.longtokenvalue123' },
              { name: 'Cookie', value: 'sessionid=abc' },
            ],
          }),
        ],
        stateSnapshots: [makeSnapshot({
          cookies: [{ name: 'sessionid', value: 'abc' }],
          localStorage: {
            authStore: JSON.stringify({ jwt: 'eyJhbGciOiJSUzI1NiJ9.longtokenvalue123' }),
          },
        })],
      }

      const { candidates } = buildAuthCandidates(data)
      expect(candidates.length).toBe(3) // localStorage_jwt, exchange_chain, cookie_session
      expect(candidates[0]?.auth?.type).toBe('localStorage_jwt')
      expect(candidates[0]?.rank).toBe(1)
      expect(candidates[1]?.auth?.type).toBe('exchange_chain')
      expect(candidates[1]?.rank).toBe(2)
      expect(candidates[2]?.auth?.type).toBe('cookie_session')
      expect(candidates[2]?.rank).toBe(3)
    })

    it('confidence: localStorage_jwt=0.95, exchange_chain=0.9, cookie_session=coverage', () => {
      const data: CaptureData = {
        harEntries: [
          makeHarEntry({
            method: 'POST',
            url: 'https://example.com/api/token',
            headers: [{ name: 'Cookie', value: 'sessionid=abc' }],
            responseText: JSON.stringify({ accessToken: 'eyJhbGciOiJSUzI1NiJ9.longtokenvalue456' }),
          }),
          makeHarEntry({
            headers: [
              { name: 'Authorization', value: 'Bearer eyJhbGciOiJSUzI1NiJ9.longtokenvalue456' },
              { name: 'Cookie', value: 'sessionid=abc' },
            ],
          }),
        ],
        stateSnapshots: [makeSnapshot({
          cookies: [{ name: 'sessionid', value: 'abc' }],
          localStorage: {
            store: JSON.stringify({ auth: { token: 'eyJhbGciOiJSUzI1NiJ9.longtokenvalue456' } }),
          },
        })],
      }

      const { candidates } = buildAuthCandidates(data)
      const jwt = candidates.find(c => c.auth?.type === 'localStorage_jwt')
      const exchange = candidates.find(c => c.auth?.type === 'exchange_chain')
      const cookie = candidates.find(c => c.auth?.type === 'cookie_session')

      expect(jwt?.confidence).toBe(0.95)
      expect(exchange?.confidence).toBe(0.9)
      // 2 out of 2 entries have cookies → coverage = 1.0
      expect(cookie?.confidence).toBe(1)
    })
  })

  // ── No auth detected ──

  describe('no auth detected', () => {
    it('returns candidate with confidence 0 when nothing detected', () => {
      const data: CaptureData = {
        harEntries: [makeHarEntry({ headers: [{ name: 'Accept', value: 'application/json' }] })],
        stateSnapshots: [makeSnapshot()],
      }

      const { candidates } = buildAuthCandidates(data)
      expect(candidates).toHaveLength(1)
      expect(candidates[0]?.auth).toBeUndefined()
      expect(candidates[0]?.confidence).toBe(0)
      expect(candidates[0]?.rank).toBe(99)
      expect(candidates[0]?.evidence.notes).toContain('No auth mechanism detected')
    })

    it('reports what was checked in rejectedSignals', () => {
      const data: CaptureData = {
        harEntries: [makeHarEntry({ headers: [{ name: 'Accept', value: 'application/json' }] })],
        stateSnapshots: [makeSnapshot()],
      }

      const { candidates } = buildAuthCandidates(data)
      expect(candidates[0]?.evidence.rejectedSignals).toBeDefined()
      expect(candidates[0]?.evidence.rejectedSignals?.length).toBeGreaterThan(0)
    })

    it('notes missing state snapshots', () => {
      const data: CaptureData = {
        harEntries: [makeHarEntry({ headers: [{ name: 'Accept', value: 'application/json' }] })],
        stateSnapshots: [],
      }

      const { candidates } = buildAuthCandidates(data)
      expect(candidates).toHaveLength(1)
      expect(candidates[0]?.confidence).toBe(0)
      expect(candidates[0]?.evidence.rejectedSignals).toContain('No state snapshots available')
    })

    it('notes missing HAR entries', () => {
      const data: CaptureData = {
        harEntries: [],
        stateSnapshots: [makeSnapshot()],
      }

      const { candidates } = buildAuthCandidates(data)
      expect(candidates).toHaveLength(1)
      expect(candidates[0]?.confidence).toBe(0)
      expect(candidates[0]?.evidence.rejectedSignals).toContain('No HAR entries available')
    })
  })

  // ── Each candidate has required fields ──

  it('all candidates have id, rank, transport, evidence', () => {
    const data: CaptureData = {
      harEntries: [
        makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] }),
      ],
      stateSnapshots: [makeSnapshot({ cookies: [{ name: 'sessionid', value: 'abc' }] })],
    }

    const { candidates } = buildAuthCandidates(data)
    for (const c of candidates) {
      expect(c.id).toBeDefined()
      expect(c.rank).toBeDefined()
      expect(c.transport).toBe('node')
      expect(c.evidence).toBeDefined()
      expect(c.evidence.notes.length).toBeGreaterThan(0)
    }
  })

  it('IDs always start from auth-1 on each call (no cross-call leakage)', () => {
    const data: CaptureData = {
      harEntries: [makeHarEntry({ headers: [{ name: 'Cookie', value: 'sessionid=abc' }] })],
      stateSnapshots: [makeSnapshot({ cookies: [{ name: 'sessionid', value: 'abc' }] })],
    }

    const { candidates: first } = buildAuthCandidates(data)
    const { candidates: second } = buildAuthCandidates(data)
    expect(first[0]?.id).toBe('auth-1')
    expect(second[0]?.id).toBe('auth-1')
  })
})
