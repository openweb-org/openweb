import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright'

import type { IntentGap } from './intent.js'
import { exploreForIntents } from './explorer.js'
import type { PageSnapshot } from './page-snapshot.js'

function emptySnapshot(): PageSnapshot {
  return { navLinks: [], headings: [], buttons: [], forms: [], searchInputs: [] }
}

function mockPage(overrides: Partial<Record<'url' | 'click' | 'fill' | 'goto' | 'keyboard' | 'waitForLoadState'| 'evaluate', unknown>> = {}): Page {
  const page = {
    url: vi.fn(() => 'https://example.com'),
    click: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
    keyboard: { press: vi.fn(async () => {}) },
    waitForLoadState: vi.fn(async () => {}),
    evaluate: vi.fn(async () => []),
    ...overrides,
  }
  return page as unknown as Page
}

describe('exploreForIntents', () => {
  it('explores search intent via search inputs', async () => {
    const page = mockPage()
    const gaps: IntentGap[] = [{ intent: 'search', suggestion: 'submit a search query' }]
    const snapshot: PageSnapshot = {
      ...emptySnapshot(),
      searchInputs: [{ placeholder: 'Search...', selector: '#search' }],
    }

    const result = await exploreForIntents(page, gaps, snapshot)

    expect(result.searchesPerformed).toBe(1)
    expect(page.fill).toHaveBeenCalledWith('#search', 'test', expect.any(Object))
  })

  it('explores clickable intents via nav links', async () => {
    const page = mockPage()
    const gaps: IntentGap[] = [{ intent: 'profile', suggestion: 'click "Profile" link' }]
    const snapshot: PageSnapshot = {
      ...emptySnapshot(),
      navLinks: [{ text: 'My Profile', href: '/profile', isInternal: true }],
    }

    const result = await exploreForIntents(page, gaps, snapshot)

    expect(result.linksClicked).toBe(1)
    expect(page.click).toHaveBeenCalledWith('a[href="/profile"]', expect.any(Object))
  })

  it('skips destructive links', async () => {
    const page = mockPage()
    const gaps: IntentGap[] = [{ intent: 'profile', suggestion: 'click link' }]
    const snapshot: PageSnapshot = {
      ...emptySnapshot(),
      navLinks: [{ text: 'Delete Account', href: '/settings/account', isInternal: true }],
    }

    const result = await exploreForIntents(page, gaps, snapshot)

    expect(result.linksClicked).toBe(0)
    expect(result.skippedDestructive).toBe(1)
  })

  it('respects max per-intent limit', async () => {
    const page = mockPage()
    const gaps: IntentGap[] = [{ intent: 'profile', suggestion: 'click link' }]
    const snapshot: PageSnapshot = {
      ...emptySnapshot(),
      navLinks: Array.from({ length: 10 }, (_, i) => ({
        text: `My Profile ${String(i)}`,
        href: `/profile/${String(i)}`,
        isInternal: true,
      })),
    }

    const result = await exploreForIntents(page, gaps, snapshot)

    // MAX_PER_INTENT = 3, so only 3 of 10 matching links should be clicked
    expect(result.linksClicked).toBe(3)
  }, 15_000)

  it('logs write intents without executing', async () => {
    const log = vi.fn()
    const page = mockPage()
    const gaps: IntentGap[] = [{ intent: 'create', suggestion: 'interact with Post button' }]

    await exploreForIntents(page, gaps, emptySnapshot(), log)

    expect(log).toHaveBeenCalledWith(expect.stringContaining('write intent recorded'))
    expect(page.click).not.toHaveBeenCalled()
  })

  it('returns empty result for no gaps', async () => {
    const page = mockPage()
    const result = await exploreForIntents(page, [], emptySnapshot())

    expect(result.linksClicked).toBe(0)
    expect(result.searchesPerformed).toBe(0)
    expect(result.discoveredUrls).toEqual([])
  })
})
