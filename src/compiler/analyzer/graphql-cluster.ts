import { createHash } from 'node:crypto'
import type { RecordedRequestSample } from '../types.js'
import type { GraphqlClusterInfo } from '../types-v2.js'

/** Returns true if all samples target a single GraphQL endpoint. */
export function detectGraphqlEndpoint(samples: RecordedRequestSample[]): boolean {
  if (samples.length === 0) return false

  const firstPath = samples[0].path
  const allSamePath = samples.every((s) => s.path === firstPath)
  if (!allSamePath) return false

  // Path contains 'graphql' (case-insensitive)
  if (/graphql/i.test(firstPath)) return true

  // All POST to same path with GraphQL body fields
  if (!samples.every((s) => s.method.toUpperCase() === 'POST')) return false
  return samples.some((s) => {
    const body = parseJsonBody(s.requestBody)
    return body !== undefined && ('operationName' in body || 'query' in body)
  })
}

/** Sub-clusters GraphQL samples by discriminator (priority: queryId > operationName > persistedQueryHash > parsed query name > queryShape). */
export function subClusterGraphql(
  samples: RecordedRequestSample[],
): Array<{ samples: RecordedRequestSample[]; graphql: GraphqlClusterInfo }> {
  if (samples.length === 0) return []

  const endpointPath = samples[0].path
  const groups = new Map<string, { samples: RecordedRequestSample[]; graphql: GraphqlClusterInfo }>()

  for (const sample of samples) {
    const { key, graphql } = extractDiscriminator(sample, endpointPath)
    const group = groups.get(key)
    if (group) {
      group.samples.push(sample)
    } else {
      groups.set(key, { samples: [sample], graphql })
    }
  }

  return [...groups.values()]
}

interface DiscriminatorResult {
  key: string
  graphql: GraphqlClusterInfo
}

function extractDiscriminator(sample: RecordedRequestSample, endpointPath: string): DiscriminatorResult {
  const body = parseJsonBody(sample.requestBody)
  const queryText = typeof body?.query === 'string' ? body.query : undefined

  // 1. queryId from query params (LinkedIn, Facebook persisted queries)
  const queryId = sample.query.queryId?.[0]
  if (queryId) {
    return {
      key: `queryId:${queryId}`,
      graphql: {
        endpointPath,
        discriminator: 'queryId',
        queryId,
        operationType: detectOperationType(queryText, queryId),
        operationName: queryId,
      },
    }
  }

  // 2. operationName from request body
  if (typeof body?.operationName === 'string' && body.operationName) {
    return {
      key: `operationName:${body.operationName}`,
      graphql: {
        endpointPath,
        discriminator: 'operationName',
        operationName: body.operationName,
        operationType: detectOperationType(queryText),
      },
    }
  }

  // 3. persistedQuery sha256Hash (Apollo APQ)
  const hash = body?.extensions?.persistedQuery?.sha256Hash
  if (typeof hash === 'string' && hash) {
    return {
      key: `persistedQueryHash:${hash}`,
      graphql: {
        endpointPath,
        discriminator: 'persistedQueryHash',
        persistedQueryHash: hash,
        operationType: detectOperationType(queryText),
      },
    }
  }

  // 4. Parse operation name from query text
  if (queryText) {
    const parsed = parseOperationName(queryText)
    if (parsed) {
      return {
        key: `operationName:${parsed.name}`,
        graphql: {
          endpointPath,
          discriminator: 'operationName',
          operationName: parsed.name,
          operationType: parsed.type,
        },
      }
    }

    // 5. Hash query text for grouping
    const shape = createHash('sha256').update(queryText.trim()).digest('hex').slice(0, 12)
    return {
      key: `queryShape:${shape}`,
      graphql: {
        endpointPath,
        discriminator: 'queryShape',
        operationType: detectOperationType(queryText),
      },
    }
  }

  // Fallback: no query text at all — group by 'unknown'
  return {
    key: 'queryShape:unknown',
    graphql: { endpointPath, discriminator: 'queryShape' },
  }
}

const OPERATION_NAME_RE = /^\s*(?:query|mutation|subscription)\s+(\w+)/

function parseOperationName(query: string): { name: string; type: 'query' | 'mutation' | 'subscription' } | undefined {
  const match = OPERATION_NAME_RE.exec(query)
  if (!match) return undefined
  const typeStr = query.trimStart().split(/\s/)[0].toLowerCase()
  return {
    name: match[1],
    type: typeStr as 'query' | 'mutation' | 'subscription',
  }
}

const OPERATION_TYPE_RE = /^\s*(query|mutation|subscription)\b/

function detectOperationType(
  queryText?: string,
  queryId?: string,
): 'query' | 'mutation' | 'subscription' | undefined {
  if (queryText) {
    const match = OPERATION_TYPE_RE.exec(queryText)
    if (match) return match[1] as 'query' | 'mutation' | 'subscription'
  }
  if (queryId) {
    const lower = queryId.toLowerCase()
    if (lower.startsWith('mutation')) return 'mutation'
    if (lower.startsWith('subscription')) return 'subscription'
  }
  return undefined
}

// biome-ignore lint/suspicious/noExplicitAny: GraphQL request bodies have dynamic structure
function parseJsonBody(body: string | undefined): Record<string, any> | undefined {
  if (!body) return undefined
  try {
    const parsed = JSON.parse(body)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
