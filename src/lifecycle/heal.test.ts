import { describe, it, expect, vi, beforeEach } from 'vitest'
import { healSite, type HealResult } from './heal.js'
import type { SiteVerifyResult } from './verify.js'

// Mock all external dependencies
vi.mock('../lib/openapi.js', () => ({
  resolveSiteRoot: vi.fn(),
  listOperations: vi.fn(),
}))

vi.mock('../lib/manifest.js', () => ({
  loadManifest: vi.fn(),
}))

vi.mock('../discovery/pipeline.js', () => ({
  discover: vi.fn(),
}))

vi.mock('../commands/browser.js', () => ({
  resolveCdpEndpoint: vi.fn(),
}))

vi.mock('./registry.js', () => ({
  archiveWithBump: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  cp: vi.fn(),
  rm: vi.fn(),
  mkdtemp: vi.fn(),
}))

vi.mock('yaml', () => ({
  parse: vi.fn(),
  stringify: vi.fn((obj: unknown) => JSON.stringify(obj)),
}))

const { resolveSiteRoot } = await import('../lib/openapi.js')
const { loadManifest } = await import('../lib/manifest.js')
const { discover } = await import('../discovery/pipeline.js')
const { resolveCdpEndpoint } = await import('../commands/browser.js')
const { archiveWithBump } = await import('./registry.js')
const { readFile, writeFile, readdir, cp, rm, mkdtemp } = await import('node:fs/promises')
const { parse } = await import('yaml')

function mockVerifyResult(overrides?: Partial<SiteVerifyResult>): SiteVerifyResult {
  return {
    site: 'test-site',
    overallStatus: 'DRIFT',
    shouldQuarantine: false,
    operations: [
      { operationId: 'getFeed', status: 'DRIFT', driftType: 'schema_drift', detail: 'response shape changed' },
    ],
    ...overrides,
  }
}

