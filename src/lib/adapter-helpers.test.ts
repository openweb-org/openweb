import { describe, expect, it, vi } from 'vitest'

import type { Page } from 'patchright'

import { domExtract, jsonLdExtract, ssrExtract } from './adapter-helpers.js'

type EvalFn = (fn: unknown, arg?: unknown) => Promise<unknown>

function mockPage(evaluate: EvalFn): Page {
  return {
    evaluate,
    context: () => ({}),
  } as unknown as Page
}

describe('ssrExtract', () => {
  it('extracts a path from __NEXT_DATA__ via the ssr-next-data resolver', async () => {
    // resolveSsrNextData runs its evaluator in-browser — in the mock we return
    // the already-parsed object (it accepts either outcome of the evaluator).
    const page = mockPage(vi.fn(async () => ({ props: { pageProps: { id: 42 } } })))
    const result = await ssrExtract(page, '__NEXT_DATA__', 'props.pageProps.id')
    expect(result).toBe(42)
  })

  it('delegates to page-global evaluation for non-NEXT sources', async () => {
    const page = mockPage(vi.fn(async () => ({ viewer: { name: 'ada' } })))
    const result = await ssrExtract(page, 'window.__STATE__', 'viewer.name')
    expect(result).toBe('ada')
  })

  it('throws when __NEXT_DATA__ is missing', async () => {
    const page = mockPage(vi.fn(async () => null))
    await expect(ssrExtract(page, '__NEXT_DATA__', 'foo')).rejects.toMatchObject({
      payload: { code: 'EXECUTION_FAILED' },
    })
  })
})

describe('jsonLdExtract', () => {
  it('returns all parsed ld+json blocks when no filter is given', async () => {
    const page = mockPage(vi.fn(async () => [
      '{"@type":"Thing","name":"A"}',
      '{"@type":"Product","name":"B"}',
    ]))
    const result = await jsonLdExtract(page)
    expect(result).toEqual([
      { '@type': 'Thing', name: 'A' },
      { '@type': 'Product', name: 'B' },
    ])
  })

  it('filters by @type, flattens array-wrapped blocks, skips malformed', async () => {
    const page = mockPage(vi.fn(async () => [
      '[{"@type":"Product","name":"X"},{"@type":"Thing","name":"Y"}]',
      '{not json}',
      '{"@type":["Review","Thing"],"author":"me"}',
    ]))
    const result = await jsonLdExtract(page, 'Thing')
    expect(result).toEqual([
      { '@type': 'Thing', name: 'Y' },
      { '@type': ['Review', 'Thing'], author: 'me' },
    ])
  })
})

describe('domExtract', () => {
  it('runs the evaluator against a single document when container is absent', async () => {
    const spec = {
      fields: {
        title: { selector: 'h1' },
        href: { selector: 'a', extract: 'attr:href' },
      },
    }
    // Simulate the in-browser evaluator by running the passed function with a
    // minimal DOM-shaped object.
    const page = mockPage(async (fn: unknown, arg: unknown) => {
      const doc = {
        querySelector: (sel: string) => {
          if (sel === 'h1') return { textContent: ' Hello ' }
          if (sel === 'a') return { getAttribute: (k: string) => k === 'href' ? '/x' : null }
          return null
        },
      }
      const g = globalThis as unknown as { document?: unknown }
      const prev = g.document
      g.document = doc
      try {
        return await (fn as (a: unknown) => unknown)(arg)
      } finally {
        g.document = prev
      }
    })
    const result = await domExtract(page, spec)
    expect(result).toEqual({ title: 'Hello', href: '/x' })
  })

  it('returns an array when container is set, and applies regex patterns', async () => {
    const spec = {
      container: '.row',
      fields: {
        id: { selector: '.id', pattern: '\\d+' },
      },
    }
    const page = mockPage(async (fn: unknown, arg: unknown) => {
      const rows = [
        { querySelector: (_s: string) => ({ textContent: 'user-123' }) },
        { querySelector: (_s: string) => ({ textContent: 'nope' }) },
      ]
      const doc = {
        querySelector: () => null,
        querySelectorAll: (_s: string) => rows,
      }
      const g = globalThis as unknown as { document?: unknown }
      const prev = g.document
      g.document = doc
      try {
        return await (fn as (a: unknown) => unknown)(arg)
      } finally {
        g.document = prev
      }
    })
    const result = await domExtract(page, spec)
    expect(result).toEqual([{ id: '123' }, { id: null }])
  })
})
