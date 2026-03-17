import { describe, expect, it, vi } from 'vitest'

import { executeOperation } from './executor.js'

function mockBrowser(
  pages: Array<{ url: string; content?: string; evaluateResult?: unknown }>,
  cookies: Array<{ name: string; value: string }> = [],
): import('playwright').Browser {
  const fullCookies = cookies.map((cookie) => ({
    ...cookie,
    domain: new URL(pages[0]?.url ?? 'https://example.com').hostname,
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax' as const,
    expires: -1,
  }))

  return {
    contexts: () => [
      {
        cookies: vi.fn(async () => fullCookies),
        pages: () =>
          pages.map((page) => ({
            url: () => page.url,
            content: vi.fn(async () => page.content ?? '<html><body>ready</body></html>'),
            evaluate: vi.fn(async () => page.evaluateResult),
          })),
      },
    ],
    close: vi.fn(async () => {}),
  } as unknown as import('playwright').Browser
}

describe('Phase 2 fixtures', () => {
  it('executes Walmart extraction operations through executeOperation()', async () => {
    const browser = mockBrowser([
      {
        url: 'https://www.walmart.com/',
        evaluateResult: {
          props: {
            pageProps: {
              bootstrapData: {
                footer: {
                  data: {
                    contentLayout: {
                      modules: [
                        {
                          module: {
                            type: 'GlobalFooterLinks',
                            name: 'Footer',
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    ])

    const result = await executeOperation('walmart-fixture', 'getFooterModules', {}, { browser })

    expect(result.status).toBe(200)
    expect(result.responseSchemaValid).toBe(true)
    expect(result.body).toEqual([
      {
        module: {
          type: 'GlobalFooterLinks',
          name: 'Footer',
        },
      },
    ])
  })

  it('executes Hacker News DOM extraction through executeOperation()', async () => {
    const browser = mockBrowser([
      {
        url: 'https://news.ycombinator.com/news',
        evaluateResult: {
          title: ['Post 1', 'Post 2'],
          score: ['10 points'],
          author: ['alice', 'bob'],
        },
      },
    ])

    const result = await executeOperation('hackernews-fixture', 'getTopStories', {}, { browser })

    expect(result.status).toBe(200)
    expect(result.responseSchemaValid).toBe(true)
    expect(result.body).toEqual([
      { title: 'Post 1', score: '10 points', author: 'alice' },
      { title: 'Post 2', score: null, author: 'bob' },
    ])
  })

  it('executes Microsoft Word profile requests against Graph with an MSAL bearer token', async () => {
    const browser = mockBrowser([
      {
        url: 'https://word.cloud.microsoft/',
        evaluateResult: {
          sessionStorage: {},
          localStorage: {
            'msal.token.keys.client': JSON.stringify({
              accessToken: ['token.graph'],
            }),
            'token.graph': JSON.stringify({
              credentialType: 'AccessToken',
              target: 'https://graph.microsoft.com/User.Read',
              secret: 'graph-token',
              expiresOn: '4102444800',
            }),
          },
        },
      },
    ])

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'user-1',
          displayName: 'Qi Guo',
          userPrincipalName: 'guoqithu10@gmail.com',
          mail: 'guoqithu10@gmail.com',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    const result = await executeOperation('microsoft-word-fixture', 'getProfile', {}, {
      browser,
      fetchImpl: fetchMock,
      ssrfValidator: async () => {},
    })

    expect(result.status).toBe(200)
    expect(result.responseSchemaValid).toBe(true)

    const [calledUrl, calledInit] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(String(calledUrl)).toBe('https://graph.microsoft.com/v1.0/me')
    expect((calledInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer graph-token',
    })
  })
})
