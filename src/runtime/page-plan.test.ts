import { describe, expect, it, vi } from 'vitest'

import type { BrowserContext, Page } from 'patchright'
import { acquirePage, matchesEntryUrl } from './page-plan.js'

function mockPage(url: string, overrides: Partial<Page> = {}): Page {
  return {
    url: () => url,
    content: vi.fn(async () => '<html><body>ok</body></html>'),
    close: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    goto: vi.fn(async () => null),
    ...overrides,
  } as unknown as Page
}

function mockContext(pages: Page[]): BrowserContext {
  return {
    pages: () => pages,
    newPage: vi.fn(async () => mockPage('about:blank', {
      goto: vi.fn(async () => null),
    })),
  } as unknown as BrowserContext
}

describe('matchesEntryUrl', () => {
  it('matches same-origin + exact path', () => {
    expect(matchesEntryUrl('https://a.com/x', 'https://a.com/x')).toBe(true)
  })

  it('matches same-origin + path prefix boundary', () => {
    expect(matchesEntryUrl('https://a.com/x/y', 'https://a.com/x')).toBe(true)
  })

  it('rejects non-boundary prefix (x vs xyz)', () => {
    expect(matchesEntryUrl('https://a.com/xyz', 'https://a.com/x')).toBe(false)
  })

  it('rejects different origin', () => {
    expect(matchesEntryUrl('https://b.com/x', 'https://a.com/x')).toBe(false)
  })

  it('treats entry root as match-all for that origin', () => {
    expect(matchesEntryUrl('https://a.com/anything', 'https://a.com/')).toBe(true)
  })

  it('returns false on malformed URL', () => {
    expect(matchesEntryUrl('not-a-url', 'https://a.com/')).toBe(false)
  })
})

describe('acquirePage', () => {
  it('reuses an existing page that prefix-matches entry_url', async () => {
    const existing = mockPage('https://shop.com/dp/B1/details')
    const context = mockContext([existing])
    const result = await acquirePage(context, 'https://shop.com', {
      entry_url: 'https://shop.com/dp/B1',
    })
    expect(result.page).toBe(existing)
    expect(result.owned).toBe(false)
    expect(context.newPage).not.toHaveBeenCalled()
  })

  it('navigates to entry_url when no page matches', async () => {
    const newPage = mockPage('https://shop.com/dp/B1', {
      goto: vi.fn(async () => null),
    })
    const context = {
      pages: () => [mockPage('https://other.com/')],
      newPage: vi.fn(async () => newPage),
    } as unknown as BrowserContext

    const result = await acquirePage(context, 'https://shop.com', {
      entry_url: 'https://shop.com/dp/B1',
    })
    expect(result.page).toBe(newPage)
    expect(result.owned).toBe(true)
    expect(context.newPage).toHaveBeenCalledTimes(1)
    expect(newPage.goto).toHaveBeenCalledWith(
      'https://shop.com/dp/B1',
      expect.objectContaining({ waitUntil: 'load' }),
    )
  })

  it('honors wait_until and nav_timeout_ms overrides', async () => {
    const newPage = mockPage('https://shop.com/', {
      goto: vi.fn(async () => null),
    })
    const context = {
      pages: () => [],
      newPage: vi.fn(async () => newPage),
    } as unknown as BrowserContext

    await acquirePage(context, 'https://shop.com', {
      entry_url: 'https://shop.com/',
      wait_until: 'domcontentloaded',
      nav_timeout_ms: 1234,
    })
    expect(newPage.goto).toHaveBeenCalledWith(
      'https://shop.com/',
      { waitUntil: 'domcontentloaded', timeout: 1234 },
    )
  })

  it('applies settle_ms after navigation', async () => {
    const newPage = mockPage('https://a.com/', { goto: vi.fn(async () => null) })
    const context = {
      pages: () => [],
      newPage: vi.fn(async () => newPage),
    } as unknown as BrowserContext

    await acquirePage(context, 'https://a.com', {
      entry_url: 'https://a.com/',
      settle_ms: 500,
    })
    expect(newPage.waitForTimeout).toHaveBeenCalledWith(500)
  })

  it('throws needs_page when navigation fails and no fallback succeeds', async () => {
    const context = {
      pages: () => [],
      newPage: vi.fn(async () => { throw new Error('context gone') }),
    } as unknown as BrowserContext

    await expect(
      acquirePage(context, 'https://a.com', { entry_url: 'https://a.com/' }),
    ).rejects.toMatchObject({
      payload: { failureClass: 'needs_page' },
    })
  })
})
