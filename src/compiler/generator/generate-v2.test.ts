import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import type {
  CuratedCompilePlan,
  CuratedOperation,
  CuratedSiteContext,
  CuratedWsPlan,
} from '../types-v2.js'
import { type GeneratedPackage, generateFromPlan } from './generate-v2.js'

// ── Factories ────────────────────────────────────────

function makeContext(overrides?: Partial<CuratedSiteContext>): CuratedSiteContext {
  return {
    transport: 'node',
    ...overrides,
  }
}

function makeOperation(overrides?: Partial<CuratedOperation>): CuratedOperation {
  return {
    id: 'cluster-1',
    sourceClusterIds: ['cluster-1'],
    method: 'get',
    host: 'api.example.com',
    pathTemplate: '/v1/items',
    operationId: 'listItems',
    summary: 'List all items',
    permission: 'read',
    replaySafety: 'safe_read',
    parameters: [
      {
        name: 'page',
        location: 'query',
        required: false,
        schema: { type: 'integer' },
        description: 'Page number',
        exampleValue: 1,
      },
    ],
    responseVariants: [
      {
        status: 200,
        kind: 'json',
        contentType: 'application/json',
        sampleCount: 3,
        schema: {
          type: 'object',
          properties: { items: { type: 'array', items: { type: 'object' } } },
        },
      },
    ],
    exampleInput: { page: 1 },
    ...overrides,
  }
}

function makePlan(overrides?: Partial<CuratedCompilePlan>): CuratedCompilePlan {
  return {
    site: 'test-site',
    sourceUrl: 'https://example.com',
    context: makeContext(),
    operations: [makeOperation()],
    ...overrides,
  }
}

function makeWsPlan(overrides?: Partial<CuratedWsPlan>): CuratedWsPlan {
  return {
    serverUrl: 'wss://gateway.example.com/ws',
    operations: [
      { id: 'ws_recv_ticker', name: 'recv_ticker', pattern: 'stream' },
      { id: 'ws_send_subscribe', name: 'send_subscribe', pattern: 'subscribe' },
    ],
    ...overrides,
  }
}

// ── Helpers ──────────────────────────────────────────

async function generateInTmp(plan: CuratedCompilePlan): Promise<GeneratedPackage & { tmpDir: string }> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-gen-v2-'))
  const result = await generateFromPlan(plan, tmpDir)
  return { ...result, tmpDir }
}

async function readYaml(outputRoot: string, name: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path.join(outputRoot, name), 'utf8')
  return parse(raw) as Record<string, unknown>
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
}

// ── Tests ────────────────────────────────────────────