describe('healSite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns early when manifest has no site_url', async () => {
    vi.mocked(resolveSiteRoot).mockResolvedValue('/fixtures/test-site')
    vi.mocked(loadManifest).mockResolvedValue({ name: 'test-site', version: '1.0.0', spec_version: '3.1.0' })

    const result = await healSite('test-site', mockVerifyResult())
    expect(result.failed).toContain('no_site_url')
    expect(result.healed).toHaveLength(0)
  })

  it('returns early when no drifted operations', async () => {
    vi.mocked(resolveSiteRoot).mockResolvedValue('/fixtures/test-site')
    vi.mocked(loadManifest).mockResolvedValue({
      name: 'test-site', version: '1.0.0', spec_version: '3.1.0',
      site_url: 'https://example.com',
    })

    const result = await healSite('test-site', mockVerifyResult({
      operations: [{ operationId: 'getFeed', status: 'PASS' }],
    }))
    expect(result.healed).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
  })

  it('returns no_browser when CDP endpoint unavailable', async () => {
    vi.mocked(resolveSiteRoot).mockResolvedValue('/fixtures/test-site')
    vi.mocked(loadManifest).mockResolvedValue({
      name: 'test-site', version: '1.0.0', spec_version: '3.1.0',
      site_url: 'https://example.com',
    })
    vi.mocked(resolveCdpEndpoint).mockRejectedValue(new Error('no browser'))

    const result = await healSite('test-site', mockVerifyResult())
    expect(result.failed).toContain('no_browser')
  })

  it('aborts on human handoff', async () => {
    vi.mocked(resolveSiteRoot).mockResolvedValue('/fixtures/test-site')
    vi.mocked(loadManifest).mockResolvedValue({
      name: 'test-site', version: '1.0.0', spec_version: '3.1.0',
      site_url: 'https://example.com',
    })
    vi.mocked(resolveCdpEndpoint).mockResolvedValue('http://localhost:9222')
    vi.mocked(discover).mockResolvedValue({
      site: 'test-site', outputRoot: '/tmp/discovered', operationCount: 2,
      humanHandoff: { type: 'captcha', url: 'https://example.com', action: 'solve captcha' },
    })

    const result = await healSite('test-site', mockVerifyResult())
    expect(result.failed).toEqual([expect.stringContaining('human_handoff')])
  })

  it('heals read operations and reports write operations', async () => {
    vi.mocked(resolveSiteRoot).mockResolvedValue('/fixtures/test-site')
    vi.mocked(loadManifest).mockResolvedValue({
      name: 'test-site', version: '1.0.0', spec_version: '3.1.0',
      site_url: 'https://example.com',
    })
    vi.mocked(resolveCdpEndpoint).mockResolvedValue('http://localhost:9222')
    vi.mocked(discover).mockResolvedValue({
      site: 'test-site', outputRoot: '/tmp/discovered', operationCount: 3,
    })
    vi.mocked(archiveWithBump).mockResolvedValue('1.1.0')
    vi.mocked(mkdtemp).mockResolvedValue('/tmp/openweb-heal-xxx')

    // Old spec: GET /feed (read, drifted) + POST /posts (write, drifted)
    const oldSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/api/feed': {
          get: { operationId: 'getFeed', summary: 'Get feed', 'x-openweb': { permission: 'read' } },
        },
        '/api/posts': {
          post: { operationId: 'createPost', summary: 'Create post', 'x-openweb': { permission: 'write' } },
        },
      },
    }

    // New spec: updated GET /feed + updated POST /posts
    const newSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/api/feed': {
          get: { operationId: 'getFeed', summary: 'Get feed v2', 'x-openweb': { permission: 'read' } },
        },
        '/api/posts': {
          post: { operationId: 'createPost', summary: 'Create post v2', 'x-openweb': { permission: 'write' } },
        },
      },
    }

    vi.mocked(readFile).mockImplementation(async (filePath: any) => {
      if (String(filePath).includes('/fixtures/test-site/openapi.yaml')) return JSON.stringify(oldSpec)
      if (String(filePath).includes('/tmp/discovered/openapi.yaml')) return JSON.stringify(newSpec)
      throw new Error(`unexpected readFile: ${filePath}`)
    })
    vi.mocked(parse).mockImplementation((raw: string) => JSON.parse(raw))
    vi.mocked(readdir).mockResolvedValue([] as any)
    vi.mocked(writeFile).mockResolvedValue(undefined)
    vi.mocked(rm).mockResolvedValue(undefined)

    const vr = mockVerifyResult({
      operations: [
        { operationId: 'getFeed', status: 'DRIFT', driftType: 'schema_drift' },
        { operationId: 'createPost', status: 'DRIFT', driftType: 'schema_drift' },
      ],
    })

    const result = await healSite('test-site', vr)

    expect(result.healed).toEqual(['getFeed'])
    expect(result.reported).toEqual(['createPost'])
    expect(result.newVersion).toBe('1.1.0')
  })

  it('derives permission from HTTP method when x-openweb.permission is absent', async () => {
    vi.mocked(resolveSiteRoot).mockResolvedValue('/fixtures/test-site')
    vi.mocked(loadManifest).mockResolvedValue({
      name: 'test-site', version: '1.0.0', spec_version: '3.1.0',
      site_url: 'https://example.com',
    })
    vi.mocked(resolveCdpEndpoint).mockResolvedValue('http://localhost:9222')
    vi.mocked(discover).mockResolvedValue({
      site: 'test-site', outputRoot: '/tmp/discovered', operationCount: 2,
    })
    vi.mocked(archiveWithBump).mockResolvedValue('1.1.0')
    vi.mocked(mkdtemp).mockResolvedValue('/tmp/openweb-heal-xxx')

    // No x-openweb.permission — derive from method
    const oldSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/api/items': {
          get: { operationId: 'getItems', summary: 'List items' },
          delete: { operationId: 'deleteItems', summary: 'Delete items' },
        },
      },
    }
    const newSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/api/items': {
          get: { operationId: 'getItems', summary: 'List items v2' },
          delete: { operationId: 'deleteItems', summary: 'Delete items v2' },
        },
      },
    }

    vi.mocked(readFile).mockImplementation(async (filePath: any) => {
      if (String(filePath).includes('/fixtures/test-site/openapi.yaml')) return JSON.stringify(oldSpec)
      if (String(filePath).includes('/tmp/discovered/openapi.yaml')) return JSON.stringify(newSpec)
      throw new Error(`unexpected readFile: ${filePath}`)
    })
    vi.mocked(parse).mockImplementation((raw: string) => JSON.parse(raw))
    vi.mocked(readdir).mockResolvedValue([] as any)
    vi.mocked(writeFile).mockResolvedValue(undefined)
    vi.mocked(rm).mockResolvedValue(undefined)

    const vr = mockVerifyResult({
      operations: [
        { operationId: 'getItems', status: 'DRIFT', driftType: 'schema_drift' },
        { operationId: 'deleteItems', status: 'DRIFT', driftType: 'schema_drift' },
      ],
    })

    const result = await healSite('test-site', vr)

    expect(result.healed).toEqual(['getItems'])      // GET → read → healed
    expect(result.reported).toEqual(['deleteItems'])  // DELETE → delete → reported
  })

  it('excludes auth_drift operations from heal candidates', async () => {
    vi.mocked(resolveSiteRoot).mockResolvedValue('/fixtures/test-site')
    vi.mocked(loadManifest).mockResolvedValue({
      name: 'test-site', version: '1.0.0', spec_version: '3.1.0',
      site_url: 'https://example.com',
    })

    const vr = mockVerifyResult({
      operations: [
        { operationId: 'getFeed', status: 'FAIL', driftType: 'auth_drift', detail: 'auth expired' },
      ],
    })

    const result = await healSite('test-site', vr)
    // No drifted ops after filtering auth_drift → early return
    expect(result.healed).toHaveLength(0)
    expect(result.reported).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
  })

  it('fails when discovered spec lacks the drifted path', async () => {
    vi.mocked(resolveSiteRoot).mockResolvedValue('/fixtures/test-site')
    vi.mocked(loadManifest).mockResolvedValue({
      name: 'test-site', version: '1.0.0', spec_version: '3.1.0',
      site_url: 'https://example.com',
    })
    vi.mocked(resolveCdpEndpoint).mockResolvedValue('http://localhost:9222')
    vi.mocked(discover).mockResolvedValue({
      site: 'test-site', outputRoot: '/tmp/discovered', operationCount: 1,
    })

    const oldSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/api/feed': {
          get: { operationId: 'getFeed', summary: 'Get feed', 'x-openweb': { permission: 'read' } },
        },
      },
    }
    // New spec doesn't have /api/feed
    const newSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/api/v2/feed': {
          get: { operationId: 'getFeedV2', summary: 'Get feed v2' },
        },
      },
    }

    vi.mocked(readFile).mockImplementation(async (filePath: any) => {
      if (String(filePath).includes('/fixtures/test-site/openapi.yaml')) return JSON.stringify(oldSpec)
      if (String(filePath).includes('/tmp/discovered/openapi.yaml')) return JSON.stringify(newSpec)
      throw new Error(`unexpected readFile: ${filePath}`)
    })
    vi.mocked(parse).mockImplementation((raw: string) => JSON.parse(raw))
    vi.mocked(rm).mockResolvedValue(undefined)

    const result = await healSite('test-site', mockVerifyResult())
    expect(result.failed).toContain('getFeed')
    expect(result.healed).toHaveLength(0)
  })

  it('returns no_operations_discovered when discovery finds nothing', async () => {
    vi.mocked(resolveSiteRoot).mockResolvedValue('/fixtures/test-site')
    vi.mocked(loadManifest).mockResolvedValue({
      name: 'test-site', version: '1.0.0', spec_version: '3.1.0',
      site_url: 'https://example.com',
    })
    vi.mocked(resolveCdpEndpoint).mockResolvedValue('http://localhost:9222')
    vi.mocked(discover).mockResolvedValue({
      site: 'test-site', outputRoot: '/tmp/discovered', operationCount: 0,
    })
    vi.mocked(rm).mockResolvedValue(undefined)

    const result = await healSite('test-site', mockVerifyResult())
    expect(result.failed).toContain('no_operations_discovered')
    expect(result.healed).toHaveLength(0)
  })

  it('skips runtime error driftType (only heals schema_drift and endpoint_removed)', async () => {
    vi.mocked(resolveSiteRoot).mockResolvedValue('/fixtures/test-site')
    vi.mocked(loadManifest).mockResolvedValue({
      name: 'test-site', version: '1.0.0', spec_version: '3.1.0',
      site_url: 'https://example.com',
    })

    const vr = mockVerifyResult({
      operations: [
        { operationId: 'getFeed', status: 'FAIL', driftType: 'error', detail: 'no browser tab open' },
      ],
    })

    const result = await healSite('test-site', vr)
    // driftType 'error' is not healable → early return with no ops
    expect(result.healed).toHaveLength(0)
    expect(result.reported).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
  })

  it('reports GET /checkout as transact (not auto-healed)', async () => {
    vi.mocked(resolveSiteRoot).mockResolvedValue('/fixtures/test-site')
    vi.mocked(loadManifest).mockResolvedValue({
      name: 'test-site', version: '1.0.0', spec_version: '3.1.0',
      site_url: 'https://example.com',
    })
    vi.mocked(resolveCdpEndpoint).mockResolvedValue('http://localhost:9222')
    vi.mocked(discover).mockResolvedValue({
      site: 'test-site', outputRoot: '/tmp/discovered', operationCount: 1,
    })

    // GET /checkout — no x-openweb.permission, but path triggers transact
    const oldSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/api/checkout': {
          get: { operationId: 'getCheckout', summary: 'Get checkout' },
        },
      },
    }
    const newSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/api/checkout': {
          get: { operationId: 'getCheckout', summary: 'Get checkout v2' },
        },
      },
    }

    vi.mocked(readFile).mockImplementation(async (filePath: any) => {
      if (String(filePath).includes('/fixtures/test-site/openapi.yaml')) return JSON.stringify(oldSpec)
      if (String(filePath).includes('/tmp/discovered/openapi.yaml')) return JSON.stringify(newSpec)
      throw new Error(`unexpected readFile: ${filePath}`)
    })
    vi.mocked(parse).mockImplementation((raw: string) => JSON.parse(raw))
    vi.mocked(rm).mockResolvedValue(undefined)

    const vr = mockVerifyResult({
      operations: [
        { operationId: 'getCheckout', status: 'DRIFT', driftType: 'schema_drift' },
      ],
    })

    const result = await healSite('test-site', vr)
    expect(result.reported).toEqual(['getCheckout'])  // transact → reported, not healed
    expect(result.healed).toHaveLength(0)
  })
})
