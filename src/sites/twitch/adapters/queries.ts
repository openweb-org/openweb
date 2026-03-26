import type { Page } from 'playwright-core'
import { OpenWebError } from '../../../lib/errors.js'

export const GQL_URL = 'https://gql.twitch.tv/gql'
export const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

/* ---------- persisted query hashes ---------- */

export const HASHES: Record<string, string> = {
  SearchResultsPage_SearchResults: 'a7c600111acc4d1b294eafa364600556227939e2ff88505faa73035b57a83b22',
  ChannelRoot_AboutPanel: '3b9cd4edd28e8e6f7ba6152a56157bc2b1c1a8f6e81d70808ad1b85250e5288f',
  StreamMetadata: 'ad022ca32220d5523d03a23cbcb5beaa1e0999889c1f8f78f9f2520dafb5cae6',
  StreamSchedule: '566e760a2eef3bab1a7f38780fa6d706eb2c16655190b63bb5cd64a0507a7603',
  ChannelVideoShelvesQuery: '280f582866d0914749c1666da7adfcdb42739182b060ef4050641aa9324da19b',
  ClipsCards__User: '1cd671bfa12cec480499c087319f26d21925e9695d1f80225aae6a4354f23088',
  BrowsePage_AllDirectories: '2f67f71ba89f3c0ed26a141ec00da1defecb2303595f5cda4298169549783d9e',
  DirectoryPage_Game: '76cb069d835b8a02914c08dc42c421d0dafda8af5b113a3f19141824b901402f',
  Shelves: '39028193f996861ef63525442dcbeb2696ac5e399f05af561d2a984efbb6cdc4',
  FeaturedContentCarouselStreams: '4c96356ae0f580a65a4b16fc131e95434e3a2f631b4a325b7e1c4059487f6f15',
}

/* ---------- GraphQL fetch ---------- */

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
      const resp = await fetch(args.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Client-ID': args.clientId },
        body: args.body,
      })
      return { status: resp.status, text: await resp.text() }
    },
    { url: GQL_URL, body, clientId: CLIENT_ID },
  )

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  const json = JSON.parse(result.text) as { data?: unknown; errors?: unknown[] }
  if (json.errors) {
    const msg = (json.errors[0] as Record<string, string>)?.message ?? 'Unknown GQL error'
    throw OpenWebError.apiError('GraphQL ' + operationName, msg)
  }

  return json.data
}

/* ---------- GraphQL mutation (inline query, requires auth) ---------- */

export async function gqlMutate(
  page: Page,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const body = JSON.stringify({ query, variables })

  const result = await page.evaluate(
    async (args: { url: string; body: string; clientId: string }) => {
      const cookies = document.cookie.split(';').reduce(
        (acc, c) => {
          const [k, ...v] = c.trim().split('=')
          acc[k] = v.join('=')
          return acc
        },
        {} as Record<string, string>,
      )
      const authToken = cookies['auth-token']
      const headers: Record<string, string> = {
        'Content-Type': 'text/plain;charset=UTF-8',
        'Client-ID': args.clientId,
      }
      if (authToken) headers['Authorization'] = `OAuth ${authToken}`

      const resp = await fetch(args.url, { method: 'POST', headers, body: args.body })
      return { status: resp.status, text: await resp.text() }
    },
    { url: GQL_URL, body, clientId: CLIENT_ID },
  )

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  const json = JSON.parse(result.text) as { data?: unknown; errors?: unknown[] }
  if (json.errors) {
    const msg = (json.errors[0] as Record<string, string>)?.message ?? 'Unknown GQL error'
    throw OpenWebError.apiError('GraphQL mutation', msg)
  }

  return json.data
}

/* ---------- query operations ---------- */

export async function getTopStreams(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const limit = Number(params.limit ?? 8)

  const data = (await gqlFetch(page, 'Shelves', {
    imageWidth: 50,
    itemsPerRow: limit,
    langWeightedCCU: true,
    platform: 'web',
    limit: 3,
    requestID: '',
    includeCostreaming: true,
    context: { clientApp: 'twilight', location: 'home' },
    verbose: false,
  })) as Record<string, unknown>

  const shelves = data.shelves as Record<string, unknown>
  const edges = (shelves?.edges ?? []) as Array<Record<string, unknown>>

  return {
    shelves: edges.map((e) => {
      const node = e.node as Record<string, unknown>
      const title = node?.title as Record<string, unknown>
      const content = node?.content as Record<string, unknown>
      const contentEdges = (content?.edges ?? []) as Array<Record<string, unknown>>

      return {
        id: node?.id,
        title: title?.fallbackLocalizedTitle,
        streams: contentEdges.map((ce) => {
          const stream = ce.node as Record<string, unknown>
          const broadcaster = stream?.broadcaster as Record<string, unknown>
          const broadcastSettings = broadcaster?.broadcastSettings as Record<string, unknown>
          const streamGame = stream?.game as Record<string, unknown>
          return {
            id: stream?.id,
            title: broadcastSettings?.title,
            viewersCount: stream?.viewersCount,
            previewImageURL: stream?.previewImageURL,
            broadcaster: broadcaster
              ? { login: broadcaster.login, displayName: broadcaster.displayName }
              : null,
            game: streamGame ? { id: streamGame.id, name: streamGame.name } : null,
          }
        }),
      }
    }),
  }
}
