import { describe, expect, it, vi } from 'vitest'
import type { Page, Response as PwResponse } from 'patchright'

import { globToRegExp, resolveResponseCapture } from './response-capture.js'
import type { BrowserHandle } from './types.js'

type ResponseHandler = (resp: PwResponse) => void | Promise<void>

interface FakePageOptions {
  /** Responses to emit — each fires once goto is called. */
  readonly responses: ReadonlyArray<{ url: string; body: unknown }>
  /** When true, emit responses BEFORE page.goto resolves. */
  readonly emitBeforeGotoResolves?: boolean
  /** When true, emit responses synchronously during page.on('response') registration race.
   *  Simulates a fast endpoint that fires the moment goto starts. */
  readonly emitSynchronously?: boolean
  /** Delay responses by N ms after page.goto starts. */
  readonly responseDelayMs?: number
  /** Delay page.goto resolution by N ms. */
  readonly gotoDelayMs?: number
}

function fakeBrowserHandle(options: FakePageOptions): {
  handle: BrowserHandle
  listenerRegisteredAt: () => number | null
  gotoStartedAt: () => number | null
} {
  const listeners: ResponseHandler[] = []
  let listenerTimestamp: number | null = null
  let gotoTimestamp: number | null = null

  const emitAll = async () => {
    for (const { url, body } of options.responses) {
      const resp = {
        url: () => url,
        json: async () => body,
      } as unknown as PwResponse
      for (const handler of listeners) {
        await handler(resp)
      }
    }
  }

  const page = {
    on: vi.fn((event: string, handler: ResponseHandler) => {
      if (event === 'response') {
        listeners.push(handler)
        if (listenerTimestamp === null) listenerTimestamp = Date.now()
      }
      return page
    }),
    off: vi.fn((event: string, handler: ResponseHandler) => {
      if (event === 'response') {
        const idx = listeners.indexOf(handler)
        if (idx >= 0) listeners.splice(idx, 1)
      }
      return page
    }),
    goto: vi.fn(async () => {
      gotoTimestamp = Date.now()
      if (options.emitSynchronously) {
        await emitAll()
        return null
      }
      if (options.emitBeforeGotoResolves) {
        // Schedule response emission immediately (before goto resolves).
        void (async () => {
          await new Promise((r) => setTimeout(r, options.responseDelayMs ?? 1))
          await emitAll()
        })()
      }
      if (options.gotoDelayMs) {
        await new Promise((r) => setTimeout(r, options.gotoDelayMs))
      }
      if (!options.emitBeforeGotoResolves && !options.emitSynchronously) {
        await emitAll()
      }
      return null
    }),
  } as unknown as Page

  return {
    handle: { page, context: {} as BrowserHandle['context'] },
    listenerRegisteredAt: () => listenerTimestamp,
    gotoStartedAt: () => gotoTimestamp,
  }
}

describe('globToRegExp', () => {
  it('matches with * wildcard', () => {
    expect(globToRegExp('*/api/search*').test('https://a.com/api/search/flights?x=1')).toBe(true)
    expect(globToRegExp('*/api/search*').test('https://a.com/other')).toBe(false)
  })

  it('escapes regex metacharacters in the pattern', () => {
    const re = globToRegExp('*/foo.bar+baz*')
    expect(re.test('https://a.com/foo.bar+baz/q')).toBe(true)
    expect(re.test('https://a.com/fooXbar+baz/q')).toBe(false)
  })

  it('requires full-string match (not substring)', () => {
    expect(globToRegExp('https://a.com/api').test('https://a.com/api/extra')).toBe(false)
    expect(globToRegExp('https://a.com/api*').test('https://a.com/api/extra')).toBe(true)
  })
})

describe('resolveResponseCapture', () => {
  it('registers the response listener before page.goto', async () => {
    const { handle, listenerRegisteredAt, gotoStartedAt } = fakeBrowserHandle({
      responses: [{ url: 'https://a.com/api/search/flights?x=1', body: { data: { results: [1, 2] } } }],
      emitBeforeGotoResolves: true,
      gotoDelayMs: 50,
    })

    const result = await resolveResponseCapture(
      handle,
      { match_url: '*/api/search/flights*', unwrap: 'data.results' },
      { navigateUrl: 'https://a.com/flights', navTimeoutMs: 5000 },
    )

    expect(result).toEqual([1, 2])
    const listenerAt = listenerRegisteredAt()
    const gotoAt = gotoStartedAt()
    expect(listenerAt).not.toBeNull()
    expect(gotoAt).not.toBeNull()
    // Listener must be in place before goto begins.
    expect(listenerAt).toBeLessThanOrEqual(gotoAt as number)
  })

  it('captures a fast response that fires during navigation', async () => {
    const { handle } = fakeBrowserHandle({
      responses: [{ url: 'https://a.com/api/x', body: { ok: true } }],
      emitSynchronously: true,
    })

    const result = await resolveResponseCapture(
      handle,
      { match_url: '*/api/x' },
      { navigateUrl: 'https://a.com/page', navTimeoutMs: 5000 },
    )
    expect(result).toEqual({ ok: true })
  })

  it('ignores non-matching responses, returns first match', async () => {
    const { handle } = fakeBrowserHandle({
      responses: [
        { url: 'https://a.com/api/other', body: { skip: true } },
        { url: 'https://a.com/api/target', body: { hit: 1 } },
        { url: 'https://a.com/api/target', body: { hit: 2 } },
      ],
      emitSynchronously: true,
    })

    const result = await resolveResponseCapture(
      handle,
      { match_url: '*/api/target' },
      { navigateUrl: 'https://a.com/page', navTimeoutMs: 5000 },
    )
    expect(result).toEqual({ hit: 1 })
  })

  it('throws needs_page when no response matches within nav_timeout_ms', async () => {
    const { handle } = fakeBrowserHandle({
      responses: [{ url: 'https://a.com/api/other', body: {} }],
      emitSynchronously: true,
    })

    await expect(
      resolveResponseCapture(
        handle,
        { match_url: '*/api/never' },
        { navigateUrl: 'https://a.com/page', navTimeoutMs: 200 },
      ),
    ).rejects.toMatchObject({
      payload: { failureClass: 'needs_page' },
    })
  })
})
