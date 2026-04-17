import { describe, expect, it, vi } from 'vitest'

import { resolveHtmlSelector } from './html-selector.js'
import { resolvePageGlobalData } from './page-global-data.js'
import { resolveSsrNextData } from './ssr-next-data.js'
import type { BrowserHandle } from './types.js'

function mockHandle(evaluateResult: unknown): BrowserHandle {
  return {
    page: {
      evaluate: vi.fn(async () => evaluateResult),
    } as unknown as BrowserHandle['page'],
    context: {} as BrowserHandle['context'],
  }
}

describe('resolveSsrNextData', () => {
  it('extracts a nested value from __NEXT_DATA__', async () => {
    const handle = mockHandle({
      props: {
        pageProps: {
          sections: [{ id: 'hero' }, { id: 'deals' }],
        },
      },
    })

    const result = await resolveSsrNextData(handle, {
      path: 'props.pageProps.sections',
    })

    expect(result).toEqual([{ id: 'hero' }, { id: 'deals' }])
  })

  it('throws when the configured path is missing', async () => {
    const handle = mockHandle({
      props: {
        pageProps: {},
      },
    })

    await expect(
      resolveSsrNextData(handle, {
        path: 'props.pageProps.sections',
      }),
    ).rejects.toMatchObject({
      payload: { code: 'EXECUTION_FAILED', failureClass: 'fatal' },
    })
  })

  it('resolves Apollo __ref pointers when resolve_apollo_refs is set', async () => {
    const handle = mockHandle({
      props: {
        pageProps: {
          apolloState: {
            'Book:123': {
              __typename: 'Book',
              title: 'Dune',
              primaryContributorEdge: { node: { __ref: 'Contributor:456' } },
            },
            'Contributor:456': { __typename: 'Contributor', name: 'Frank Herbert' },
          },
        },
      },
    })

    const result = await resolveSsrNextData(handle, {
      path: 'props.pageProps.apolloState.Book:123',
      resolve_apollo_refs: true,
      apollo_cache_path: 'props.pageProps.apolloState',
    }) as Record<string, unknown>
    const edge = result.primaryContributorEdge as Record<string, unknown>
    const node = edge.node as Record<string, unknown>

    expect(result.title).toBe('Dune')
    expect(node.name).toBe('Frank Herbert')
  })
})

describe('resolveHtmlSelector', () => {
  it('returns a single object when multiple is false', async () => {
    const handle = mockHandle({
      title: ['Launch Week'],
      link: ['/launch-week'],
    })

    const result = await resolveHtmlSelector(handle, {
      selectors: {
        title: '.headline',
        link: '.headline a',
      },
    })

    expect(result).toEqual({
      title: 'Launch Week',
      link: '/launch-week',
    })
  })

  it('zips selector arrays into records when multiple is true', async () => {
    const handle = mockHandle({
      title: ['Post 1', 'Post 2'],
      link: ['/p1', '/p2'],
      score: ['10 points'],
    })

    const result = await resolveHtmlSelector(handle, {
      selectors: {
        title: '.titleline > a',
        link: '.titleline > a[href]',
        score: '.score',
      },
      multiple: true,
    })

    expect(result).toEqual([
      { title: 'Post 1', link: '/p1', score: '10 points' },
      { title: 'Post 2', link: '/p2', score: null },
    ])
  })

  it('throws when nothing matches any selector', async () => {
    const handle = mockHandle({
      title: [],
      link: [],
    })

    await expect(
      resolveHtmlSelector(handle, {
        selectors: {
          title: '.headline',
          link: '.headline a',
        },
      }),
    ).rejects.toMatchObject({
      payload: { code: 'EXECUTION_FAILED', failureClass: 'retriable' },
    })
  })
})

describe('resolvePageGlobalData', () => {
  it('extracts a nested page-global value with array indexes', async () => {
    const handle = mockHandle({
      viewer: {
        teams: [
          { id: 'team-1' },
          { id: 'team-2' },
        ],
      },
    })

    const result = await resolvePageGlobalData(handle, {
      expression: 'window.__STATE__',
      path: 'viewer.teams.1.id',
    })

    expect(result).toBe('team-2')
  })

  it('throws when the configured page-global path is missing', async () => {
    const handle = mockHandle({
      viewer: {},
    })

    await expect(
      resolvePageGlobalData(handle, {
        expression: 'window.__STATE__',
        path: 'viewer.teams.0.id',
      }),
    ).rejects.toMatchObject({
      payload: { code: 'EXECUTION_FAILED', failureClass: 'fatal' },
    })
  })
})
