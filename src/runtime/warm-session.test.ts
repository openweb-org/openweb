import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Page, BrowserContext, Cookie } from 'patchright'

vi.mock('../lib/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { warmSession, _resetWarmCache } from './warm-session.js'

// ── Mock helpers ─────────────────────────────────

interface MockPageOpts {
  url?: string
  cookies?: Cookie[]
}

function createMockPage(opts: MockPageOpts = {}): Page {
  const currentUrl = opts.url ?? 'about:blank'
  const cookies = opts.cookies ?? []

  const mockContext = {
    cookies: vi.fn().mockResolvedValue(cookies),
  } as unknown as BrowserContext

  return {
    url: vi.fn().mockReturnValue(currentUrl),
    goto: vi.fn().mockResolvedValue(undefined),
    context: vi.fn().mockReturnValue(mockContext),
  } as unknown as Page
}

// ── Setup ────────────────────────────────────────

beforeEach(() => {
  _resetWarmCache()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Tests ────────────────────────────────────────

describe('warmSession — navigation', () => {
  it('navigates to URL when page is on a different origin', async () => {
    const page = createMockPage({ url: 'about:blank' })

    const promise = warmSession(page, 'https://www.expedia.com/')
    await vi.advanceTimersByTimeAsync(5_000)
    await promise

    expect(page.goto).toHaveBeenCalledWith(
      'https://www.expedia.com/',
      expect.objectContaining({ waitUntil: 'load' }),
    )
  })

  it('skips navigation when already on the same origin', async () => {
    const page = createMockPage({ url: 'https://www.expedia.com/hotels' })

    const promise = warmSession(page, 'https://www.expedia.com/')
    await vi.advanceTimersByTimeAsync(5_000)
    await promise

    expect(page.goto).not.toHaveBeenCalled()
  })

  it('navigates when on a different subdomain', async () => {
    const page = createMockPage({ url: 'https://api.expedia.com/graphql' })

    const promise = warmSession(page, 'https://www.expedia.com/')
    await vi.advanceTimersByTimeAsync(5_000)
    await promise

    expect(page.goto).toHaveBeenCalled()
  })
})

describe('warmSession — cookie stabilization', () => {
  it('returns early when cookie value stabilizes across two polls', async () => {
    const stableCookie: Cookie = {
      name: '_abck',
      value: 'sensor-data-final',
      domain: '.expedia.com',
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    }

    const page = createMockPage({ url: 'https://www.expedia.com/' })
    const ctx = page.context() as unknown as { cookies: ReturnType<typeof vi.fn> }

    // First poll: cookie not present
    // Second poll: cookie appears with value A
    // Third poll: cookie still value A → stabilized
    ctx.cookies
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...stableCookie, value: 'changing' }])
      .mockResolvedValueOnce([{ ...stableCookie, value: 'sensor-data-final' }])
      .mockResolvedValueOnce([{ ...stableCookie, value: 'sensor-data-final' }])

    const promise = warmSession(page, 'https://www.expedia.com/', {
      waitForCookie: '_abck',
      timeoutMs: 10_000,
    })

    // Advance through poll intervals (500ms each)
    await vi.advanceTimersByTimeAsync(2_500)
    await promise

    // Should have polled cookies multiple times
    expect(ctx.cookies.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('proceeds after timeout when cookie never stabilizes', async () => {
    const page = createMockPage({ url: 'https://www.expedia.com/' })
    const ctx = page.context() as unknown as { cookies: ReturnType<typeof vi.fn> }

    // Cookie value keeps changing every poll
    let counter = 0
    ctx.cookies.mockImplementation(async () => [
      { name: '_abck', value: `value-${counter++}`, domain: '.expedia.com', path: '/' },
    ])

    const promise = warmSession(page, 'https://www.expedia.com/', {
      waitForCookie: '_abck',
      timeoutMs: 2_000,
    })

    await vi.advanceTimersByTimeAsync(3_000)
    await promise

    // Should complete without throwing
  })
})

describe('warmSession — fixed delay fallback', () => {
  it('waits 3 seconds when no cookie specified', async () => {
    const page = createMockPage({ url: 'https://www.tripadvisor.com/' })
    const start = Date.now()

    const promise = warmSession(page, 'https://www.tripadvisor.com/')
    await vi.advanceTimersByTimeAsync(3_000)
    await promise

    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(3_000)
  })

  it('caps delay at timeoutMs when timeoutMs < 3000', async () => {
    const page = createMockPage({ url: 'https://www.tripadvisor.com/' })
    const start = Date.now()

    const promise = warmSession(page, 'https://www.tripadvisor.com/', { timeoutMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_000)
    await promise

    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(1_000)
    expect(elapsed).toBeLessThan(3_000)
  })
})

describe('warmSession — WeakSet caching', () => {
  it('second call on same page is a no-op', async () => {
    const page = createMockPage({ url: 'https://www.expedia.com/' })

    const p1 = warmSession(page, 'https://www.expedia.com/')
    await vi.advanceTimersByTimeAsync(3_000)
    await p1

    // Reset the goto mock to track second call
    ;(page.goto as ReturnType<typeof vi.fn>).mockClear()

    const p2 = warmSession(page, 'https://www.expedia.com/')
    await p2

    expect(page.goto).not.toHaveBeenCalled()
  })

  it('different pages are warmed independently', async () => {
    const page1 = createMockPage({ url: 'about:blank' })
    const page2 = createMockPage({ url: 'about:blank' })

    const p1 = warmSession(page1, 'https://www.expedia.com/')
    await vi.advanceTimersByTimeAsync(3_000)
    await p1

    const p2 = warmSession(page2, 'https://www.expedia.com/')
    await vi.advanceTimersByTimeAsync(3_000)
    await p2

    // Both pages should have navigated
    expect(page1.goto).toHaveBeenCalled()
    expect(page2.goto).toHaveBeenCalled()
  })
})

describe('warmSession — waitFor predicate', () => {
  it('resolves once predicate returns true', async () => {
    const page = createMockPage({ url: 'https://web.telegram.org/' })
    let calls = 0
    const waitFor = vi.fn(async () => {
      calls += 1
      return calls >= 3
    })

    const promise = warmSession(page, 'https://web.telegram.org/', { waitFor })
    await vi.advanceTimersByTimeAsync(5_000)
    await promise

    expect(waitFor).toHaveBeenCalled()
    expect(calls).toBeGreaterThanOrEqual(3)
  })

  it('proceeds without throwing when predicate never becomes true', async () => {
    const page = createMockPage({ url: 'https://web.telegram.org/' })
    const waitFor = vi.fn(async () => false)

    const promise = warmSession(page, 'https://web.telegram.org/', {
      waitFor,
      waitForTimeoutMs: 1_000,
    })
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(promise).resolves.toBeUndefined()
    expect(waitFor).toHaveBeenCalled()
  })

  it('swallows predicate errors and proceeds', async () => {
    const page = createMockPage({ url: 'https://web.telegram.org/' })
    const waitFor = vi.fn(async () => {
      throw new Error('boom')
    })

    const promise = warmSession(page, 'https://web.telegram.org/', {
      waitFor,
      waitForTimeoutMs: 500,
    })
    await vi.advanceTimersByTimeAsync(2_000)

    await expect(promise).resolves.toBeUndefined()
  })
})

describe('warmSession — timeout behavior', () => {
  it('does not throw on timeout — warm-up is best-effort', async () => {
    const page = createMockPage({ url: 'about:blank' })
    const ctx = page.context() as unknown as { cookies: ReturnType<typeof vi.fn> }
    ctx.cookies.mockResolvedValue([]) // cookie never appears

    const promise = warmSession(page, 'https://www.expedia.com/', {
      waitForCookie: '_abck',
      timeoutMs: 1_000,
    })

    await vi.advanceTimersByTimeAsync(2_000)

    // Should resolve without error
    await expect(promise).resolves.toBeUndefined()
  })
})
