import { describe, expect, it } from 'vitest'

import type {
  AnalysisReport,
  AuthCandidate,
  ClusteredEndpoint,
} from '../types-v2.js'
import { buildCompilePlan } from './apply-curation.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCluster(overrides: Partial<ClusteredEndpoint> = {}): ClusteredEndpoint {
  return {
    id: 'c1',
    method: 'GET',
    host: 'api.example.com',
    pathTemplate: '/v1/items',
    sampleIds: ['s1'],
    sampleCount: 1,
    parameters: [],
    responseVariants: [
      { status: 200, kind: 'json', contentType: 'application/json', sampleCount: 1 },
    ],
    suggestedOperationId: 'getItems',
    suggestedSummary: 'Get items',
    ...overrides,
  }
}

function makeAuthCandidate(overrides: Partial<AuthCandidate> = {}): AuthCandidate {
  return {
    id: 'auth-1',
    rank: 1,
    transport: 'node',
    confidence: 0.9,
    evidence: {
      matchedEntries: 10,
      totalEntries: 10,
      notes: [],
    },
    ...overrides,
  }
}

function makeReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    version: 2,
    site: 'example',
    sourceUrl: 'https://example.com',
    generatedAt: '2025-01-01T00:00:00Z',
    summary: {
      totalSamples: 1,
      malformedSamples: 0,
      byCategory: { api: 1, static: 0, tracking: 0, off_domain: 0 },
      byResponseKind: { json: 1, html: 0, empty: 0, binary: 0, text: 0 },
      clusterCount: 1,
    },
    navigation: [],
    samples: [],
    clusters: [makeCluster()],
    authCandidates: [makeAuthCandidate()],
    extractionSignals: [],
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('buildCompilePlan', () => {
  it('produces a valid CuratedCompilePlan with defaults', () => {
    const report = makeReport()
    const plan = buildCompilePlan(report)

    expect(plan.site).toBe('example')
    expect(plan.sourceUrl).toBe('https://example.com')
    expect(plan.operations).toHaveLength(1)
    expect(plan.operations[0].operationId).toBe('getItems')
    expect(plan.operations[0].permission).toBe('read')
    expect(plan.operations[0].replaySafety).toBe('safe_read')
  })

  it('defaults to highest-ranked auth candidate', () => {
    const report = makeReport({
      authCandidates: [
        makeAuthCandidate({ id: 'auth-2', rank: 2, transport: 'page' }),
        makeAuthCandidate({ id: 'auth-1', rank: 1, transport: 'node' }),
      ],
    })
    const plan = buildCompilePlan(report)
    expect(plan.context.transport).toBe('node')
    expect(plan.context.selectedAuthCandidateId).toBe('auth-1')
  })

  it('handles no auth candidates', () => {
    const report = makeReport({ authCandidates: [] })
    const plan = buildCompilePlan(report)
    expect(plan.context.transport).toBe('node')
    expect(plan.context.auth).toBeUndefined()
  })

  // G-4 fix: GraphQL queries default to read
  it('defaults GraphQL query to read permission even for POST', () => {
    const report = makeReport({
      clusters: [
        makeCluster({
          method: 'POST',
          graphql: {
            endpointPath: '/graphql',
            operationType: 'query',
            operationName: 'GetUser',
            discriminator: 'operationName',
          },
        }),
      ],
    })
    const plan = buildCompilePlan(report)
    expect(plan.operations[0].permission).toBe('read')
    expect(plan.operations[0].replaySafety).toBe('safe_read')
  })

  it('defaults GraphQL mutation to write + unsafe_mutation', () => {
    const report = makeReport({
      clusters: [
        makeCluster({
          method: 'POST',
          graphql: {
            endpointPath: '/graphql',
            operationType: 'mutation',
            operationName: 'UpdateUser',
            discriminator: 'operationName',
          },
        }),
      ],
    })
    const plan = buildCompilePlan(report)
    expect(plan.operations[0].permission).toBe('write')
    expect(plan.operations[0].replaySafety).toBe('unsafe_mutation')
  })

  it('defaults DELETE to delete permission', () => {
    const report = makeReport({
      clusters: [makeCluster({ method: 'DELETE' })],
    })
    const plan = buildCompilePlan(report)
    expect(plan.operations[0].permission).toBe('delete')
  })

  it('defaults POST to write permission', () => {
    const report = makeReport({
      clusters: [makeCluster({ method: 'POST' })],
    })
    const plan = buildCompilePlan(report)
    expect(plan.operations[0].permission).toBe('write')
    expect(plan.operations[0].replaySafety).toBe('unsafe_mutation')
  })

  it('scrubs PII from example inputs', () => {
    const report = makeReport({
      clusters: [
        makeCluster({
          parameters: [
            {
              name: 'email',
              location: 'query',
              required: false,
              schema: { type: 'string' },
              exampleValue: 'alice@company.com',
            },
          ],
        }),
      ],
    })
    const plan = buildCompilePlan(report)
    expect(plan.operations[0].exampleInput.email).toBe('user@example.com')
  })

  it('is a pure function (same inputs → same output)', () => {
    const report = makeReport()
    const plan1 = buildCompilePlan(report)
    const plan2 = buildCompilePlan(report)
    expect(plan1).toEqual(plan2)
  })

  it('builds WS plan when present', () => {
    const report = makeReport({
      ws: {
        connections: [
          {
            id: 'ws-1',
            url: 'wss://example.com/ws',
            sampleCount: 5,
            executableOperationCount: 2,
            operations: [
              { operationId: 'ws_send_subscribe_ticker', pattern: 'subscribe', direction: 'sent' },
              { operationId: 'ws_recv_ticker', pattern: 'stream', direction: 'received' },
            ],
            heartbeatCandidates: [],
          },
        ],
        heartbeatCandidates: [
          { direction: 'send', intervalMs: 30000, payload: 'ping' },
        ],
      },
    })
    const plan = buildCompilePlan(report)
    expect(plan.ws).toBeDefined()
    expect(plan.ws?.serverUrl).toBe('wss://example.com/ws')
    expect(plan.ws?.heartbeat).toEqual({ direction: 'send', intervalMs: 30000, payload: 'ping' })
    expect(plan.ws?.operations).toHaveLength(2)
    expect(plan.ws?.operations[0]).toEqual({
      id: 'ws_send_subscribe_ticker',
      name: 'ws_send_subscribe_ticker',
      pattern: 'subscribe',
    })
    expect(plan.ws?.operations[1]).toEqual({
      id: 'ws_recv_ticker',
      name: 'ws_recv_ticker',
      pattern: 'stream',
    })
  })

  it('omits WS plan when not present in report', () => {
    const plan = buildCompilePlan(makeReport())
    expect(plan.ws).toBeUndefined()
  })
})