describe('generateFromPlan', () => {
  it('generates openapi.yaml for HTTP-only plan', async () => {
    const plan = makePlan()
    const { outputRoot, files, tmpDir } = await generateInTmp(plan)
    try {
      expect(files).toContain('openapi.yaml')
      expect(files).toContain('manifest.json')
      expect(files).not.toContain('asyncapi.yaml')

      const spec = await readYaml(outputRoot, 'openapi.yaml')
      expect(spec.openapi).toBe('3.1.0')

      const info = spec.info as Record<string, unknown>
      expect(info.title).toBe('test-site')

      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>
      expect(paths['/v1/items']).toBeDefined()
      expect(paths['/v1/items'].get).toBeDefined()
      expect(paths['/v1/items'].get.operationId).toBe('listItems')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('generates asyncapi.yaml for WS plan', async () => {
    const plan = makePlan({
      operations: [],
      ws: makeWsPlan(),
    })
    const { outputRoot, files, tmpDir } = await generateInTmp(plan)
    try {
      expect(files).toContain('asyncapi.yaml')
      expect(files).not.toContain('openapi.yaml')

      const spec = await readYaml(outputRoot, 'asyncapi.yaml')
      expect(spec.asyncapi).toBe('3.0.0')

      const info = spec.info as Record<string, unknown>
      expect(info.title).toBe('test-site WebSocket API')

      const ops = spec.operations as Record<string, Record<string, unknown>>
      expect(ops.ws_recv_ticker).toBeDefined()
      expect(ops.ws_send_subscribe).toBeDefined()
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('emits permission from CuratedOperation, not derived from method', async () => {
    // POST with 'read' permission — would be 'write' if method-derived
    const plan = makePlan({
      operations: [
        makeOperation({
          method: 'post',
          pathTemplate: '/graphql',
          operationId: 'graphqlQuery',
          permission: 'read',
          replaySafety: 'safe_read',
        }),
      ],
    })
    const { outputRoot, tmpDir } = await generateInTmp(plan)
    try {
      const spec = await readYaml(outputRoot, 'openapi.yaml')
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>
      const xOpenweb = paths['/graphql'].post['x-openweb'] as Record<string, unknown>
      expect(xOpenweb.permission).toBe('read')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('maps replaySafety to risk_tier in x-openweb', async () => {
    const plan = makePlan({
      operations: [
        makeOperation({ operationId: 'safeOp', replaySafety: 'safe_read' }),
        makeOperation({
          id: 'cluster-2',
          sourceClusterIds: ['cluster-2'],
          method: 'post',
          pathTemplate: '/v1/orders',
          operationId: 'createOrder',
          permission: 'transact',
          replaySafety: 'unsafe_mutation',
          exampleInput: {},
          requestBodySchema: { type: 'object' },
          exampleRequestBody: { item: 'widget' },
        }),
      ],
    })
    const { outputRoot, tmpDir } = await generateInTmp(plan)
    try {
      const spec = await readYaml(outputRoot, 'openapi.yaml')
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>

      const safeExt = paths['/v1/items'].get['x-openweb'] as Record<string, unknown>
      expect(safeExt.risk_tier).toBe('safe')

      const unsafeExt = paths['/v1/orders'].post['x-openweb'] as Record<string, unknown>
      expect(unsafeExt.risk_tier).toBe('unsafe')
      expect(unsafeExt.permission).toBe('transact')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('emits auth/csrf/signing in server x-openweb extensions', async () => {
    const plan = makePlan({
      context: makeContext({
        auth: {
          type: 'header_static',
          inject: { header: 'Authorization', prefix: 'Bearer', key: 'API_TOKEN' },
        },
        csrf: {
          type: 'header_fetch',
          endpoint: '/api/csrf',
          field: 'token',
          inject: { header: 'X-CSRF-Token' },
        },
        signing: {
          type: 'hmac',
          key_env: 'HMAC_KEY',
          algorithm: 'sha256',
          inject: { header: 'X-Signature' },
        },
      }),
    })
    const { outputRoot, tmpDir } = await generateInTmp(plan)
    try {
      const spec = await readYaml(outputRoot, 'openapi.yaml')
      const servers = spec.servers as Array<Record<string, unknown>>
      const serverXOpenWeb = servers[0]['x-openweb'] as Record<string, unknown>

      expect(serverXOpenWeb.transport).toBe('node')
      expect(serverXOpenWeb.auth).toEqual({
        type: 'header_static',
        inject: { header: 'Authorization', prefix: 'Bearer', key: 'API_TOKEN' },
      })
      expect(serverXOpenWeb.csrf).toEqual({
        type: 'header_fetch',
        endpoint: '/api/csrf',
        field: 'token',
        inject: { header: 'X-CSRF-Token' },
      })
      expect(serverXOpenWeb.signing).toEqual({
        type: 'hmac',
        key_env: 'HMAC_KEY',
        algorithm: 'sha256',
        inject: { header: 'X-Signature' },
      })

      // Info requires_auth should be true
      const info = spec.info as Record<string, unknown>
      const infoExt = info['x-openweb'] as Record<string, unknown>
      expect(infoExt.requires_auth).toBe(true)
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('generates test files with scrubbed example data', async () => {
    const plan = makePlan({
      operations: [
        makeOperation({
          operationId: 'getUser',
          exampleInput: { user_id: 'SCRUBBED_ID_001' },
          exampleRequestBody: { name: 'SCRUBBED_NAME' },
        }),
      ],
    })
    const { outputRoot, files, tmpDir } = await generateInTmp(plan)
    try {
      expect(files).toContain('tests/getUser.test.json')
      const testData = await readJson(path.join(outputRoot, 'tests', 'getUser.test.json'))
      expect(testData.operation_id).toBe('getUser')
      expect(testData.request_body).toEqual({ name: 'SCRUBBED_NAME' })

      const cases = testData.cases as Array<Record<string, unknown>>
      expect(cases[0].input).toEqual({ user_id: 'SCRUBBED_ID_001' })
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('emits WS heartbeat in asyncapi server extensions (fixes G-10)', async () => {
    const heartbeat = {
      direction: 'send' as const,
      intervalMs: 30000,
      payload: { method: 'ping' },
    }
    const plan = makePlan({
      operations: [],
      ws: makeWsPlan({ heartbeat }),
    })
    const { outputRoot, tmpDir } = await generateInTmp(plan)
    try {
      const spec = await readYaml(outputRoot, 'asyncapi.yaml')
      const servers = spec.servers as Record<string, Record<string, unknown>>
      const srvKey = Object.keys(servers)[0]
      const serverXOpenWeb = servers[srvKey]['x-openweb'] as Record<string, unknown>
      expect(serverXOpenWeb.heartbeat).toEqual(heartbeat)
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns all generated files in the result', async () => {
    const plan = makePlan({
      ws: makeWsPlan(),
    })
    const { files, tmpDir } = await generateInTmp(plan)
    try {
      // HTTP files
      expect(files).toContain('openapi.yaml')
      expect(files).toContain('manifest.json')
      expect(files).toContain('tests/listItems.test.json')

      // WS files
      expect(files).toContain('asyncapi.yaml')
      expect(files).toContain('tests/ws_recv_ticker.test.json')
      expect(files).toContain('tests/ws_send_subscribe.test.json')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('handles empty plan gracefully', async () => {
    const plan = makePlan({ operations: [] })
    const { files, tmpDir } = await generateInTmp(plan)
    try {
      expect(files).toEqual([])
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('emits multiple response variants grouped by status', async () => {
    const plan = makePlan({
      operations: [
        makeOperation({
          responseVariants: [
            {
              status: 200,
              kind: 'json',
              contentType: 'application/json',
              sampleCount: 5,
              schema: { type: 'object', properties: { data: { type: 'array' } } },
            },
            {
              status: 401,
              kind: 'json',
              contentType: 'application/json',
              sampleCount: 1,
              schema: { type: 'object', properties: { error: { type: 'string' } } },
            },
            {
              status: 403,
              kind: 'json',
              contentType: 'application/json',
              sampleCount: 1,
            },
          ],
        }),
      ],
    })
    const { outputRoot, tmpDir } = await generateInTmp(plan)
    try {
      const spec = await readYaml(outputRoot, 'openapi.yaml')
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>
      const responses = paths['/v1/items'].get.responses as Record<string, Record<string, unknown>>

      expect(responses['200']).toBeDefined()
      expect(responses['200'].description).toBe('Success.')
      expect(responses['401']).toBeDefined()
      expect(responses['401'].description).toBe('Authentication required.')
      expect(responses['403']).toBeDefined()
      expect(responses['403'].description).toBe('Forbidden.')

      // 200 should have the provided schema
      const content200 = responses['200'].content as Record<string, Record<string, unknown>>
      expect(content200['application/json'].schema).toEqual({
        type: 'object',
        properties: { data: { type: 'array' } },
      })

      // 403 without schema should fall back to { type: 'object' }
      const content403 = responses['403'].content as Record<string, Record<string, unknown>>
      expect(content403['application/json'].schema).toEqual({ type: 'object' })
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('emits extraction signals in info x-openweb', async () => {
    const signals = [
      { type: 'ssr_next_data' as const, selector: '#__NEXT_DATA__', estimatedSize: 4096 },
    ]
    const plan = makePlan({ extractionSignals: signals })
    const { outputRoot, tmpDir } = await generateInTmp(plan)
    try {
      const spec = await readYaml(outputRoot, 'openapi.yaml')
      const info = spec.info as Record<string, unknown>
      const infoExt = info['x-openweb'] as Record<string, unknown>
      expect(infoExt.extraction_signals).toEqual(signals)
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('omits extraction_signals from info when empty or absent', async () => {
    const plan = makePlan()
    const { outputRoot, tmpDir } = await generateInTmp(plan)
    try {
      const spec = await readYaml(outputRoot, 'openapi.yaml')
      const info = spec.info as Record<string, unknown>
      const infoExt = info['x-openweb'] as Record<string, unknown>
      expect(infoExt.extraction_signals).toBeUndefined()
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('lowercases method keys in OpenAPI paths', async () => {
    const plan = makePlan({
      operations: [
        makeOperation({ method: 'GET' }),
        makeOperation({
          id: 'cluster-2',
          sourceClusterIds: ['cluster-2'],
          method: 'POST',
          pathTemplate: '/v1/items',
          operationId: 'createItem',
          permission: 'write',
          replaySafety: 'unsafe_mutation',
          exampleInput: {},
          requestBodySchema: { type: 'object' },
        }),
      ],
    })
    const { outputRoot, tmpDir } = await generateInTmp(plan)
    try {
      const spec = await readYaml(outputRoot, 'openapi.yaml')
      const paths = spec.paths as Record<string, Record<string, unknown>>
      const itemsPath = paths['/v1/items']

      // Keys should be lowercase per OpenAPI spec
      expect(itemsPath.get).toBeDefined()
      expect(itemsPath.post).toBeDefined()
      expect(itemsPath.GET).toBeUndefined()
      expect(itemsPath.POST).toBeUndefined()
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('deduplicates operationIds with _2, _3 suffixes', async () => {
    const plan = makePlan({
      operations: [
        makeOperation({ id: 'c1', operationId: 'getItems', pathTemplate: '/v1/items' }),
        makeOperation({ id: 'c2', operationId: 'getItems', pathTemplate: '/v2/items' }),
        makeOperation({ id: 'c3', operationId: 'getItems', pathTemplate: '/v3/items' }),
      ],
    })
    const { outputRoot, files, tmpDir } = await generateInTmp(plan)
    try {
      const spec = await readYaml(outputRoot, 'openapi.yaml')
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>

      expect(paths['/v1/items'].get.operationId).toBe('getItems')
      expect(paths['/v2/items'].get.operationId).toBe('getItems_2')
      expect(paths['/v3/items'].get.operationId).toBe('getItems_3')

      // Test files should also use deduplicated names
      expect(files).toContain('tests/getItems.test.json')
      expect(files).toContain('tests/getItems_2.test.json')
      expect(files).toContain('tests/getItems_3.test.json')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('uses primary 2xx status in test assertions even with error variants', async () => {
    const plan = makePlan({
      operations: [
        makeOperation({
          responseVariants: [
            { status: 401, kind: 'json', contentType: 'application/json', sampleCount: 2 },
            { status: 200, kind: 'json', contentType: 'application/json', sampleCount: 5 },
          ],
        }),
      ],
    })
    const { outputRoot, tmpDir } = await generateInTmp(plan)
    try {
      const testData = await readJson(path.join(outputRoot, 'tests', 'listItems.test.json'))
      const cases = testData.cases as Array<Record<string, unknown>>
      const assertions = cases[0].assertions as Record<string, unknown>
      expect(assertions.status).toBe(200)
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('generates virtual paths for operations sharing the same path+method', async () => {
    const plan = makePlan({
      operations: [
        makeOperation({
          id: 'gql-1',
          operationId: 'search_people',
          pathTemplate: '/voyager/api/graphql',
          method: 'get',
          summary: 'Search people',
        }),
        makeOperation({
          id: 'gql-2',
          operationId: 'get_profile',
          pathTemplate: '/voyager/api/graphql',
          method: 'get',
          summary: 'Get profile',
        }),
        makeOperation({
          id: 'gql-3',
          operationId: 'get_feed',
          pathTemplate: '/voyager/api/graphql',
          method: 'get',
          summary: 'Get feed',
        }),
        // Non-colliding operation should keep its original path
        makeOperation({
          id: 'rest-1',
          operationId: 'list_connections',
          pathTemplate: '/voyager/api/connections',
          method: 'get',
          summary: 'List connections',
        }),
      ],
    })
    const { outputRoot, files, tmpDir } = await generateInTmp(plan)
    try {
      const spec = await readYaml(outputRoot, 'openapi.yaml')
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>

      // Colliding operations get virtual paths with ~operationId
      expect(paths['/voyager/api/graphql~search_people']).toBeDefined()
      expect(paths['/voyager/api/graphql~search_people'].get.operationId).toBe('search_people')
      expect(paths['/voyager/api/graphql~get_profile']).toBeDefined()
      expect(paths['/voyager/api/graphql~get_profile'].get.operationId).toBe('get_profile')
      expect(paths['/voyager/api/graphql~get_feed']).toBeDefined()
      expect(paths['/voyager/api/graphql~get_feed'].get.operationId).toBe('get_feed')

      // Virtual paths have x-openweb.actual_path
      const searchExt = paths['/voyager/api/graphql~search_people'].get['x-openweb'] as Record<string, unknown>
      expect(searchExt.actual_path).toBe('/voyager/api/graphql')
      const profileExt = paths['/voyager/api/graphql~get_profile'].get['x-openweb'] as Record<string, unknown>
      expect(profileExt.actual_path).toBe('/voyager/api/graphql')

      // Non-colliding operation keeps its original path
      expect(paths['/voyager/api/connections']).toBeDefined()
      expect(paths['/voyager/api/connections'].get.operationId).toBe('list_connections')
      const connExt = paths['/voyager/api/connections'].get['x-openweb'] as Record<string, unknown>
      expect(connExt.actual_path).toBeUndefined()

      // The bare colliding path should NOT exist
      expect(paths['/voyager/api/graphql']).toBeUndefined()

      // All 4 operations produce test files
      expect(files).toContain('tests/search_people.test.json')
      expect(files).toContain('tests/get_profile.test.json')
      expect(files).toContain('tests/get_feed.test.json')
      expect(files).toContain('tests/list_connections.test.json')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})
