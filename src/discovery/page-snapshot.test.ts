import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright'

import { takePageSnapshot } from './page-snapshot.js'

function mockPage(evaluateResult: unknown): Page {
  return { evaluate: vi.fn(async (fn: () => unknown) => evaluateResult) } as unknown as Page
}

describe('takePageSnapshot', () => {
  it('extracts nav links from page', async () => {
    const snapshot = await takePageSnapshot(
      mockPage({
        navLinks: [
          { text: 'Home', href: '/', isInternal: true },
          { text: 'Profile', href: '/profile', isInternal: true },
          { text: 'External', href: 'https://other.com', isInternal: false },
        ],
        headings: [],
        buttons: [],
        forms: [],
        searchInputs: [],
      }),
    )

    expect(snapshot.navLinks).toHaveLength(3)
    expect(snapshot.navLinks[0]).toEqual({ text: 'Home', href: '/', isInternal: true })
    expect(snapshot.navLinks[2]?.isInternal).toBe(false)
  })

  it('extracts headings', async () => {
    const snapshot = await takePageSnapshot(
      mockPage({
        navLinks: [],
        headings: ['Welcome', 'Features', 'About'],
        buttons: [],
        forms: [],
        searchInputs: [],
      }),
    )

    expect(snapshot.headings).toEqual(['Welcome', 'Features', 'About'])
  })

  it('extracts buttons with types', async () => {
    const snapshot = await takePageSnapshot(
      mockPage({
        navLinks: [],
        headings: [],
        buttons: [
          { text: 'Submit', type: 'submit' },
          { text: 'Post', type: 'button' },
          { text: 'Like', type: 'other' },
        ],
        forms: [],
        searchInputs: [],
      }),
    )

    expect(snapshot.buttons).toHaveLength(3)
    expect(snapshot.buttons[0]).toEqual({ text: 'Submit', type: 'submit' })
  })

  it('extracts forms with input names', async () => {
    const snapshot = await takePageSnapshot(
      mockPage({
        navLinks: [],
        headings: [],
        buttons: [],
        forms: [
          { action: '/api/login', method: 'POST', inputNames: ['username', 'password'] },
          { action: '/search', method: 'GET', inputNames: ['q'] },
        ],
        searchInputs: [],
      }),
    )

    expect(snapshot.forms).toHaveLength(2)
    expect(snapshot.forms[0]).toEqual({
      action: '/api/login',
      method: 'POST',
      inputNames: ['username', 'password'],
    })
  })

  it('extracts search inputs', async () => {
    const snapshot = await takePageSnapshot(
      mockPage({
        navLinks: [],
        headings: [],
        buttons: [],
        forms: [],
        searchInputs: [
          { placeholder: 'Search...', selector: '#search' },
          { placeholder: '', selector: 'input[name="q"]' },
        ],
      }),
    )

    expect(snapshot.searchInputs).toHaveLength(2)
    expect(snapshot.searchInputs[0]).toEqual({ placeholder: 'Search...', selector: '#search' })
  })

  it('handles empty page', async () => {
    const snapshot = await takePageSnapshot(
      mockPage({
        navLinks: [],
        headings: [],
        buttons: [],
        forms: [],
        searchInputs: [],
      }),
    )

    expect(snapshot.navLinks).toEqual([])
    expect(snapshot.headings).toEqual([])
    expect(snapshot.buttons).toEqual([])
    expect(snapshot.forms).toEqual([])
    expect(snapshot.searchInputs).toEqual([])
  })
})
