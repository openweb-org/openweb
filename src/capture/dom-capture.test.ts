import { describe, expect, it, vi } from 'vitest'
import { detectDynamicGlobals } from './dom-capture.js'

describe('detectDynamicGlobals', () => {
  it('returns non-standard window globals of object type', async () => {
    const mockPage = {
      evaluate: vi.fn(async () => ['customAppState', 'siteConfig']),
    }

    const result = await detectDynamicGlobals(mockPage as any)
    expect(result).toEqual(['customAppState', 'siteConfig'])
    expect(mockPage.evaluate).toHaveBeenCalledTimes(1)
  })
})

describe('captureDomAndGlobals with extraGlobals', () => {
  it('passes merged globals to page.evaluate', async () => {
    const { captureDomAndGlobals } = await import('./dom-capture.js')

    const mockPage = {
      evaluate: vi.fn(async () => ({
        metaTags: [],
        scriptJsonTags: [],
        hiddenInputs: [],
        globals: { __NEXT_DATA__: 'object', CUSTOM_VAR: 'object' },
        webpackChunks: [],
        gapiAvailable: false,
      })),
      url: vi.fn(() => 'https://example.com'),
    }

    await captureDomAndGlobals(mockPage as any, 'page_load', ['CUSTOM_VAR'])

    const passedGlobals = mockPage.evaluate.mock.calls[0]![1] as string[]
    expect(passedGlobals).toContain('__NEXT_DATA__')
    expect(passedGlobals).toContain('CUSTOM_VAR')
  })
})
