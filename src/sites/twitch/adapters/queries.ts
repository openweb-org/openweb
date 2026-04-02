import type { Page } from 'playwright-core'

export const GQL_URL = 'https://gql.twitch.tv/gql'
export const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

export const HASHES: Record<string, string> = {
  SearchResultsPage_SearchResults: 'a7c600111acc4d1b294eafa364600556227939e2ff88505faa73035b57a83b22',
  ChannelRoot_AboutPanel: '3b9cd4edd28e8e6f7ba6152a56157bc2b1c1a8f6e81d70808ad1b85250e5288f',
  StreamMetadata: 'ad022ca32220d5523d03a23cbcb5beaa1e0999889c1f8f78f9f2520dafb5cae6',
  BrowsePage_AllDirectories: '2f67f71ba89f3c0ed26a141ec00da1defecb2303595f5cda4298169549783d9e',
}

export async function gqlFetch(
  page: Page,
  operationName: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const body = JSON.stringify({
    operationName,
    variables,
    extensions: { persistedQuery: { version: 1, sha256Hash: HASHES[operationName] } },
  })

  const result = await page.evaluate(
    async (args: { url: string; body: string; clientId: string }) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const r = await fetch(args.url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Client-ID': args.clientId },
          body: args.body,
          signal: ctrl.signal,
        })
        return { status: r.status, text: await r.text() }
      } finally {
        clearTimeout(timer)
      }
    },
    { url: GQL_URL, body, clientId: CLIENT_ID },
  )

  if (result.status >= 400) {
    throw Object.assign(new Error(`HTTP ${result.status}`), { failureClass: 'fatal' })
  }

  const json = JSON.parse(result.text) as { data?: unknown; errors?: unknown[] }
  if (json.errors) {
    const msg = (json.errors[0] as Record<string, string>)?.message ?? 'Unknown GQL error'
    throw Object.assign(new Error(`GraphQL ${operationName}: ${msg}`), { failureClass: 'fatal' })
  }

  return json.data
}
