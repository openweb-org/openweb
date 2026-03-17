import { describe, expect, it } from 'vitest'

import type { PageSnapshot } from './page-snapshot.js'
import { analyzeIntents, type CapturedPath, type IntentAnalysis } from './intent.js'

function emptySnapshot(): PageSnapshot {
  return { navLinks: [], headings: [], buttons: [], forms: [], searchInputs: [] }
}

describe('analyzeIntents', () => {
  describe('API path matching', () => {
    it('detects profile intent from /me path', () => {
      const paths: CapturedPath[] = [{ path: '/api/me', method: 'GET' }]
      const result = analyzeIntents(emptySnapshot(), paths)
      expect(result.matched.find((m) => m.intent === 'profile')).toBeDefined()
    })

    it('detects feed intent from /feed path', () => {
      const paths: CapturedPath[] = [{ path: '/v1/feed', method: 'GET' }]
      const result = analyzeIntents(emptySnapshot(), paths)
      expect(result.matched.find((m) => m.intent === 'feed')).toBeDefined()
    })

    it('detects search intent from /search path', () => {
      const paths: CapturedPath[] = [{ path: '/api/search', method: 'GET' }]
      const result = analyzeIntents(emptySnapshot(), paths)
      expect(result.matched.find((m) => m.intent === 'search')).toBeDefined()
    })

    it('detects social intent from /messages path', () => {
      const paths: CapturedPath[] = [{ path: '/api/messages', method: 'GET' }]
      const result = analyzeIntents(emptySnapshot(), paths)
      expect(result.matched.find((m) => m.intent === 'social')).toBeDefined()
    })

    it('detects create intent from POST method', () => {
      const paths: CapturedPath[] = [{ path: '/api/posts', method: 'POST' }]
      const result = analyzeIntents(emptySnapshot(), paths)
      expect(result.matched.find((m) => m.intent === 'create')).toBeDefined()
    })

    it('detects update intent from PUT method', () => {
      const paths: CapturedPath[] = [{ path: '/api/items/123', method: 'PUT' }]
      const result = analyzeIntents(emptySnapshot(), paths)
      expect(result.matched.find((m) => m.intent === 'update')).toBeDefined()
    })

    it('detects delete intent from DELETE method', () => {
      const paths: CapturedPath[] = [{ path: '/api/items/123', method: 'DELETE' }]
      const result = analyzeIntents(emptySnapshot(), paths)
      expect(result.matched.find((m) => m.intent === 'delete')).toBeDefined()
    })
  })

  describe('page structure matching', () => {
    it('detects profile from nav link text', () => {
      const snapshot: PageSnapshot = {
        ...emptySnapshot(),
        navLinks: [{ text: 'My Profile', href: '/profile', isInternal: true }],
      }
      const result = analyzeIntents(snapshot, [])
      expect(result.matched.find((m) => m.intent === 'profile')).toBeDefined()
    })

    it('detects search from search inputs', () => {
      const snapshot: PageSnapshot = {
        ...emptySnapshot(),
        searchInputs: [{ placeholder: 'Search...', selector: '#search' }],
      }
      const result = analyzeIntents(snapshot, [])
      const match = result.matched.find((m) => m.intent === 'search')
      expect(match?.confidence).toBe('high')
    })

    it('detects create from button text', () => {
      const snapshot: PageSnapshot = {
        ...emptySnapshot(),
        buttons: [{ text: 'Post', type: 'button' }],
      }
      const result = analyzeIntents(snapshot, [])
      expect(result.matched.find((m) => m.intent === 'create')).toBeDefined()
    })

    it('detects transact from button text', () => {
      const snapshot: PageSnapshot = {
        ...emptySnapshot(),
        buttons: [{ text: 'Add to Cart', type: 'button' }],
      }
      const result = analyzeIntents(snapshot, [])
      expect(result.matched.find((m) => m.intent === 'transact')).toBeDefined()
    })

    it('detects create from POST form', () => {
      const snapshot: PageSnapshot = {
        ...emptySnapshot(),
        forms: [{ action: '/api/submit', method: 'POST', inputNames: ['title', 'body'] }],
      }
      const result = analyzeIntents(snapshot, [])
      expect(result.matched.find((m) => m.intent === 'create')).toBeDefined()
    })
  })

  describe('gap analysis', () => {
    it('identifies gaps for page intents not covered by API', () => {
      const snapshot: PageSnapshot = {
        ...emptySnapshot(),
        navLinks: [{ text: 'Profile', href: '/profile', isInternal: true }],
        searchInputs: [{ placeholder: 'Search...', selector: '#q' }],
      }
      // No API paths → both should be gaps
      const result = analyzeIntents(snapshot, [])
      expect(result.gaps.length).toBeGreaterThanOrEqual(2)
      expect(result.gaps.find((g) => g.intent === 'profile')).toBeDefined()
      expect(result.gaps.find((g) => g.intent === 'search')).toBeDefined()
    })

    it('no gap when API already covers the intent', () => {
      const snapshot: PageSnapshot = {
        ...emptySnapshot(),
        searchInputs: [{ placeholder: 'Search...', selector: '#q' }],
      }
      const paths: CapturedPath[] = [{ path: '/api/search', method: 'GET' }]
      const result = analyzeIntents(snapshot, paths)
      expect(result.gaps.find((g) => g.intent === 'search')).toBeUndefined()
    })

    it('upgrades to both source when API and page agree', () => {
      const snapshot: PageSnapshot = {
        ...emptySnapshot(),
        searchInputs: [{ placeholder: 'Search...', selector: '#q' }],
      }
      const paths: CapturedPath[] = [{ path: '/api/search', method: 'GET' }]
      const result = analyzeIntents(snapshot, paths)
      const match = result.matched.find((m) => m.intent === 'search')
      expect(match?.source).toBe('both')
      expect(match?.confidence).toBe('high')
    })
  })

  describe('edge cases', () => {
    it('handles empty inputs', () => {
      const result = analyzeIntents(emptySnapshot(), [])
      expect(result.matched).toEqual([])
      expect(result.gaps).toEqual([])
    })

    it('deduplicates intents from multiple API paths', () => {
      const paths: CapturedPath[] = [
        { path: '/api/search', method: 'GET' },
        { path: '/v2/search/advanced', method: 'GET' },
      ]
      const result = analyzeIntents(emptySnapshot(), paths)
      const searchMatches = result.matched.filter((m) => m.intent === 'search')
      expect(searchMatches).toHaveLength(1)
    })

    it('gap suggestion includes relevant UI element', () => {
      const snapshot: PageSnapshot = {
        ...emptySnapshot(),
        navLinks: [{ text: 'Notifications', href: '/notifications', isInternal: true }],
      }
      const result = analyzeIntents(snapshot, [])
      const gap = result.gaps.find((g) => g.intent === 'activity')
      expect(gap?.suggestion).toContain('Notifications')
    })
  })
})
